import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActionAuditDto,
  AdminStats,
  AgencyDto,
  CommissionEntryDto,
  CommissionRuleDto,
  HierarchyStatsDto,
  OrgViewDto,
  TeamMemberDto,
  AgentStats,
  CashierStats,
  CollecteDto,
  CollecteStats,
  ConfigDto,
  CreateCollecteRequest,
  CreateRechargeRequest,
  CreateSubscriptionRequest,
  CreateUserRequest,
  UpdateUserRequest,
  ImportUsersRequest,
  ImportUsersResult,
  ImportAgenciesRequest,
  ImportAgenciesResult,
  LoginAuditDto,
  LoginResponse,
  NotificationDto,
  PaymentStats,
  PaymentStatusDto,
  PrintStats,
  ProductCategoryDto,
  ProductCategoryRequest,
  ProductDto,
  ProductRequest,
  PromotionDto,
  PromotionRequest,
  ProfileDto,
  RechargeDto,
  GeneralSettingsDto,
  GeneralSettingsUpdate,
  SmtpSettingsDto,
  SmtpSettingsUpdate,
  SubscriptionDto,
  TestResult,
  TrustPayWaySettingsDto,
  TrustPayWaySettingsUpdate,
  User,
  UserDto,
} from './models';

/** Typed wrapper over the backend REST API (base path /api). */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  // Préfixe dédié à promote pour éviter la collision avec le /api de diaspora
  // sur la même origine (portail unifié). Le proxy (dev + nginx Docker) réécrit
  // /promote-api -> /api vers le backend promote (:8390).
  private base = '/promote-api';

  // ---- auth ----
  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/auth/login`, { email, password });
  }
  loginPhone(phone: string, pin: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/auth/login-phone`, { phone, pin });
  }
  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/forgot-password`, { email });
  }
  me(): Observable<User> {
    return this.http.get<User>(`${this.base}/auth/me`);
  }
  changePassword(currentPassword: string, newPassword: string): Observable<User> {
    return this.http.post<User>(`${this.base}/auth/change-password`, { currentPassword, newPassword });
  }
  /** Validate an emailed password-setup token and get who it belongs to (public). */
  setupTokenInfo(token: string): Observable<{ email: string; name: string }> {
    return this.http.get<{ email: string; name: string }>(`${this.base}/auth/set-password/${encodeURIComponent(token)}`);
  }
  /** Set a password directly from an emailed token, no sign-in required (public). */
  setPassword(token: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/set-password`, { token, newPassword });
  }

  // ---- catalogue / souscription (parcours public) ----
  products(): Observable<ProductDto[]> {
    return this.http.get<ProductDto[]>(`${this.base}/products`);
  }
  // ---- product CRUD (ADMIN / MANAGER) ----
  createProduct(req: ProductRequest): Observable<ProductDto> {
    return this.http.post<ProductDto>(`${this.base}/products`, req);
  }
  updateProduct(id: number, req: ProductRequest): Observable<ProductDto> {
    return this.http.put<ProductDto>(`${this.base}/products/${id}`, req);
  }
  deleteProduct(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/products/${id}`);
  }
  archiveProduct(id: number): Observable<ProductDto> {
    return this.http.post<ProductDto>(`${this.base}/products/${id}/archive`, {});
  }
  unarchiveProduct(id: number): Observable<ProductDto> {
    return this.http.post<ProductDto>(`${this.base}/products/${id}/unarchive`, {});
  }
  // ---- product image (MANAGER) ----
  /** Envoie (ou remplace) l'image représentative du produit. `image` = dataURL base64. */
  uploadProductImage(id: number, image: string): Observable<ProductDto> {
    return this.http.post<ProductDto>(`${this.base}/products/${id}/image`, { image });
  }
  deleteProductImage(id: number): Observable<ProductDto> {
    return this.http.delete<ProductDto>(`${this.base}/products/${id}/image`);
  }
  /** URL publique de l'image d'un produit (funnel de vente). `v` = cache-buster optionnel. */
  productImageUrl(id: number, v?: string | number): string {
    return `${this.base}/products/${id}/image${v != null ? `?v=${v}` : ''}`;
  }
  // ---- product categories (ADMIN / MANAGER) ----
  productCategories(): Observable<ProductCategoryDto[]> {
    return this.http.get<ProductCategoryDto[]>(`${this.base}/product-categories`);
  }
  createCategory(req: ProductCategoryRequest): Observable<ProductCategoryDto> {
    return this.http.post<ProductCategoryDto>(`${this.base}/product-categories`, req);
  }
  updateCategory(id: number, req: ProductCategoryRequest): Observable<ProductCategoryDto> {
    return this.http.put<ProductCategoryDto>(`${this.base}/product-categories/${id}`, req);
  }
  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/product-categories/${id}`);
  }
  // ---- promotions (ADMIN / MANAGER) ----
  addPromotion(productId: number, req: PromotionRequest): Observable<PromotionDto> {
    return this.http.post<PromotionDto>(`${this.base}/products/${productId}/promotions`, req);
  }
  updatePromotion(promoId: number, req: PromotionRequest): Observable<PromotionDto> {
    return this.http.put<PromotionDto>(`${this.base}/products/promotions/${promoId}`, req);
  }
  deletePromotion(promoId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/products/promotions/${promoId}`);
  }
  agencies(): Observable<AgencyDto[]> {
    return this.http.get<AgencyDto[]>(`${this.base}/agencies`);
  }
  agenciesAll(): Observable<AgencyDto[]> {
    return this.http.get<AgencyDto[]>(`${this.base}/agencies/all`);
  }
  importAgencies(req: ImportAgenciesRequest): Observable<ImportAgenciesResult> {
    return this.http.post<ImportAgenciesResult>(`${this.base}/agencies/import`, req);
  }
  config(): Observable<ConfigDto> {
    return this.http.get<ConfigDto>(`${this.base}/config`);
  }
  /** Upload a base64 data-URL; returns the storage key to reference in the subscription. */
  uploadKycImage(image: string, kind: 'selfie' | 'cni-recto' | 'cni-verso'): Observable<{ key: string }> {
    return this.http.post<{ key: string }>(`${this.base}/kyc/image`, { image, kind });
  }
  uploadReceipt(image: string): Observable<{ key: string; reference?: string | null; payerPhone?: string | null; amount?: number | null }> {
    return this.http.post<{ key: string; reference?: string | null; payerPhone?: string | null; amount?: number | null }>(
      `${this.base}/kyc/receipt`, { image, kind: 'sara-receipt' },
    );
  }
  createSelfSubscription(req: CreateSubscriptionRequest): Observable<SubscriptionDto> {
    return this.http.post<SubscriptionDto>(`${this.base}/subscriptions/self`, req);
  }
  paySubscription(ref: string, outcome: string, reason?: string): Observable<SubscriptionDto> {
    return this.http.patch<SubscriptionDto>(`${this.base}/subscriptions/${ref}/pay`, { outcome, reason });
  }
  subscriptionStatus(ref: string): Observable<PaymentStatusDto> {
    return this.http.get<PaymentStatusDto>(`${this.base}/subscriptions/${ref}/status`);
  }

  // ---- recharge (parcours public) ----
  createRecharge(req: CreateRechargeRequest): Observable<RechargeDto> {
    return this.http.post<RechargeDto>(`${this.base}/recharges`, req);
  }
  payRecharge(ref: string, outcome: string, reason?: string): Observable<RechargeDto> {
    return this.http.patch<RechargeDto>(`${this.base}/recharges/${ref}/pay`, { outcome, reason });
  }
  rechargeStatus(ref: string): Observable<PaymentStatusDto> {
    return this.http.get<PaymentStatusDto>(`${this.base}/recharges/${ref}/status`);
  }

  // ---- staff dashboard ----
  agentStats(): Observable<AgentStats> {
    return this.http.get<AgentStats>(`${this.base}/stats/agent`);
  }
  mySubscriptions(): Observable<SubscriptionDto[]> {
    return this.http.get<SubscriptionDto[]>(`${this.base}/subscriptions/mine`);
  }
  searchSubscriptions(q: string): Observable<SubscriptionDto[]> {
    return this.http.get<SubscriptionDto[]>(`${this.base}/subscriptions/search`, { params: { q } });
  }
  /** Fetch a captured KYC document as a Blob (the token interceptor adds the Authorization header,
   *  which a plain <img src> cannot). kind = selfie | cni-recto | cni-verso | sara-receipt. */
  subscriptionImage(ref: string, kind: string): Observable<Blob> {
    return this.http.get(`${this.base}/subscriptions/${ref}/image/${kind}`, { responseType: 'blob' });
  }

  // ---- cashier ----
  cashierStats(): Observable<CashierStats> {
    return this.http.get<CashierStats>(`${this.base}/stats/cashier`);
  }
  pendingRecharges(): Observable<RechargeDto[]> {
    return this.http.get<RechargeDto[]>(`${this.base}/recharges/pending-fulfillment`);
  }
  fulfillRecharge(ref: string, evidenceImageKey?: string): Observable<RechargeDto> {
    return this.http.patch<RechargeDto>(`${this.base}/recharges/${ref}/fulfill`, { evidenceImageKey });
  }
  cashValidateSubscription(ref: string, outcome: string, paymentReference?: string, reason?: string): Observable<SubscriptionDto> {
    return this.http.patch<SubscriptionDto>(`${this.base}/subscriptions/${ref}/cash-validate`, { outcome, paymentReference, reason });
  }

  // ---- print ----
  printStats(): Observable<PrintStats> {
    return this.http.get<PrintStats>(`${this.base}/stats/print`);
  }
  printSubscription(ref: string, cardNumber?: string, pan?: string): Observable<SubscriptionDto> {
    return this.http.patch<SubscriptionDto>(`${this.base}/subscriptions/${ref}/print`, { cardNumber, pan });
  }

  // ---- collecte ----
  collecteStats(): Observable<CollecteStats> {
    return this.http.get<CollecteStats>(`${this.base}/collectes/stats`);
  }
  myCollectes(): Observable<CollecteDto[]> {
    return this.http.get<CollecteDto[]>(`${this.base}/collectes/mine`);
  }
  createCollecte(req: CreateCollecteRequest): Observable<CollecteDto> {
    return this.http.post<CollecteDto>(`${this.base}/collectes`, req);
  }

  // ---- admin ----
  adminStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>(`${this.base}/stats/admin`);
  }
  paymentStats(): Observable<PaymentStats> {
    return this.http.get<PaymentStats>(`${this.base}/stats/payments`);
  }
  users(): Observable<UserDto[]> {
    return this.http.get<UserDto[]>(`${this.base}/users`);
  }
  createUser(req: CreateUserRequest): Observable<UserDto> {
    return this.http.post<UserDto>(`${this.base}/users`, req);
  }
  updateUser(id: string, req: UpdateUserRequest): Observable<UserDto> {
    return this.http.put<UserDto>(`${this.base}/users/${id}`, req);
  }
  setUserRoles(id: string, roles: string[]): Observable<UserDto> {
    return this.http.put<UserDto>(`${this.base}/users/${id}/roles`, { roles });
  }
  setUserEnabled(id: string, enabled: boolean): Observable<unknown> {
    return this.http.patch(`${this.base}/users/${id}/enabled`, { enabled });
  }
  importUsers(req: ImportUsersRequest): Observable<ImportUsersResult> {
    return this.http.post<ImportUsersResult>(`${this.base}/users/import`, req);
  }
  // ---- integration settings (admin) ----
  smtpSettings(): Observable<SmtpSettingsDto> {
    return this.http.get<SmtpSettingsDto>(`${this.base}/settings/smtp`);
  }
  updateSmtpSettings(req: SmtpSettingsUpdate): Observable<SmtpSettingsDto> {
    return this.http.put<SmtpSettingsDto>(`${this.base}/settings/smtp`, req);
  }
  testSmtp(to: string): Observable<TestResult> {
    return this.http.post<TestResult>(`${this.base}/settings/smtp/test`, { to });
  }
  trustPayWaySettings(): Observable<TrustPayWaySettingsDto> {
    return this.http.get<TrustPayWaySettingsDto>(`${this.base}/settings/trustpayway`);
  }
  updateTrustPayWaySettings(req: TrustPayWaySettingsUpdate): Observable<TrustPayWaySettingsDto> {
    return this.http.put<TrustPayWaySettingsDto>(`${this.base}/settings/trustpayway`, req);
  }
  testTrustPayWay(): Observable<TestResult> {
    return this.http.post<TestResult>(`${this.base}/settings/trustpayway/test`, {});
  }
  generalSettings(): Observable<GeneralSettingsDto> {
    return this.http.get<GeneralSettingsDto>(`${this.base}/settings/general`);
  }
  updateGeneralSettings(req: GeneralSettingsUpdate): Observable<GeneralSettingsDto> {
    return this.http.put<GeneralSettingsDto>(`${this.base}/settings/general`, req);
  }
  allSubscriptions(): Observable<SubscriptionDto[]> {
    return this.http.get<SubscriptionDto[]>(`${this.base}/subscriptions`);
  }
  profiles(): Observable<ProfileDto[]> {
    return this.http.get<ProfileDto[]>(`${this.base}/profiles`);
  }
  auditLogins(): Observable<LoginAuditDto[]> {
    return this.http.get<LoginAuditDto[]>(`${this.base}/audit/logins`);
  }
  auditActions(q?: string): Observable<ActionAuditDto[]> {
    return this.http.get<ActionAuditDto[]>(`${this.base}/audit/actions`, { params: q ? { q } : {} });
  }

  // ---- manager / team ----
  commissionRules(): Observable<CommissionRuleDto[]> {
    return this.http.get<CommissionRuleDto[]>(`${this.base}/commissions/rules`);
  }
  commissionEntries(): Observable<CommissionEntryDto[]> {
    return this.http.get<CommissionEntryDto[]>(`${this.base}/commissions/entries`);
  }
  hierarchyStats(): Observable<HierarchyStatsDto> {
    return this.http.get<HierarchyStatsDto>(`${this.base}/stats/hierarchy`);
  }
  teamRoster(): Observable<TeamMemberDto[]> {
    return this.http.get<TeamMemberDto[]>(`${this.base}/team`);
  }
  /** Org view for the drag-and-drop hierarchy builder (caller node + sub-tree + unassigned pool). */
  teamOrg(): Observable<OrgViewDto> {
    return this.http.get<OrgViewDto>(`${this.base}/team/org`);
  }
  /** (Re)assign the hierarchy parent of one/several members. parentId null → detach. */
  assignTeam(parentId: string | null, userIds: string[]): Observable<{ assigned: number; skipped: number }> {
    return this.http.patch<{ assigned: number; skipped: number }>(`${this.base}/team/assign`, { parentId, userIds });
  }
  sendTeamMessage(title: string, body: string, recipientIds: string[]): Observable<unknown> {
    return this.http.post(`${this.base}/team/message`, { title, body, recipientIds });
  }

  // ---- notifications ----
  notificationsMine(): Observable<NotificationDto[]> {
    return this.http.get<NotificationDto[]>(`${this.base}/notifications/mine`);
  }
  unreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/notifications/unread-count`);
  }
  markNotifRead(id: number): Observable<void> {
    return this.http.patch<void>(`${this.base}/notifications/${id}/read`, {});
  }
  markAllNotifRead(): Observable<void> {
    return this.http.post<void>(`${this.base}/notifications/read-all`, {});
  }

  // ---- reconciliation (admin) ----
  reconcile(hours: number): Observable<{ hours: number; scanned: number; updated: number; unchanged: number; errors: number }> {
    return this.http.post<{ hours: number; scanned: number; updated: number; unchanged: number; errors: number }>(
      `${this.base}/payment/reconcile`, null, { params: { hours: String(hours) } },
    );
  }

  // ---- generic helpers (extended view by view) ----
  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`);
  }
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body);
  }
}
