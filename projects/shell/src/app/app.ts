import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Host shell nu : chaque remote (diaspora hub, promote) fournit son propre
 * layout plein écran + en-tête. Le shell ne fait qu'orchestrer la fédération
 * et partager la session (SSO via ClientAuthStore, provisionné au bootstrap).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
