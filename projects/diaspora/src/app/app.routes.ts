import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./pages/home').then((m) => m.DiasporaHomePage) },
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding-welcome').then((m) => m.DiasporaOnboardingWelcomePage) },
  { path: 'onboarding/particulier', loadComponent: () => import('./pages/onboarding').then((m) => m.DiasporaOnboardingPage) },
  { path: 'onboarding/entreprise', loadComponent: () => import('./pages/onboarding-enterprise').then((m) => m.DiasporaOnboardingEnterprisePage) },
  { path: 'status', loadComponent: () => import('./pages/status').then((m) => m.DiasporaStatusPage) },
  { path: 'admin/parametrage', loadComponent: () => import('./pages/admin-config').then((m) => m.DiasporaAdminConfigPage) },
  { path: '**', redirectTo: 'home' },
];
