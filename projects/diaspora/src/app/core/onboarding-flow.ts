/**
 * Flux d'ouverture de compte diaspora — 5 étapes (fidèle au template legacy
 * client_open_account.html : "steps" 1..5, étape 1 = "Informations personnelles").
 * Regroupement des champs dérivé de schemas.ApplicationCreate.
 */
import { ApplicationCreate } from './application.model';

export interface OnboardingStep {
  index: number; // 1..5
  key: string;
  title: string;
  description: string;
  fields: (keyof ApplicationCreate)[];
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    index: 1,
    key: 'personal',
    title: 'Informations personnelles',
    description:
      "Renseignez vos informations telles qu'elles figurent sur votre pièce d'identité.",
    fields: [
      'last_name', 'first_name', 'birth_name', 'birth_date', 'birth_place',
      'birth_department', 'sex', 'marital_status', 'matrimonial_regime',
      'father_name', 'mother_name', 'nationality', 'residence', 'residency_status',
    ],
  },
  {
    index: 2,
    key: 'contact',
    title: 'Coordonnées & personnes à contacter',
    description: 'Adresse, téléphone et contacts de référence.',
    fields: [
      'address_location', 'postal_box', 'phone', 'whatsapp_phone_full', 'email',
      'contact_person_1_name', 'contact_person_1_phone',
      'contact_person_2_name', 'contact_person_2_phone',
    ],
  },
  {
    index: 3,
    key: 'kyc',
    title: "Pièce d'identité & activité",
    description: "Document d'identité, activité économique et conformité (KYC).",
    fields: [
      'identity_document_number', 'identity_document_issue_date', 'identity_document_issue_place',
      'activity_sector', 'activity_sector_code', 'activity_subsector', 'activity_subsector_code',
      'income_range', 'income_currency', 'funds_origin', 'funds_origin_other',
      'account_object', 'account_object_other', 'is_pep', 'pep_details',
    ],
  },
  {
    index: 4,
    key: 'package',
    title: 'Formule & agence',
    description: 'Choix de la formule de compte et de l’agence de rattachement.',
    fields: [
      'account_type', 'preferred_branch', 'account_purpose',
      'selected_package_code', 'selected_package_name', 'selected_package_currency',
      'selected_package_opening_fee', 'selected_package_subscription_fee',
      'selected_package_monthly_fee', 'selected_package_payment_required',
    ],
  },
  {
    index: 5,
    key: 'review',
    title: 'Récapitulatif & confirmation',
    description: 'Vérifiez vos informations puis validez votre demande.',
    fields: [],
  },
];
