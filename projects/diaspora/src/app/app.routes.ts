import { Routes } from '@angular/router';
import { adminAuthGuard } from './core/admin-auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./pages/home').then((m) => m.DiasporaHomePage) },
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding-welcome').then((m) => m.DiasporaOnboardingWelcomePage) },
  { path: 'onboarding/particulier', loadComponent: () => import('./pages/onboarding').then((m) => m.DiasporaOnboardingPage) },
  { path: 'onboarding/entreprise', loadComponent: () => import('./pages/onboarding-enterprise').then((m) => m.DiasporaOnboardingEnterprisePage) },
  // Route ADDITIVE (optionnelle) : embarque le parcours legacy FastAPI en iframe.
  { path: 'onboarding-legacy', loadComponent: () => import('./pages/legacy-onboarding').then((m) => m.DiasporaLegacyOnboardingPage) },
  { path: 'status', loadComponent: () => import('./pages/status').then((m) => m.DiasporaStatusPage) },
  { path: 'admin/login', loadComponent: () => import('./pages/admin-login').then((m) => m.DiasporaAdminLoginPage) },
  {
    path: 'admin/parametrage',
    canActivate: [adminAuthGuard],
    loadComponent: () => import('./pages/admin-config').then((m) => m.DiasporaAdminConfigPage),
  },
  { path: '**', redirectTo: 'home' },
];
