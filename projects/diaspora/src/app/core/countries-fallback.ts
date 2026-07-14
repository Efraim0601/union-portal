/**
 * Liste de pays de secours (nom + indicatif téléphonique), utilisée quand le référentiel
 * `/api/countries/active` est indisponible (pas de backend en dev) ou renvoie une liste vide —
 * garantit que les sélecteurs pays/indicatif de la pré-inscription ne sont jamais vides.
 * Couvre la CEMAC (résidence/pièce d'identité) + les principales destinations de la diaspora.
 */
export interface CountryFallback { code: string; name: string; dial: string; }

export const COUNTRY_FALLBACK_LIST: CountryFallback[] = [
  { code: 'CM', name: 'Cameroun', dial: '+237' },
  { code: 'GA', name: 'Gabon', dial: '+241' },
  { code: 'CG', name: 'Congo', dial: '+242' },
  { code: 'TD', name: 'Tchad', dial: '+235' },
  { code: 'CF', name: 'République centrafricaine', dial: '+236' },
  { code: 'GQ', name: 'Guinée équatoriale', dial: '+240' },
  { code: 'FR', name: 'France', dial: '+33' },
  { code: 'BE', name: 'Belgique', dial: '+32' },
  { code: 'DE', name: 'Allemagne', dial: '+49' },
  { code: 'CH', name: 'Suisse', dial: '+41' },
  { code: 'US', name: 'États-Unis', dial: '+1' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'GB', name: 'Royaume-Uni', dial: '+44' },
  { code: 'IT', name: 'Italie', dial: '+39' },
  { code: 'ES', name: 'Espagne', dial: '+34' },
  { code: 'NL', name: 'Pays-Bas', dial: '+31' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '+225' },
  { code: 'SN', name: 'Sénégal', dial: '+221' },
  { code: 'NG', name: 'Nigéria', dial: '+234' },
  { code: 'ZA', name: 'Afrique du Sud', dial: '+27' },
  { code: 'AE', name: 'Émirats arabes unis', dial: '+971' },
  { code: 'CN', name: 'Chine', dial: '+86' },
];

const DIAL_BY_CODE: Record<string, string> = Object.fromEntries(
  COUNTRY_FALLBACK_LIST.map((c) => [c.code, c.dial]),
);

/** Indicatif pour un code pays ISO ; '' si inconnu de la liste de secours. */
export function dialCodeFor(countryCode: string | null | undefined): string {
  return (countryCode && DIAL_BY_CODE[countryCode.toUpperCase()]) || '';
}
