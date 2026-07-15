import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminAuth } from './admin-auth';

export const adminAuthGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AdminAuth);
  const router = inject(Router);
  if (auth.token()) return true;
  return router.createUrlTree(['/admin/login'], { queryParams: { returnUrl: state.url } });
};
