import { Injectable, computed, signal } from '@angular/core';

/**
 * Store d'authentification client PARTAGÉ — port Angular de
 * portal-client-firstpay/ui-components/src/lib/authStore.ts
 *
 * Contrat d'interopérabilité conservé à l'identique pour que promote, diaspora
 * ET les apps de la banque partagent la même session quand elles sont servies
 * sur la même origine :
 *   - clé localStorage : 'portail_client_auth'
 *   - forme persistée   : { isAuthenticated, user, expiresAt }
 *   - sync cross-tab / cross-app via l'événement 'storage'
 */

const STORAGE_KEY = 'portail_client_auth';

interface JwtPayload {
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  email?: string;
  matricule?: string;
  accountNumber?: string;
  exp?: number;
}

export interface AuthUser {
  phone: string;
  name: string;
  givenName: string;
  familyName: string;
  email: string;
  matricule: string;
  accountNumber: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  apps: string[];
}

interface PersistedState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  expiresAt: number | null;
}

const EMPTY: PersistedState = { isAuthenticated: false, user: null, expiresAt: null };

function decodeJwt(token: string): JwtPayload {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class ClientAuthStore {
  private readonly _state = signal<PersistedState>(this.read());
  private readonly _showLoginModal = signal(false);

  readonly isAuthenticated = computed(() => this._state().isAuthenticated);
  readonly user = computed(() => this._state().user);
  readonly showLoginModal = computed(() => this._showLoginModal());

  constructor() {
    // Sync cross-tab / cross-app (identique à _app.tsx de host/partner-portal)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) this._state.set(this.read());
      });
      this.checkSession();
    }
  }

  /** Applique le résultat d'un login (réponse API brute : tokens + apps). */
  setSession(
    resp: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: string;
      apps: string[];
    },
    phone: string,
  ): void {
    const payload = decodeJwt(resp.accessToken);
    const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + resp.expiresIn * 1000;
    const user: AuthUser = {
      ...resp,
      phone: payload.preferred_username || phone,
      name: payload.name || '',
      givenName: payload.given_name || '',
      familyName: payload.family_name || '',
      email: payload.email || '',
      matricule: payload.matricule || '',
      accountNumber: payload.accountNumber || '',
    };
    this.write({ isAuthenticated: true, user, expiresAt });
    this._showLoginModal.set(false);
  }

  logout(): void {
    this.write(EMPTY);
  }

  checkSession(): void {
    const { user, expiresAt, isAuthenticated } = this._state();
    if (!isAuthenticated) return;
    if (!user?.accessToken || (expiresAt != null && Date.now() >= expiresAt)) {
      this.write(EMPTY);
    }
  }

  getAccessToken(): string | null {
    const { user, expiresAt } = this._state();
    if (!user?.accessToken) return null;
    if (expiresAt != null && Date.now() >= expiresAt) return null;
    return user.accessToken;
  }

  hasAppAccess(appId: string): boolean {
    const { user, isAuthenticated } = this._state();
    if (!isAuthenticated || !user) return false;
    return user.apps.some(
      (a) => a === appId || a.endsWith(`/${appId}`) || appId.endsWith(`/${a}`)
    );
  }

  setShowLoginModal(show: boolean): void {
    this._showLoginModal.set(show);
  }

  // --- persistance localStorage (partagée avec la banque) ---------------------

  private read(): PersistedState {
    if (typeof localStorage === 'undefined') return EMPTY;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return EMPTY;
      // zustand persist enveloppe l'état dans { state, version }
      const parsed = JSON.parse(raw);
      const s: PersistedState = parsed.state ?? parsed;
      if (s.isAuthenticated && !s.user?.accessToken) return EMPTY;
      return { isAuthenticated: !!s.isAuthenticated, user: s.user ?? null, expiresAt: s.expiresAt ?? null };
    } catch {
      return EMPTY;
    }
  }

  private write(state: PersistedState): void {
    this._state.set(state);
    if (typeof localStorage === 'undefined') return;
    // même enveloppe que zustand/persist pour rester interopérable
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
  }
}
