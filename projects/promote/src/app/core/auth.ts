import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { Api } from './api';
import { Role, User } from './models';

const TOKEN_KEY = 'afp_token';

interface JwtClaims {
  sub?: string;
  email?: string;
  role?: string;
  roles?: string; // CSV
  permissions?: string; // CSV
  exp?: number;
}

function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

/**
 * Auth state. Roles & permissions are the single source of truth from the JWT
 * (shared contract with the backend) — never the stored user object — which
 * avoids stale-token 403s after a role change.
 */
// NON `providedIn: 'root'` : fourni au niveau de la route promote (remote.routes.ts)
// et de l'app standalone (app.config.ts), pour partager l'injecteur de `Api` et le
// HttpClient porteur du `tokenInterceptor`. Cf. commentaire détaillé dans api.ts.
@Injectable()
export class Auth {
  private api = inject(Api);
  private router = inject(Router);

  private _token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly user = signal<User | null>(null);

  readonly claims = computed<JwtClaims | null>(() => {
    const t = this._token();
    return t ? decodeJwt(t) : null;
  });

  readonly isLoggedIn = computed(() => {
    const c = this.claims();
    if (!c) return false;
    if (c.exp && c.exp * 1000 < Date.now()) return false;
    return true;
  });

  readonly roles = computed<Role[]>(() => {
    const c = this.claims();
    const csv = c?.roles || c?.role || '';
    return csv.split(',').map((r) => r.trim()).filter(Boolean) as Role[];
  });

  readonly permissions = computed<string[]>(() => {
    const c = this.claims();
    return (c?.permissions || '').split(',').map((p) => p.trim()).filter(Boolean);
  });

  token(): string | null {
    return this._token();
  }

  hasRole(...r: Role[]): boolean {
    const mine = this.roles();
    return r.some((x) => mine.includes(x));
  }
  hasPermission(p: string): boolean {
    return this.permissions().includes(p);
  }

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap((res) => {
        this.setToken(res.token);
        if (res.user) this.user.set(res.user);
      }),
    );
  }

  refreshMe() {
    return this.api.me().pipe(tap((u) => this.user.set(u)));
  }

  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
    this._token.set(token);
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this.user.set(null);
    // Racine du portail : le shell redirige '/' vers le hub unifié ; en
    // standalone promote, '/' redirige vers la home promote. Marche dans les
    // deux contextes sans dépendre du préfixe de fédération.
    this.router.navigateByUrl('/');
  }
}
