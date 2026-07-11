import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { SubscriptionDto } from '../core/models';

/** Payment methods, ported from components.jsx PAY_METHODS. */
export interface PayMethod { id: string; name: string; short: string; bg: string; fg: string; momo: boolean; logo?: string; }
export const PAY_METHODS: PayMethod[] = [
  { id: 'om', name: 'Orange Money', short: 'OM', bg: '#FF7900', fg: '#fff', momo: true },
  { id: 'mtn', name: 'MTN MoMo', short: 'MTN', bg: '#FFCB05', fg: '#1a1a1a', momo: true },
  { id: 'sara', name: 'SARA Money', short: 'SARA', bg: '#fff', fg: '#1E3A8A', momo: false, logo: 'assets/sara_logo.png' },
  { id: 'cash', name: 'Espèces', short: '₣', bg: '#0E7A45', fg: '#fff', momo: false },
];
export const payById = (id: string): PayMethod => PAY_METHODS.find((p) => p.id === id) ?? PAY_METHODS[0];

/** Interval (ms) for the silent background refresh of payment data on the staff dashboards.
 *  15 s is a deliberate balance: status transitions still surface quickly, but the request rate
 *  per connected user is ~5× lower than at 3 s — which is the single biggest capacity lever
 *  (a load test showed 100 agents polling every 3 s saturated the server). */
export const LIVE_REFRESH_MS = 15000;

/**
 * Background polling that PAUSES while the browser tab is hidden and resumes — with an immediate
 * refresh — when it becomes visible again. Idle background tabs were the biggest source of wasted
 * load: an agent who left a dashboard open in another tab kept hitting the server every
 * LIVE_REFRESH_MS for nothing. Skipping hidden ticks cuts that fixed background traffic to zero,
 * and the on-visible refresh means the user never sees stale data when they switch back.
 * Returns a disposer that stops the interval and detaches the visibility listener (call it in
 * ngOnDestroy in place of clearInterval).
 */
export function livePoll(cb: () => void, intervalMs: number = LIVE_REFRESH_MS): () => void {
  const timer = setInterval(() => { if (!document.hidden) cb(); }, intervalMs);
  const onVisible = () => { if (!document.hidden) cb(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}

/**
 * Smart KYC capture: live face detection on the selfie (reject filming something other than a
 * head) + live auto-framing/auto-capture on the CNI. Degrades gracefully — if the MediaPipe model
 * can't load, the camera falls back to plain manual capture. Set to false to revert every capture
 * screen to the legacy manual behaviour without touching the components.
 */
export const KYC_SMART_CAPTURE = true;

/**
 * Cameroon mobile prefixes per operator (9 digits, starting with 6). Used to ensure the
 * Mobile Money number entered matches the chosen operator before letting the client continue.
 *  - MTN:    67·····, 650–654····, 680–684····
 *  - Orange: 69·····, 655–659····, 685–689····
 */
export const OPERATOR_PHONE: Record<string, RegExp> = {
  mtn: /^6(7\d{7}|5[0-4]\d{6}|8[0-4]\d{6})$/,
  om: /^6(9\d{7}|5[5-9]\d{6}|8[5-9]\d{6})$/,
};
/** True if a 9-digit Cameroon number belongs to the given operator (om | mtn). Unknown operator → not checked.
 *  Only meaningful for Cameroon numbers; callers skip it for other countries. */
export const matchesOperator = (operator: string, phone: string): boolean => {
  const re = OPERATOR_PHONE[operator];
  return re ? re.test(phone) : true;
};

/** Pretty international form of an E.164 number for display (e.g. "+237 6 99 00 00 00"). */
export const formatPhone = (v: string): string => {
  if (!v) return '';
  const p = parsePhoneNumberFromString(v);
  return p ? p.formatInternational() : v;
};

/** Collecte products (bank products sold) — codes; labels resolved via i18n `prod_<code>`. */
export const COLLECTE_PRODUCTS = ['compte_ouvert', 'carte_bancaire', 'sara_money', 'e_first'];
/** Card types offered for the `carte_bancaire` product — codes; labels via i18n `ct_<code>`. */
export const CARD_TYPES = [
  'carte_fellow', 'carte_partner', 'carte_prepayee',
  'carte_visa_classic', 'carte_visa_gold', 'carte_blanche',
];

/** PAN length — fixed at 16 digits everywhere (digits only, no separators). */
export const PAN_DIGITS = 16;               // "numéro à 16 chiffres présent sur la carte"
export const PAN_MAX_DIGITS = PAN_DIGITS;   // kept for existing callers; same value
/** PAN digits only, capped at 16 (drops any spaces/separators). */
export const panDigits = (v: string): string => (v || '').replace(/\D/g, '').slice(0, PAN_DIGITS);
/** Format a PAN for entry/display: digits grouped in blocks of 4 (e.g. "5078 2300 1234 5678").
 *  Already-masked PANs from the server (containing "*") are returned as-is. */
export const formatPan = (v: string): string => {
  if (!v) return '';
  if (v.includes('*')) return v.trim();
  return panDigits(v).replace(/(.{4})/g, '$1 ').trim();
};
/** Mask the middle 8 digits of a 16-digit PAN before sending it over the wire.
 *  "5078230012345678" → "5078 **** **** 5678". Returns the value unchanged if not 16 digits. */
export const maskPan = (v: string): string => {
  if (!v) return v;
  const digits = panDigits(v);
  if (digits.length !== PAN_DIGITS) return v;
  return digits.substring(0, 4) + ' **** **** ' + digits.substring(12);
};

/** Retrait/livraison proposé au client. 'promote' (stand Promote) par défaut, ou 'agence'
 *  (retrait dans une agence Afriland à choisir). 'home' n'est plus proposé mais reste toléré
 *  pour l'affichage des données existantes. */
export const DELIVERY_MODES = ['promote', 'agence'];

/** Overall record status for badges — ports components.jsx recordStatus(). */
export function recordStatus(r: SubscriptionDto): string {
  // A failed payment must never be hidden by a (mistaken) print — surface the failure first.
  // Un délai dépassé (prompt USSD jamais validé, sans débit) est distingué d'un vrai rejet :
  // statut « expired » → libellé « Expiré » au lieu de l'alarmant « Échouée ». Reste un payStatus
  // 'failed' côté données (filtres/stats inchangés) — seul le badge change.
  if (r.payStatus === 'failed') return r['failureCategory'] === 'TIMEOUT' ? 'expired' : 'failed';
  if (r.printed) return 'printed';
  if (r.payStatus === 'cash') return 'cash';
  if (r.payStatus === 'sara_pending') return 'sara_pending';
  if (r.payStatus === 'pending') return 'pending';   // en attente de paiement (PIN client)
  return 'paid';                                      // payée, pas encore imprimée -> « à imprimer »
}

/** Deterministic PRNG (mulberry32) used by the generative QR + card starfield. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
