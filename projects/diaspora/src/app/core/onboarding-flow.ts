/**
 * Flux d'ouverture de compte diaspora.
 * Parcours particulier : 9 étapes — les 4 premières (pré-inscription, OTP WhatsApp,
 * documents + OCR, biométrie) sont pilotées par des composants dédiés ('custom'),
 * les 5 suivantes réutilisent le rendu générique par champs (dérivé de
 * diaspora-onboarding/app/schemas.py : ApplicationCreate), fidèle au template legacy
 * client_open_account.html.
 * Parcours entreprise : squelette parallèle minimal (2 étapes), champs à valider
 * avec la conformité.
 */
import { ApplicationCreate } from './application.model';
import { EnterpriseApplicationCreate } from './enterprise-application.model';

export type StepKind = 'generic' | 'custom' | 'review';

export interface OnboardingStep {
  index: number;
  key: string;
  title: string;
  description: string;
  kind: StepKind;
  fields: (keyof ApplicationCreate)[];
}

export const PARTICULIER_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    index: 1,
    key: 'preregistration',
    title: 'Pré-inscription',
    description: 'Email, WhatsApp et pays de résidence.',
    kind: 'custom',
    fields: [],
  },
  {
    index: 2,
    key: 'otp',
    title: 'Vérification WhatsApp',
    description: 'Code reçu par WhatsApp à saisir pour continuer.',
    kind: 'custom',
    fields: [],
  },
  {
    index: 3,
    key: 'documents',
    title: 'Documents',
    description: "Pièce d'identité et justificatifs à capturer ou importer.",
    kind: 'custom',
    fields: [],
  },
  {
    index: 4,
    key: 'biometrics',
    title: 'Selfie & vérification vidéo',
    description: 'Photo de votre visage et courte vidéo de vérification.',
    kind: 'custom',
    fields: [],
  },
  {
    index: 5,
    key: 'personal',
    title: 'Informations personnelles',
    description:
      "Renseignez vos informations telles qu'elles figurent sur votre pièce d'identité.",
    kind: 'generic',
    fields: [
      'sex', 'marital_status', 'matrimonial_regime',
      'last_name', 'birth_name', 'first_name', 'birth_date', 'birth_place',
      'birth_department', 'nationality', 'residence',
    ],
  },
  {
    index: 6,
    key: 'contact',
    title: 'Coordonnées & personnes à contacter',
    description: 'Adresse, téléphone, parents et contacts de référence.',
    kind: 'generic',
    fields: [
      'address_location', 'postal_box', 'whatsapp_phone_full', 'email',
      'father_name', 'father_phone', 'mother_name', 'mother_phone',
      'contact_person_1_name', 'contact_person_1_phone',
      'contact_person_2_name', 'contact_person_2_phone',
    ],
  },
  {
    index: 7,
    key: 'kyc',
    // La pièce est capturée à l'étape « Documents » ; ici on ne fait que confirmer ses références
    // (préremplies par l'OCR) aux côtés de l'activité et de la conformité — d'où ce libellé, pour
    // ne pas laisser croire qu'on re-photographie la pièce.
    title: 'Activité & conformité (KYC)',
    description: 'Activité économique, tranche de revenus et conformité réglementaire.',
    kind: 'generic',
    fields: [
      'identity_document_type', 'identity_document_number', 'identity_document_issue_date', 'identity_document_issue_place',
      'profession', 'income_range',
    ],
  },
  {
    index: 8,
    key: 'package',
    title: 'Formule & agence',
    description: 'Choix de la formule de compte et de l’agence de rattachement.',
    kind: 'generic',
    fields: [
      'preferred_branch', 'account_currency', 'account_type', 'rib',
      'account_object', 'account_object_other', 'funds_origin', 'funds_origin_other', 'account_purpose',
    ],
  },
  {
    index: 9,
    key: 'review',
    title: 'Récapitulatif & confirmation',
    description: 'Vérifiez vos informations puis validez votre demande.',
    kind: 'review',
    fields: [],
  },
];

export interface EnterpriseOnboardingStep {
  index: number;
  key: string;
  title: string;
  description: string;
  kind: StepKind;
  fields: (keyof EnterpriseApplicationCreate)[];
}

export const ENTERPRISE_ONBOARDING_STEPS: EnterpriseOnboardingStep[] = [
  {
    index: 1,
    key: 'company',
    title: "Informations sur l'entreprise",
    description: 'Identité de la société et représentant légal.',
    kind: 'generic',
    fields: [
      'company_name', 'rccm_number', 'activity_sector',
      'legal_rep_last_name', 'legal_rep_first_name', 'legal_rep_role',
      'head_office_address', 'email', 'phone',
    ],
  },
  {
    index: 2,
    key: 'documents',
    title: 'Documents',
    description: "RCCM, statuts, carte de contribuable, justificatif de siège.",
    kind: 'custom',
    fields: [],
  },
  {
    index: 3,
    key: 'review',
    title: 'Récapitulatif & confirmation',
    description: 'Vérifiez vos informations puis validez votre demande.',
    kind: 'review',
    fields: [],
  },
];
