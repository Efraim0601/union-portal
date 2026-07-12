import { Routes } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes as promoteRoutes } from './app.routes';
import { tokenInterceptor } from './core/token-interceptor';
import { App } from './app';
import { PROMOTE_BASE } from './core/base';
import { Api } from './core/api';
import { Auth } from './core/auth';

/**
 * Routes exposées au HOST via Native Federation ('./Routes').
 *
 * La fédération ne charge QUE ces routes, pas le composant racine `App` de
 * promote. Or les pages de promote sont conçues pour vivre à l'intérieur du
 * cadre de `App` : la topbar fixe (38px) et le conteneur `.app-shell`
 * (min-height:100vh; flex column; padding-top:38px). Sans ce cadre, les
 * `position:sticky;top:38px` et les `flex:1` des pages s'effondrent.
 *
 * On réutilise donc `App` comme COMPOSANT DE LAYOUT parent : les pages
 * rendent dans son <router-outlet> et retrouvent exactement leur cadre,
 * que promote soit servi seul (:4201) ou chargé dans le shell (:4200).
 */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideHttpClient(withInterceptors([tokenInterceptor])),
      { provide: PROMOTE_BASE, useValue: '/promote' },
      // Fournis ici (et non `providedIn: 'root'`) pour que `Api`/`Auth` héritent
      // du HttpClient intercepté ci-dessus. Sinon, en fédération, ils seraient liés
      // à l'injecteur racine du shell (sans intercepteur) → 403 partout.
      Api,
      Auth,
    ],
    component: App,
    children: promoteRoutes,
  },
];
