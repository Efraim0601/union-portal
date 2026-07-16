import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of } from 'rxjs';
import {
  Agency,
  ApplicationCreate,
  ApplicationResponse,
  Country,
  LookupKind,
  LookupOption,
  Nationality,
  PackageOffer,
  Subsector,
} from './application.model';
import { EnterpriseApplicationCreate } from './enterprise-application.model';
import { IdentitySide, ocrDocumentType, toBackendDocType } from './backend-doc-types';

/** Référentiels tels que le backend FastAPI les renvoie (noms de champs différents du front). */
interface BackendCountry {
  iso_code: string;
  name_fr: string;
  calling_code?: string;
}
interface BackendNationality {
  code: string;
  label: string;
}

/** Envoi d'un OTP WhatsApp : le backend distingue « accepté par Callbell » de « livré au client ». */
export interface WhatsappOtpSendResult {
  ok: boolean;
  message?: string;
  whatsapp_accepted?: boolean;
  whatsapp_delivered?: boolean;
  whatsapp_delivery_status?: string;
  /** Renseigné uniquement quand WhatsApp n'a pas livré le code : à afficher au client. */
  fallback_otp?: string;
  fallback_display?: boolean;
}

export interface WhatsappOtpVerifyResult {
  ok: boolean;
  verified: boolean;
  session_id: string;
  whatsapp_otp_verified?: boolean;
  whatsapp_otp_verified_at?: string;
}

/** Résultat OCR consolidé (recto + verso fusionnés) exposé au front. */
export interface OcrExtractResult {
  fields: Partial<ApplicationCreate>;
  documentValidation?: OcrDocumentValidation;
  documentSide?: OcrDocumentSide;
}
/** Validation de type de pièce (gardes RIB back-office / badge employé côté backend). */
export interface OcrDocumentValidation {
  status?: string;
  message?: string | null;
  expected_category?: string;
  detected_category?: string;
}
/** Détection recto/verso (côté déclaré vs côté réellement photographié). */
export interface OcrDocumentSide {
  declared?: string;
  detected?: string;
  status?: string;
  message?: string | null;
}

/** Verdict de la comparaison faciale croisée (vidéo↔selfie↔CNI). */
export interface FaceMatchIdentity {
  status?: string;
  match: boolean;
  confidence?: number;
  recognizer?: string;
  reasons?: string[];
  pairs?: Record<
    string,
    { cosine_similarity?: number; threshold?: number; match?: boolean; margin?: number }
  >;
  sources?: Record<string, unknown>;
}
/** Réponse `run_session_face_match` (dans /save-file d'un CLIENT_VIDEO et sur /face-match/{id}). */
export interface FaceMatchResult {
  status?: string;
  recognizer?: string;
  references?: Record<
    string,
    { status?: string; cosine_similarity?: number; threshold?: number; quality?: number }
  >;
  identity?: FaceMatchIdentity;
  video_file?: string;
  reference_files?: Record<string, string>;
  [k: string]: unknown;
}
/** Réponse de POST /pre-onboarding/save-file. */
export interface SaveFileResult {
  pre_document_id?: string;
  session_id?: string;
  document_type?: string;
  stored_name?: string;
  face_match?: FaceMatchResult;
  [k: string]: unknown;
}

/** Forme brute d'une réponse /pre-onboarding/ocr (une seule face). */
interface BackendOcrResponse {
  extracted_fields?: Record<string, unknown>;
  document_type_validation?: OcrDocumentValidation;
  document_side?: OcrDocumentSide | null;
  [k: string]: unknown;
}

/**
 * Wrapper typé de l'API FastAPI diaspora-onboarding (base /api).
 * Endpoints dérivés de app/routers/*.py (côté client public).
 */
@Injectable({ providedIn: 'root' })
export class DiasporaApi {
  private http = inject(HttpClient);
  private base = '/api';

  // ---- Demandes d'ouverture de compte ----
  createApplication(payload: ApplicationCreate): Observable<ApplicationResponse> {
    return this.http.post<ApplicationResponse>(`${this.base}/applications`, payload);
  }
  getApplication(id: number): Observable<ApplicationResponse> {
    return this.http.get<ApplicationResponse>(`${this.base}/applications/${id}`);
  }
  statusByEmail(email: string): Observable<unknown> {
    return this.http.get(`${this.base}/applications/status-by-email`, {
      params: new HttpParams().set('email', email),
    });
  }
  statusByContact(identifier: string): Observable<unknown> {
    return this.http.get(`${this.base}/applications/status-by-contact`, {
      params: new HttpParams().set('identifier', identifier),
    });
  }
  statusByReference(reference: string, email?: string): Observable<unknown> {
    let params = new HttpParams();
    if (email) params = params.set('email', email);
    return this.http.get(`${this.base}/applications/status/${reference}`, { params });
  }
  uploadDocument(applicationId: number, file: File, documentType: string): Observable<unknown> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    return this.http.post(`${this.base}/applications/${applicationId}/documents`, form);
  }

  // ---- Pré-onboarding (OCR prefill — RapidOCR + MRZ, backend diaspora-onboarding) ----
  // Le backend expose POST /pre-onboarding/ocr (UNE face par appel). On envoie donc
  // recto puis verso séparément et on fusionne les champs (la MRZ d'une CNI est au
  // verso). Les noms de champs backend sont projetés sur les clés OCR du front.
  preOnboardingExtract(
    recto: File,
    identityType: string,
    verso?: File,
    accountType = 'PARTICULIER',
    sessionId?: string,
  ): Observable<OcrExtractResult> {
    const ocrOne = (file: File, side?: IdentitySide): Observable<BackendOcrResponse> => {
      const form = new FormData();
      form.append('account_type', accountType);
      form.append('document_type', ocrDocumentType(identityType, side));
      form.append('file', file);
      if (sessionId) form.append('session_id', sessionId);
      return this.http.post<BackendOcrResponse>(`${this.base}/pre-onboarding/ocr`, form);
    };
    const calls = verso ? [ocrOne(recto, 'RECTO'), ocrOne(verso, 'VERSO')] : [ocrOne(recto)];
    return forkJoin(calls).pipe(map((responses) => this.combineOcr(responses)));
  }

  /** Fusionne les réponses OCR (recto/verso) et projette les champs backend → clés front. */
  private combineOcr(responses: BackendOcrResponse[]): OcrExtractResult {
    const merged: Record<string, unknown> = {};
    for (const r of responses) {
      const ef = r?.extracted_fields ?? {};
      for (const [k, v] of Object.entries(ef)) {
        if (v != null && String(v).trim() !== '' && !merged[k]) merged[k] = v;
      }
    }
    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = merged[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return undefined;
    };
    const fields: Partial<ApplicationCreate> = {};
    const set = (key: keyof ApplicationCreate, val?: string) => {
      if (val) (fields as Record<string, unknown>)[key as string] = val;
    };
    set('last_name', pick('last_name', 'surname'));
    set('first_name', pick('first_name', 'given_names'));
    set('birth_date', pick('birth_date'));
    set('birth_place', pick('place_of_birth', 'birth_place'));
    set('nationality', pick('nationality'));
    set('identity_document_number', pick('identity_document_number', 'cni_number', 'passport_number'));
    set('identity_document_issue_date', pick('identity_issue_date', 'identity_document_issue_date'));
    set('identity_document_issue_place', pick('identity_document_issue_place', 'place_of_issue'));

    // Signaux d'authenticité : on remonte le plus « parlant » (un MISMATCH prime).
    const documentValidation =
      responses.map((r) => r?.document_type_validation).find((v) => v?.status && v.status !== 'OK') ??
      responses[0]?.document_type_validation;
    const documentSide =
      responses.map((r) => r?.document_side ?? undefined).find((s) => s?.status === 'SIDE_MISMATCH') ??
      responses.map((r) => r?.document_side ?? undefined).find((s) => !!s);

    return { fields, documentValidation, documentSide };
  }

  /** OCR d'adresse : le monolithe n'expose pas /extract-address → best-effort no-op
   *  (l'utilisateur saisit son adresse manuellement, comme pour un plan dessiné à la main). */
  preOnboardingExtractAddress(_file: File): Observable<{ address_location?: string; postal_box?: string }> {
    return of({});
  }

  // ---- Pré-onboarding : OTP WhatsApp (Callbell, côté backend) ----
  // Routes réelles : POST /pre-onboarding/otp/{send,verify} (app/routers/pre_onboarding.py).
  // Le `session_id` est fourni par le CLIENT et sert de clé de la session OTP
  // côté backend : il doit être identique entre l'envoi et la vérification.
  //
  // Le backend ne confirme l'envoi qu'une fois la LIVRAISON WhatsApp établie.
  // Si Meta ne remet pas le message, il renvoie `fallback_otp` : le code est
  // alors affiché au client pour ne pas bloquer le parcours.
  sendWhatsappOtp(phone: string, sessionId: string): Observable<WhatsappOtpSendResult> {
    return this.http.post<WhatsappOtpSendResult>(
      `${this.base}/pre-onboarding/otp/send`,
      { session_id: sessionId, phone },
    );
  }
  verifyWhatsappOtp(
    phone: string,
    code: string,
    sessionId: string,
  ): Observable<WhatsappOtpVerifyResult> {
    return this.http.post<WhatsappOtpVerifyResult>(
      `${this.base}/pre-onboarding/otp/verify`,
      { session_id: sessionId, phone, otp: code },
    );
  }

  // ---- Pré-onboarding : documents chargés avant création du dossier ----
  // POST /pre-onboarding/save-file. Le `document_type` front est traduit vers le nom
  // attendu par le backend (cf. backend-doc-types). La réponse d'un CLIENT_VIDEO
  // porte le verdict de comparaison faciale (`face_match`, run_session_face_match).
  preOnboardingUploadDocument(
    sessionId: string,
    file: File,
    documentType: string,
    accountType = 'PARTICULIER',
  ): Observable<SaveFileResult> {
    const form = new FormData();
    form.append('session_id', sessionId);
    form.append('account_type', accountType);
    form.append('document_type', toBackendDocType(documentType));
    form.append('file', file);
    return this.http.post<SaveFileResult>(`${this.base}/pre-onboarding/save-file`, form);
  }

  /** Relance / récupère le verdict de comparaison faciale d'une session (repli). */
  preOnboardingFaceMatch(sessionId: string): Observable<FaceMatchResult> {
    return this.http.post<FaceMatchResult>(`${this.base}/pre-onboarding/face-match/${sessionId}`, {});
  }

  // ---- Entreprise (parcours parallèle, squelette) ----
  createEnterpriseApplication(payload: EnterpriseApplicationCreate): Observable<unknown> {
    return this.http.post(`${this.base}/enterprise-applications`, payload);
  }

  // ---- Référentiels ----
  // Le backend expose ses propres noms de champs (iso_code/name_fr/calling_code,
  // label…) : on les projette ici sur le modèle du front. Sans cette projection,
  // les listes déroulantes affichent « undefined » et bloquent le parcours.
  countries(): Observable<Country[]> {
    return this.http
      .get<BackendCountry[]>(`${this.base}/countries/active`)
      .pipe(
        map((list) =>
          (list ?? []).map((c) => ({
            code: c.iso_code,
            name: c.name_fr,
            dial_code: c.calling_code,
          })),
        ),
      );
  }
  nationalities(): Observable<Nationality[]> {
    return this.http
      .get<BackendNationality[]>(`${this.base}/nationalities/active`)
      .pipe(map((list) => (list ?? []).map((n) => ({ code: n.code, name: n.label }))));
  }
  agencies(): Observable<Agency[]> {
    return this.http.get<Agency[]>(`${this.base}/agencies/active`);
  }
  saveAgencies(list: Agency[]): Observable<Agency[]> {
    return this.http.put<Agency[]>(`${this.base}/agencies/active`, list);
  }
  subsectorsBySector(sectorCode: string): Observable<Subsector[]> {
    return this.http.get<Subsector[]>(`${this.base}/subsectors/by-sector/${sectorCode}`);
  }
  subsectorsGrouped(): Observable<unknown> {
    return this.http.get(`${this.base}/subsectors/grouped`);
  }

  // ---- Listes paramétrables (interface admin — secteurs, tranches/types de revenu, origine des
  //      fonds, objet du compte, sous-secteurs, formules de compte). ----
  lookup(kind: LookupKind): Observable<LookupOption[]> {
    return this.http.get<LookupOption[]>(`${this.base}/lookups/${kind}`);
  }
  saveLookup(kind: LookupKind, list: LookupOption[]): Observable<LookupOption[]> {
    return this.http.put<LookupOption[]>(`${this.base}/lookups/${kind}`, list);
  }
  lookupSubsectors(): Observable<Subsector[]> {
    return this.http.get<Subsector[]>(`${this.base}/lookups/subsectors`);
  }
  saveLookupSubsectors(list: Subsector[]): Observable<Subsector[]> {
    return this.http.put<Subsector[]>(`${this.base}/lookups/subsectors`, list);
  }
  packages(): Observable<PackageOffer[]> {
    return this.http.get<PackageOffer[]>(`${this.base}/lookups/packages`);
  }
  savePackages(list: PackageOffer[]): Observable<PackageOffer[]> {
    return this.http.put<PackageOffer[]>(`${this.base}/lookups/packages`, list);
  }

  // ---- Session admin (protège /admin/parametrage — cf. core/admin-auth.ts) ----
  adminLogin(email: string, password: string): Observable<{ token: string; expires_at: string }> {
    return this.http.post<{ token: string; expires_at: string }>(`${this.base}/admin/login`, { email, password });
  }

  // ---- Paiements (Mastercard gateway) ----
  initiatePackagePayment(applicationReference: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments/package/initiate/${applicationReference}`, {});
  }
  getPayment(paymentReference: string): Observable<unknown> {
    return this.http.get(`${this.base}/payments/${paymentReference}`);
  }
}
