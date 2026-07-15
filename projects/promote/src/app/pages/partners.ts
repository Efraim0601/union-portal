import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PROMOTE_BASE, promoteUrl } from '../core/base';

/**
 * Espace partenaires — passerelle de connexion.
 *
 * Point d'entrée unique vers les portails partenaires Afriland : depuis ici on
 * accède soit à la Gestion de vos encaissements (application externe de
 * signature/collecte), soit au Portail vente produit (espace personnel Afriland :
 * souscription, ventes, gestion).
 *
 * Remplace l'ancien lien « Espace collaborateur » (qui menait directement à
 * /promote/login) : la topbar diaspora pointe désormais sur cette page.
 */
@Component({
  selector: 'app-partners',
  template: `
    <div class="home-bg screen" style="align-items:center;padding:40px 16px 24px">
      <div style="width:100%;max-width:460px" class="slide-up">
        <!-- Logo -->
        <div style="text-align:center;margin-bottom:32px">
          <div class="brand-logo" style="width:52px;height:52px;margin-bottom:10px">
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
              <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"></path>
            </svg>
          </div>
          <div style="font-size:22px;font-weight:800;color:var(--navy);letter-spacing:-.3px">Espace partenaires</div>
          <div style="font-size:14px;color:var(--muted);margin-top:4px">Choisissez votre portail de connexion</div>
        </div>

        <!-- Portails -->
        <div style="display:flex;flex-direction:column;gap:14px">
          <!-- Gestion de vos encaissements (externe) -->
          <a class="action-card" [href]="encaissementsUrl" target="_blank" rel="noopener noreferrer">
            <div class="action-ic" style="background:linear-gradient(135deg,#1B1B2F,#3A3A5A)">
              <svg width="24" height="24" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
                <path d="M9 11l3 3L22 4"></path>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:700;color:var(--navy)">Gestion de vos encaissements</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">Signature électronique & collecte — se connecter à la gestion de vos encaissements</div>
            </div>
            <svg width="18" height="18" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"></path></svg>
          </a>

          <!-- Portail vente produit (interne) -->
          <button class="action-card" (click)="goPromote()">
            <div class="action-ic" style="background:linear-gradient(135deg,#C8102E,#8B0000)">
              <svg width="24" height="24" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:700;color:var(--navy)">Portail vente produit</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">Espace personnel Afriland — souscription, ventes, gestion</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"></path></svg>
          </button>
        </div>

        <!-- Retour accueil -->
        <div style="text-align:center;margin-top:32px">
          <button class="btn-ghost" (click)="goHome()">Retour à l'accueil</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .home-bg {
      background: linear-gradient(160deg, rgba(255,255,255,.80) 0%, rgba(254,242,242,.68) 40%, rgba(247,248,250,.55) 100%);
    }
    .action-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px;
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: var(--radius-lg);
      cursor: pointer;
      text-align: left;
      text-decoration: none;
      transition: all .25s;
      width: 100%;
    }
    .action-card:hover { border-color: var(--primary); box-shadow: 0 4px 20px rgba(200, 16, 46, .1); }
    .action-card:active { transform: scale(.98); }
    .action-ic {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `],
})
export class PartnersPage {
  private router = inject(Router);
  private base = inject(PROMOTE_BASE);

  /** Portail externe « Gestion de vos encaissements » (signature électronique / collecte). */
  protected readonly encaissementsUrl = 'https://esign.afbdei.com/login';

  goPromote() {
    this.router.navigateByUrl(promoteUrl(this.base, '/login'));
  }

  goHome() {
    this.router.navigateByUrl(promoteUrl(this.base, '/home'));
  }
}
