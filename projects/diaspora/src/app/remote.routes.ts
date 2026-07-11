import { Routes } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes as diasporaRoutes } from './app.routes';

/**
 * Routes exposées au HOST via Native Federation ('./Routes').
 * Fournit HttpClient au niveau feature pour que diaspora fonctionne servi seul
 * (:4202) comme chargé dans le shell.
 */
export const routes: Routes = [
  {
    path: '',
    providers: [provideHttpClient()],
    children: diasporaRoutes,
  },
];
