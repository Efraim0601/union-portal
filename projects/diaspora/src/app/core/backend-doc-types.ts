/**
 * Correspondance des types de documents entre le front office (clés « métier »
 * du parcours diaspora) et les `document_type` réellement attendus par le backend
 * FastAPI diaspora-onboarding (`app/routers/pre_onboarding.py`).
 *
 * Deux surfaces backend consomment ces valeurs :
 *  - `POST /pre-onboarding/save-file` : range le fichier sous
 *    `uploads/pre_onboarding/{session}/{document_type}_{uuid}.{ext}` ;
 *  - `run_session_face_match()` (déclenché quand un `CLIENT_VIDEO_*` est enregistré)
 *    retrouve les images de RÉFÉRENCE **par préfixe de nom de fichier** :
 *    `CNI_RECTO_*`, `CNI_VERSO_*`, `CLIENT_PHOTO_*` et la vidéo `CLIENT_VIDEO_*`.
 *
 * Conséquence importante : l'image porteuse du visage de la pièce (recto CNI OU
 * page photo du passeport) DOIT être envoyée sous `CNI_RECTO` — c'est le seul
 * emplacement de référence « document » que le moteur de comparaison faciale
 * examine, quel que soit le type réel de la pièce.
 */

export type IdentitySide = 'RECTO' | 'VERSO';

/**
 * `document_type` pour `POST /pre-onboarding/save-file`, par clé de document du
 * front (cf. `residency-rules.documentRequirements` + capture biométrie).
 */
export const SAVE_FILE_DOC_TYPE: Record<string, string> = {
  INCOME_PROOF: 'INCOME_PROOF',
  RIB: 'RIB_DOCUMENT',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  FOREIGN_STATUS_PROOF: 'FOREIGN_STATUS_PROOF',
  // Biométrie — noms exigés par run_session_face_match (préfixes de référence).
  SELFIE: 'CLIENT_PHOTO',
  LIVENESS_VIDEO: 'CLIENT_VIDEO',
  // Pièce d'identité — emplacements de référence pour la comparaison faciale.
  IDENTITY_RECTO: 'CNI_RECTO',
  IDENTITY_VERSO: 'CNI_VERSO',
};

/** Traduit une clé de document front en `document_type` backend (repli : la clé telle quelle). */
export function toBackendDocType(frontKey: string): string {
  return SAVE_FILE_DOC_TYPE[frontKey] ?? frontKey;
}

/**
 * `document_type` de référence pour l'upload de la pièce d'identité destiné à la
 * comparaison faciale. Toujours `CNI_RECTO` / `CNI_VERSO` (seuls préfixes que
 * `run_session_face_match` reconnaît), quel que soit le type réel de pièce.
 */
export function identityReferenceDocType(side: IdentitySide): 'CNI_RECTO' | 'CNI_VERSO' {
  return side === 'RECTO' ? 'CNI_RECTO' : 'CNI_VERSO';
}

/**
 * `document_type` pour l'OCR (`POST /pre-onboarding/ocr`). Le backend s'en sert
 * pour la validation de type (gardes RIB/badge) et la détection recto/verso des
 * CNI (`detect_cni_side`, qui teste la présence de « CNI » et de « RECTO »/« VERSO »).
 * L'extraction MRZ/texte, elle, tourne quel que soit ce libellé.
 */
export function ocrDocumentType(identityType: string, side?: IdentitySide): string {
  const base = identityType === 'PASSEPORT' ? 'PASSPORT' : identityType;
  return side ? `${base}_${side}` : base;
}
