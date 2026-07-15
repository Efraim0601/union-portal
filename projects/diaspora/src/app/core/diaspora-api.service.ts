import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
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

  // ---- Pré-onboarding (OCR prefill — MRZ recto/verso, cf. server/diaspora-ocr) ----
  preOnboardingExtract(recto: File, documentType: string, verso?: File): Observable<unknown> {
    const form = new FormData();
    form.append('recto', recto);
    if (verso) form.append('verso', verso);
    form.append('document_type', documentType);
    return this.http.post(`${this.base}/pre-onboarding/extract`, form);
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

  // ---- Pré-onboarding : documents non-OCR chargés avant création du dossier ----
  preOnboardingUploadDocument(sessionId: string, file: File, documentType: string): Observable<unknown> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    return this.http.post(`${this.base}/pre-onboarding/${sessionId}/documents`, form);
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
