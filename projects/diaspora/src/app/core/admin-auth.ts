import { Injectable, computed, signal } from '@angular/core';

const TOKEN_KEY = 'diaspora_admin_token';
const EXPIRES_KEY = 'diaspora_admin_token_expires_at';

interface StoredSession { token: string; expiresAt: number; }

function readSession(): StoredSession | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = Number(localStorage.getItem(EXPIRES_KEY));
    if (!token || !expiresAt || Date.now() >= expiresAt) return null;
    return { token, expiresAt };
  } catch {
    return null;
  }
}

/**
 * Session admin diaspora — protège /admin/parametrage (listes KYC, packages).
 * Volontairement local à l'app diaspora : `@union/auth` (ClientAuthStore) existe dans le
 * monorepo mais n'est branché nulle part (aucun flux ne produit encore de token dans son
 * format) et l'auth JWT de "promote" dépend de son propre backend Spring Boot, absent ici.
 * En attendant un vrai backend d'authentification pour diaspora, `login()` passe par
 * /api/admin/login — intercepté par mock-api.interceptor.ts en dev UNIQUEMENT (jamais en
 * build de prod/Docker, cf. isLocalDevServer()) : en production réelle, sans backend qui
 * répond à cette route, la connexion échoue et la page admin reste fermée (fail-closed).
 */
@Injectable({ providedIn: 'root' })
export class AdminAuth {
  private session = signal<StoredSession | null>(readSession());
  readonly isAuthenticated = computed(() => !!this.session());

  token(): string | null {
    const s = this.session();
    if (s && Date.now() >= s.expiresAt) { this.logout(); return null; }
    return s?.token ?? null;
  }

  setSession(token: string, expiresAt: number): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EXPIRES_KEY, String(expiresAt));
    } catch { /* stockage indisponible (navigation privée…) — session en mémoire pour l'onglet */ }
    this.session.set({ token, expiresAt });
  }

  logout(): void {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EXPIRES_KEY); } catch { /* ignore */ }
    this.session.set(null);
  }
}
