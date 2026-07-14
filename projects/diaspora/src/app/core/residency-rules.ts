/**
 * Règles de résidence / CEMAC pour le parcours particulier.
 * La détection VPN/IP incohérente (mentionnée au parcours AFB, étape 0) dépend
 * d'une intelligence IP côté serveur — hors périmètre de ce module frontend.
 */

export type ResidencyStatus = 'RESIDENT' | 'NON_RESIDENT';
export type IdentityDocumentType = 'CNI' | 'PASSEPORT' | 'CARTE_SEJOUR' | 'CARTE_CONSULAIRE';

/** Codes ISO 3166-1 alpha-2 des États membres de la CEMAC. */
export const CEMAC_COUNTRY_CODES: readonly string[] = ['CM', 'GA', 'CG', 'TD', 'CF', 'GQ'];

export function isCemacCountry(countryCode?: string | null): boolean {
  return !!countryCode && CEMAC_COUNTRY_CODES.includes(countryCode.toUpperCase());
}

/** Cameroun => résident, tout autre pays => non-résident (règle métier, pas un choix libre). */
export function deriveResidencyStatus(countryCode?: string | null): ResidencyStatus {
  return countryCode?.toUpperCase() === 'CM' ? 'RESIDENT' : 'NON_RESIDENT';
}

export interface IdentityDocOption {
  value: IdentityDocumentType;
  label: string;
}

/** Pièces d'identité acceptées selon le statut de résidence et le pays choisi. */
export function identityDocumentOptions(
  residencyStatus: ResidencyStatus,
  countryCode?: string | null,
): IdentityDocOption[] {
  if (residencyStatus === 'RESIDENT' || isCemacCountry(countryCode)) {
    return [
      { value: 'CNI', label: "Carte nationale d'identité" },
      { value: 'PASSEPORT', label: 'Passeport' },
    ];
  }
  return [
    { value: 'PASSEPORT', label: 'Passeport' },
    { value: 'CARTE_SEJOUR', label: 'Carte de séjour' },
    { value: 'CARTE_CONSULAIRE', label: 'Carte consulaire' },
  ];
}

export interface DocumentRequirement {
  /** Envoyé comme document_type à l'API. */
  key: string;
  label: string;
  /** true => la capture déclenche l'extraction OCR (preOnboardingExtract). */
  ocr: boolean;
  required: boolean;
}

/** Liste des documents à charger avant de poursuivre vers le profil (étape 2-3). */
export function documentRequirements(
  residencyStatus: ResidencyStatus,
  countryCode?: string | null,
): DocumentRequirement[] {
  const reqs: DocumentRequirement[] = [
    { key: 'IDENTITY', label: "Pièce d'identité", ocr: true, required: true },
    { key: 'INCOME_PROOF', label: 'Justificatif de revenu', ocr: false, required: true },
    { key: 'RIB', label: "Relevé d'identité bancaire (RIB)", ocr: false, required: true },
    { key: 'ADDRESS_PROOF', label: 'Justificatif de localisation', ocr: false, required: true },
  ];
  if (residencyStatus === 'NON_RESIDENT') {
    reqs.push({
      key: 'FOREIGN_STATUS_PROOF',
      label: "Justificatif de statut à l'étranger",
      ocr: false,
      required: false,
    });
  }
  return reqs;
}
