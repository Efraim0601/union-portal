import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Agency,
  ApplicationCreate,
  ApplicationResponse,
  Country,
  Nationality,
  Subsector,
} from './application.model';

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

  // ---- Pré-onboarding (OCR prefill) ----
  preOnboardingExtract(file: File, accountType: string, documentType: string): Observable<unknown> {
    const form = new FormData();
    form.append('file', file);
    form.append('account_type', accountType);
    form.append('document_type', documentType);
    return this.http.post(`${this.base}/pre-onboarding/extract`, form);
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

  // ---- Paiements (Mastercard gateway) ----
  initiatePackagePayment(applicationReference: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments/package/initiate/${applicationReference}`, {});
  }
  getPayment(paymentReference: string): Observable<unknown> {
    return this.http.get(`${this.base}/payments/${paymentReference}`);
  }
}
