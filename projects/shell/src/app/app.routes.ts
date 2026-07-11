import { Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';

/**
 * Routes du host : chaque remote est chargé dynamiquement via Native Federation.
 * - /promote/**  -> remote promote (4201), exposé './Routes'
 * - /diaspora/** -> remote diaspora (4202), exposé './Routes'
 */
export const routes: Routes = [
  {
    path: 'promote',
    loadChildren: () =>
      loadRemoteModule('promote', './Routes').then((m) => m.routes),
  },
  {
    path: 'diaspora',
    loadChildren: () =>
      loadRemoteModule('diaspora', './Routes').then((m) => m.routes),
  },
  { path: '', pathMatch: 'full', redirectTo: 'diaspora/home' },
];
