/**
 * Squelette du dossier d'ouverture de compte entreprise — parcours parallèle minimal.
 * Champs plausibles (raison sociale, RCCM, représentant légal…), à valider avec la
 * conformité avant mise en production ; volontairement isolé de ApplicationCreate
 * (particulier) plutôt que fusionné dedans.
 */
export interface EnterpriseApplicationCreate {
  client_type: 'ENTREPRISE';
  company_name: string;
  rccm_number?: string | null;
  activity_sector?: string | null;
  legal_rep_last_name?: string | null;
  legal_rep_first_name?: string | null;
  legal_rep_role?: string | null;
  head_office_address?: string | null;
  email: string;
  phone?: string | null;
}
