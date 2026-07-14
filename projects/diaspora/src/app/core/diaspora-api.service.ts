import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
  sendWhatsappOtp(phone: string): Observable<{ pre_onboarding_session_id: string }> {
    return this.http.post<{ pre_onboarding_session_id: string }>(
      `${this.base}/pre-onboarding/whatsapp-otp/send`,
      { phone },
    );
  }
  verifyWhatsappOtp(
    phone: string,
    code: string,
  ): Observable<{ pre_onboarding_session_id: string; verified: boolean }> {
    return this.http.post<{ pre_onboarding_session_id: string; verified: boolean }>(
      `${this.base}/pre-onboarding/whatsapp-otp/verify`,
      { phone, code },
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
  countries(): Observable<Country[]> {
    return this.http.get<Country[]>(`${this.base}/countries/active`);
  }
  nationalities(): Observable<Nationality[]> {
    return this.http.get<Nationality[]>(`${this.base}/nationalities/active`);
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

  // ---- Paiements (Mastercard gateway) ----
  initiatePackagePayment(applicationReference: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments/package/initiate/${applicationReference}`, {});
  }
  getPayment(paymentReference: string): Observable<unknown> {
    return this.http.get(`${this.base}/payments/${paymentReference}`);
  }
}
