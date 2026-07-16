import { Component } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Route alternative (optionnelle) : embarque le parcours d'ouverture de compte "legacy"
 * FastAPI (page `open-account-flow-test`, avec sa capture caméra/OCR autonome) dans une
 * iframe, sans changer d'origine ni de port pour l'utilisateur.
 *
 * Ce composant est ADDITIF : il ne remplace pas le parcours Angular natif (welcome /
 * particulier / entreprise). Il permet de réutiliser tel quel le flux legacy tant que sa
 * réécriture Angular n'est pas terminée.
 *
 * URL cible, par ordre de priorité :
 *   1. `window.__LEGACY_ONBOARDING_URL__` (surcharge runtime, pratique en dev :
 *      ex. `http://localhost:8010/open-account-flow-test`) ;
 *   2. sinon un chemin relatif même-origine (le reverse proxy sert le flux legacy sur le
 *      même domaine), par défaut `/open-account-flow-test`.
 */
const DEFAULT_LEGACY_ONBOARDING_URL = '/open-account-flow-test';

function resolveLegacyUrl(): string {
  const override = (globalThis as unknown as { __LEGACY_ONBOARDING_URL__?: string })
    .__LEGACY_ONBOARDING_URL__;
  return override && override.trim() ? override : DEFAULT_LEGACY_ONBOARDING_URL;
}

@Component({
  selector: 'onb-legacy-onboarding',
  standalone: true,
  template: `
    <iframe
      class="legacy-frame"
      [src]="url"
      title="Ouverture de compte à distance"
      allow="camera; microphone; geolocation; fullscreen"
      referrerpolicy="no-referrer-when-downgrade"></iframe>
  `,
  styles: [`
    :host { display:block; }
    .legacy-frame {
      display:block;
      border:0;
      width:100%;
      /* Grande zone : le parcours legacy gère son propre défilement interne. */
      height:100vh;
      min-height:85vh;
    }
  `],
})
export class DiasporaLegacyOnboardingPage {
  readonly url: SafeResourceUrl;

  constructor(sanitizer: DomSanitizer) {
    this.url = sanitizer.bypassSecurityTrustResourceUrl(resolveLegacyUrl());
  }
}
