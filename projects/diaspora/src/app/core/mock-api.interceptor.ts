import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { catchError, delay, of, throwError } from 'rxjs';

// Ports `ng serve` locaux (shell/promote/diaspora) — jamais ceux du build Docker/nginx (8080/8443)
// ni d'un vrai déploiement, où une erreur backend doit rester une vraie erreur.
const LOCAL_DEV_PORTS = new Set(['4200', '4201', '4202']);

function isLocalDevServer(): boolean {
  return typeof location !== 'undefined'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    && LOCAL_DEV_PORTS.has(location.port);
}

/**
 * Le backend FastAPI (diaspora-onboarding) n'existe pas dans ce dépôt Angular — en dev,
 * tout appel /api/* échoue (404/500 selon le serveur). Pour pouvoir dérouler le parcours
 * de bout en bout sans backend, cet intercepteur laisse passer la vraie requête et,
 * UNIQUEMENT si elle échoue ET qu'on tourne sur un serveur `ng serve` local (jamais en
 * build de prod/Docker), la remplace par une réponse simulée plausible. Dès qu'un vrai
 * backend répond, ce mécanisme ne se déclenche plus (le catchError n'est atteint qu'en
 * cas d'erreur).
 *
 * Note : on ne s'appuie pas sur `isDevMode()` — une fois `@angular/core` partagé en
 * singleton entre le shell et les remotes via Native Federation, son résultat n'est plus
 * fiable dans ce contexte fédéré (il peut renvoyer `false` alors qu'on est bien en dev).
 */
export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  console.info(`[mock-api][debug] intercepteur invoqué pour ${req.method} ${req.url} — isLocalDevServer=${isLocalDevServer()} host=${typeof location !== 'undefined' ? location.host : 'n/a'}`);
  if (!isLocalDevServer() || !req.url.includes('/api/')) return next(req);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      console.info(`[mock-api][debug] erreur interceptée pour ${req.method} ${req.url}, statut ${err.status}`);
      let mocked: unknown | null;
      try {
        mocked = buildMockResponse(req.method, req.url, req.body, req.headers.get('Authorization'));
      } catch (mockErr) {
        if (mockErr instanceof MockUnauthorized) {
          console.info(`[mock-api] ${req.method} ${req.url} → 401 simulé (${mockErr.message})`);
          return throwError(() => new HttpErrorResponse({ status: 401, url: req.url, error: { message: mockErr.message } }));
        }
        throw mockErr;
      }
      if (mocked == null) {
        console.info(`[mock-api][debug] aucune réponse simulée trouvée pour ${req.method} ${req.url}`);
        return throwError(() => err);
      }
      console.info(`[mock-api] ${req.method} ${req.url} → réponse simulée (dev, backend indisponible)`);
      return of(new HttpResponse({ status: 200, body: mocked })).pipe(delay(350));
    }),
  );
};

/** Signale un échec d'auth simulé (identifiants invalides / token manquant) — distinct d'un
 *  simple "pas de mock pour cette route", qui lui laisse remonter l'erreur réseau d'origine. */
class MockUnauthorized extends Error {}

// Identifiants de dev UNIQUEMENT — cf. mock-api-only côté isLocalDevServer(), jamais actif en
// prod/Docker. À remplacer par un vrai flux d'auth backend avant toute mise en production.
const ADMIN_MOCK_CREDENTIALS = { email: 'admin@diaspora.local', password: 'Diaspora-Admin-2026!' };
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

let mockSessionCounter = 0;
let mockApplicationCounter = 0;

function buildMockResponse(method: string, url: string, body: unknown, authHeader: string | null): unknown | null {
  const path = url.split('/api/')[1] ?? '';

  // ---- Session admin (/admin/parametrage) ----
  if (method === 'POST' && path === 'admin/login') {
    const { email, password } = (body ?? {}) as { email?: string; password?: string };
    if (email === ADMIN_MOCK_CREDENTIALS.email && password === ADMIN_MOCK_CREDENTIALS.password) {
      return { token: `mock-admin-${Date.now()}`, expires_at: new Date(Date.now() + ADMIN_TOKEN_TTL_MS).toISOString() };
    }
    throw new MockUnauthorized('Identifiants invalides');
  }

  // ---- Référentiels ----
  if (method === 'GET' && path === 'countries/active') return MOCK_COUNTRIES;
  if (method === 'GET' && path === 'nationalities/active') return MOCK_NATIONALITIES;
  if (method === 'GET' && path.startsWith('subsectors/')) return [];

  // ---- Agences : paramétrables via /admin/parametrage, mêmes règles que les listes ci-dessous
  //      (lecture publique, écriture authentifiée) — persistées en localStorage. ----
  if (path === 'agencies/active') {
    if (method === 'GET') return readLookup('agencies');
    if (method === 'PUT') {
      if (!authHeader) throw new MockUnauthorized('Authentification requise pour modifier cette liste.');
      return writeLookup('agencies', body);
    }
  }

  // ---- Listes paramétrables (admin) : lecture publique (le formulaire d'onboarding en a besoin
  //      pour ses listes déroulantes), écriture réservée aux sessions admin authentifiées
  //      (cf. adminTokenInterceptor qui pose l'en-tête Authorization). Persistées en localStorage
  //      tant que le vrai backend n'expose pas ces routes — cf. LOOKUP_DEFAULTS plus bas. ----
  if (path.startsWith('lookups/')) {
    const kind = path.replace('lookups/', '');
    if (method === 'GET') return readLookup(kind);
    if (method === 'PUT') {
      if (!authHeader) throw new MockUnauthorized('Authentification requise pour modifier ces listes.');
      return writeLookup(kind, body);
    }
  }

  // ---- Pré-onboarding : OTP WhatsApp ----
  if (method === 'POST' && path === 'pre-onboarding/whatsapp-otp/send') {
    return { pre_onboarding_session_id: `mock-session-${++mockSessionCounter}` };
  }
  if (method === 'POST' && path === 'pre-onboarding/whatsapp-otp/verify') {
    return { pre_onboarding_session_id: `mock-session-${mockSessionCounter || 1}`, verified: true };
  }

  // ---- Pré-onboarding : OCR ----
  if (method === 'POST' && path === 'pre-onboarding/extract') {
    return {
      last_name: 'MBALLA',
      first_name: 'Jean',
      birth_date: '1990-04-12',
      birth_place: 'Douala',
      nationality: 'CM',
      identity_document_number: 'A1234567',
      identity_document_issue_date: '2022-01-15',
      identity_document_issue_place: 'Douala',
    };
  }

  // ---- Pré-onboarding : OCR du plan de localisation (adresse + boîte postale si lisibles) ----
  if (method === 'POST' && path === 'pre-onboarding/extract-address') {
    return {
      address_location: 'Quartier Bonapriso, Rue Njo-Njo, derrière la pharmacie du Rond-Point',
      postal_box: 'BP 4567 Douala',
    };
  }

  // ---- Pré-onboarding : upload de document (non-OCR, selfie, vidéo) ----
  if (method === 'POST' && /^pre-onboarding\/[^/]+\/documents$/.test(path)) {
    return { received: true };
  }

  // ---- Dossier particulier ----
  if (method === 'POST' && path === 'applications') {
    const payload = (body ?? {}) as Record<string, unknown>;
    return { ...payload, id: ++mockApplicationCounter, reference: `AFR-MOCK-${1000 + mockApplicationCounter}` };
  }

  // ---- Dossier entreprise ----
  if (method === 'POST' && path === 'enterprise-applications') {
    const payload = (body ?? {}) as Record<string, unknown>;
    return { ...payload, id: ++mockApplicationCounter, reference: `AFR-ENT-MOCK-${1000 + mockApplicationCounter}` };
  }

  // ---- Suivi de dossier (page /status) ----
  if (method === 'GET' && path.startsWith('applications/status/')) {
    const reference = decodeURIComponent(path.replace('applications/status/', '').split('?')[0]);
    return { reference, status: 'EN_COURS_DE_TRAITEMENT', message: 'Dossier en cours de revue (donnée simulée).' };
  }
  if (method === 'GET' && (path.startsWith('applications/status-by-email') || path.startsWith('applications/status-by-contact'))) {
    return { reference: `AFR-MOCK-${1000 + (mockApplicationCounter || 1)}`, status: 'EN_COURS_DE_TRAITEMENT', message: 'Dossier en cours de revue (donnée simulée).' };
  }

  return null;
}

const MOCK_COUNTRIES = [
  { code: 'CM', name: 'Cameroun' },
  { code: 'GA', name: 'Gabon' },
  { code: 'CG', name: 'Congo' },
  { code: 'TD', name: 'Tchad' },
  { code: 'CF', name: 'République centrafricaine' },
  { code: 'GQ', name: 'Guinée équatoriale' },
  { code: 'FR', name: 'France' },
  { code: 'BE', name: 'Belgique' },
  { code: 'US', name: 'États-Unis' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Allemagne' },
];

const MOCK_NATIONALITIES = [
  { code: 'CM', name: 'Camerounaise' },
  { code: 'FR', name: 'Française' },
  { code: 'GA', name: 'Gabonaise' },
  { code: 'US', name: 'Américaine' },
];

// ---- Listes paramétrables (secteurs, tranches/types de revenu, origine des fonds, objet du
//      compte, sous-secteurs, formules de compte) — persistées en localStorage tant que le vrai
//      backend n'expose pas encore /api/lookups/*. L'interface admin lit/écrit via ces mêmes clés,
//      donc les modifications faites en dev survivent au rafraîchissement de la page. ----
const LOOKUP_STORAGE_PREFIX = 'diaspora_mock_lookups_';

const LOOKUP_DEFAULTS: Record<string, unknown> = {
  agencies: [
    { code: 'YDE01', name: 'Agence Yaoundé Centre', city: 'Yaoundé' },
    { code: 'DLA01', name: 'Agence Douala Akwa', city: 'Douala' },
    { code: 'PAR01', name: 'Agence Paris', city: 'Paris' },
  ],
  sectors: [
    { code: 'COMMERCE', name: 'Commerce' },
    { code: 'AGRICULTURE', name: 'Agriculture' },
    { code: 'INDUSTRIE', name: 'Industrie' },
    { code: 'SERVICES', name: 'Services' },
    { code: 'FONCTION_PUBLIQUE', name: 'Fonction publique' },
    { code: 'SANTE', name: 'Santé' },
    { code: 'EDUCATION', name: 'Éducation' },
    { code: 'TRANSPORT', name: 'Transport' },
    { code: 'BTP', name: 'BTP / Construction' },
    { code: 'AUTRE', name: 'Autre' },
  ],
  'income-ranges': [
    { code: 'MOINS_500K', name: 'Moins de 500 000' },
    { code: '500K_1M', name: '500 000 – 1 000 000' },
    { code: '1M_3M', name: '1 000 000 – 3 000 000' },
    { code: 'PLUS_3M', name: 'Plus de 3 000 000' },
  ],
  'income-types': [
    { code: 'SALAIRE', name: 'Salaire' },
    { code: 'ACTIVITE_INDEPENDANTE', name: 'Activité indépendante / commerciale' },
    { code: 'PENSION', name: 'Pension / Retraite' },
    { code: 'REVENUS_LOCATIFS', name: 'Revenus locatifs' },
    { code: 'AUTRE', name: 'Autre' },
  ],
  'funds-origins': [
    { code: 'SALAIRE', name: 'Salaire' },
    { code: 'EPARGNE', name: 'Épargne personnelle' },
    { code: 'HERITAGE', name: 'Héritage' },
    { code: 'VENTE_BIEN', name: 'Vente de bien' },
    { code: 'ACTIVITE_COMMERCIALE', name: 'Activité commerciale' },
    { code: 'AUTRE', name: 'Autre' },
  ],
  'account-objects': [
    { code: 'EPARGNE', name: 'Épargne' },
    { code: 'TRANSACTIONS_COURANTES', name: 'Transactions courantes' },
    { code: 'TRANSFERTS_INTERNATIONAUX', name: 'Transferts internationaux' },
    { code: 'INVESTISSEMENT', name: 'Investissement' },
    { code: 'AUTRE', name: 'Autre' },
  ],
  // Liste provisoire en attendant le branchement sur Amplitude (cf. demande produit) — éditable
  // dès maintenant via /admin/parametrage, à remplacer/compléter par l'export Amplitude réel.
  professions: [
    { code: 'SALARIE_PRIVE', name: 'Salarié du secteur privé' },
    { code: 'FONCTIONNAIRE', name: 'Fonctionnaire' },
    { code: 'COMMERCANT', name: 'Commerçant(e)' },
    { code: 'ENTREPRENEUR', name: 'Entrepreneur / Chef d’entreprise' },
    { code: 'PROFESSION_LIBERALE', name: 'Profession libérale' },
    { code: 'AGRICULTEUR', name: 'Agriculteur / Éleveur' },
    { code: 'ETUDIANT', name: 'Étudiant(e)' },
    { code: 'RETRAITE', name: 'Retraité(e)' },
    { code: 'SANS_EMPLOI', name: 'Sans emploi' },
    { code: 'AUTRE', name: 'Autre' },
  ],
  subsectors: [
    { code: 'COMMERCE_DETAIL', name: 'Commerce de détail', sector_code: 'COMMERCE' },
    { code: 'COMMERCE_GROS', name: 'Commerce de gros', sector_code: 'COMMERCE' },
    { code: 'IMPORT_EXPORT', name: 'Import-export', sector_code: 'COMMERCE' },
    { code: 'AGRI_VIVRIERE', name: 'Agriculture vivrière', sector_code: 'AGRICULTURE' },
    { code: 'AGRI_ELEVAGE', name: 'Élevage', sector_code: 'AGRICULTURE' },
    { code: 'INDUSTRIE_AGRO', name: 'Agro-industrie', sector_code: 'INDUSTRIE' },
    { code: 'SERVICES_FINANCIERS', name: 'Services financiers', sector_code: 'SERVICES' },
    { code: 'SERVICES_INFORMATIQUE', name: 'Informatique / Numérique', sector_code: 'SERVICES' },
  ],
  packages: [
    {
      code: 'BUDGET', name: 'Package Budget', tagline: 'Destiné aux petites bourses',
      currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
      features: ['SMS', 'First Carte Fellow', 'SARA Banking'],
    },
    {
      code: 'BUSINESS', name: 'Package Business', tagline: 'Pour les professionnels',
      currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
      features: ['SMS', 'First Assurance', 'Découvert permanent', 'Carte Visa Classique'],
    },
    {
      code: 'ECO', name: 'Package Eco', tagline: 'L’essentiel au meilleur prix',
      currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
      features: ['SMS', 'First Assurance', 'SARA Banking'],
    },
  ],
};

function readLookup(kind: string): unknown {
  const fallback = LOOKUP_DEFAULTS[kind];
  if (fallback === undefined) return null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOOKUP_STORAGE_PREFIX + kind) : null;
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLookup(kind: string, body: unknown): unknown {
  const list = body ?? [];
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOOKUP_STORAGE_PREFIX + kind, JSON.stringify(list));
  } catch { /* stockage indisponible (navigation privée…) — la sauvegarde reste en mémoire pour la session */ }
  return list;
}
