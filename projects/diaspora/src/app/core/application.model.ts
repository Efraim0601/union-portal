/**
 * Modèles TypeScript du frontend Angular diaspora, dérivés de
 * diaspora-onboarding/app/schemas.py (Pydantic). Miroir de ApplicationCreate /
 * ApplicationResponse.
 */

export interface ApplicationCreate {
  pre_onboarding_session_id?: string | null;
  whatsapp_phone_full?: string | null;
  whatsapp_otp_verified?: boolean | null;
  whatsapp_otp_verified_at?: string | null;

  last_name: string;
  first_name: string;
  birth_date?: string | null;
  birth_place?: string | null;
  birth_department?: string | null;
  birth_name?: string | null;
  residency_status?: string | null; // "RESIDENT" par défaut

  address_location?: string | null;
  postal_box?: string | null;
  phone?: string | null;
  email: string;

  contact_person_1_name?: string | null;
  contact_person_1_phone?: string | null;
  contact_person_2_name?: string | null;
  contact_person_2_phone?: string | null;

  father_name?: string | null;
  mother_name?: string | null;

  nationality?: string | null;
  residence?: string | null;

  sex?: string | null;
  marital_status?: string | null;
  matrimonial_regime?: string | null;

  identity_document_number?: string | null;
  identity_document_issue_date?: string | null;
  identity_document_issue_place?: string | null;

  rib?: string | null;
  income_range?: string | null;
  income_currency?: string | null;
  activity_sector?: string | null;
  activity_sector_code?: string | null;
  activity_subsector?: string | null;
  activity_subsector_code?: string | null;
  sector_of_activity?: string | null;
  economic_sector?: string | null;

  account_object?: string | null;
  account_object_other?: string | null;
  funds_origin?: string | null;
  funds_origin_other?: string | null;

  account_type?: string | null;
  preferred_branch?: string | null;

  selected_package_code?: string | null;
  selected_package_name?: string | null;
  selected_package_currency?: string | null;
  selected_package_opening_fee?: number | null;
  selected_package_subscription_fee?: number | null;
  selected_package_monthly_fee?: number | null;
  selected_package_payment_required?: boolean | null;
  account_purpose?: string | null;

  is_pep: boolean;
  pep_details?: string | null;
}

export interface ApplicationResponse extends Omit<ApplicationCreate, 'is_pep'> {
  id: number;
  reference: string;
  is_pep: boolean;
}

/** Référentiels (endpoints /api/countries, /api/nationalities, /api/subsectors, /api/agencies). */
export interface Country { code: string; name: string; dial_code?: string; }
export interface Nationality { code: string; name: string; }
export interface Subsector { code: string; name: string; sector_code?: string; }
export interface Agency { code: string; name: string; city?: string; }
