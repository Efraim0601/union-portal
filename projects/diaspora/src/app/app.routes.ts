import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./pages/home').then((m) => m.DiasporaHomePage) },
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding').then((m) => m.DiasporaOnboardingPage) },
  { path: 'status', loadComponent: () => import('./pages/status').then((m) => m.DiasporaStatusPage) },
  { path: '**', redirectTo: 'home' },
];
