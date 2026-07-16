import { Routes } from '@angular/router';
import { authGuard } from './core/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./pages/home').then((m) => m.HomePage) },
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  { path: 'set-password', loadComponent: () => import('./pages/set-password').then((m) => m.SetPasswordPage) },
  {
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/change-password').then((m) => m.ChangePasswordPage),
  },
  { path: 'subscribe', loadComponent: () => import('./pages/subscribe').then((m) => m.SubscribePage) },
  { path: 'recharge', loadComponent: () => import('./pages/recharge').then((m) => m.RechargePage) },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'cashier',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/cashier').then((m) => m.CashierPage),
  },
  {
    path: 'print',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/print').then((m) => m.PrintPage),
  },
  {
    path: 'collecte',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/collecte').then((m) => m.CollectePage),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/admin').then((m) => m.AdminPage),
  },
  {
    path: 'manager',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/manager').then((m) => m.ManagerPage),
  },
  {
    path: 'team',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/team').then((m) => m.TeamPage),
  },
  {
    path: 'supervision',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/supervision').then((m) => m.SupervisionPage),
  },
  {
    path: 'prospects',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/prospects').then((m) => m.ProspectsPage),
  },
  {
    path: 'transactions',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/transactions').then((m) => m.TransactionsPage),
  },
  {
    path: 'paylogs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/paylogs').then((m) => m.PaylogsPage),
  },
  {
    path: 'recon',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/recon').then((m) => m.ReconPage),
  },
  { path: '**', redirectTo: 'home' },
];
