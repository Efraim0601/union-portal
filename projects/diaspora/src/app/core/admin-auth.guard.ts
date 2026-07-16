import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminAuth } from './admin-auth';

/** `state.url` est déjà l'URL absolue complète résolue par le Router (ex. '/diaspora/admin/parametrage'
 *  en fédération, '/admin/parametrage' en standalone) — jamais codée en dur, contrairement à
 *  createUrlTree(['/admin/login']) qui casserait sous le shell fédéré (cf. NG04002 ailleurs dans
 *  ce parcours). On dérive donc le préfixe de montage à partir de `state.url` lui-même. */
export const adminAuthGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AdminAuth);
  const router = inject(Router);
  if (auth.token()) return true;
  const suffix = '/admin/parametrage';
  const prefix = state.url.endsWith(suffix) ? state.url.slice(0, -suffix.length) : '';
  return router.createUrlTree([`${prefix}/admin/login`], { queryParams: { returnUrl: state.url } });
};
