import { InjectionToken } from '@angular/core';

/**
 * Préfixe de base des routes de promote.
 * - Standalone (:4201) : '' → promote est monté à la racine (/login, /admin…).
 * - Fédération (shell)  : '/promote' → promote est monté sous /promote.
 *
 * Fourni dans `remote.routes.ts` (fédération) ; valeur par défaut '' en standalone.
 * Permet aux guards et au login de construire des URLs absolues correctes dans
 * les deux contextes, sans coupler le code à la structure du shell.
 */
export const PROMOTE_BASE = new InjectionToken<string>('PROMOTE_BASE', {
  factory: () => '',
});

/** Construit une URL absolue promote à partir d'un chemin ('/login' -> '/promote/login'). */
export function promoteUrl(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}
