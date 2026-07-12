import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { tokenInterceptor } from './core/token-interceptor';
import { Api } from './core/api';
import { Auth } from './core/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([tokenInterceptor])),
    // `Api`/`Auth` ne sont plus `providedIn: 'root'` (cf. api.ts) : on les fournit
    // ici pour le mode standalone (:4201), au même niveau que le HttpClient intercepté.
    Api,
    Auth,
  ],
};
