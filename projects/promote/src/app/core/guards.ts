import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';
import { Role } from './models';
import { PROMOTE_BASE, promoteUrl } from './base';

/** Requires an authenticated (non-expired) session. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const base = inject(PROMOTE_BASE);
  if (auth.isLoggedIn()) return true;
  // Preserve the intended destination (e.g. the /change-password link from a welcome email) so the
  // login page can send the user back there after signing in. `state.url` inclut déjà le préfixe
  // de fédération (/promote/...), donc returnUrl est correct tel quel.
  return router.createUrlTree([promoteUrl(base, '/login')], { queryParams: { returnUrl: state.url } });
};

/** Requires one of the given roles (derived from the JWT). */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return () => {
    const auth = inject(Auth);
    const router = inject(Router);
    const base = inject(PROMOTE_BASE);
    if (!auth.isLoggedIn()) return router.parseUrl(promoteUrl(base, '/login'));
    if (auth.hasRole(...roles)) return true;
    return router.parseUrl(promoteUrl(base, '/home'));
  };
}
