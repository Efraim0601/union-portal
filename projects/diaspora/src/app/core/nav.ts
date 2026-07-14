import { Router } from '@angular/router';

/**
 * Construit l'URL d'une route « voisine » (même niveau de montage) sans jamais coder en dur
 * un préfixe absolu. Indispensable ici car ce remote est monté à la racine en standalone
 * (`/onboarding`) mais sous `/diaspora` quand chargé par le shell fédéré (`/diaspora/onboarding`) —
 * un chemin absolu codé en dur ne peut être correct que dans un seul des deux cas.
 *
 * `currentSuffix` doit être le suffixe de route de la page APPELANTE (ex. '/onboarding'),
 * `targetSuffix` la route voisine visée (ex. '/onboarding/particulier'). Le préfixe de montage
 * est déduit en retirant `currentSuffix` de la fin de l'URL active.
 */
export function siblingUrl(router: Router, currentSuffix: string, targetSuffix: string): string {
  const path = router.url.split('?')[0].split('#')[0];
  const prefix = path.endsWith(currentSuffix) ? path.slice(0, -currentSuffix.length) : '';
  return `${prefix}${targetSuffix}`;
}
