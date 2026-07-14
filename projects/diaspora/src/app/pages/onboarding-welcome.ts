import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { siblingUrl } from '../core/nav';

/**
 * Écran de bienvenue affiché après « Créer un compte » : message d'accueil puis choix du
 * type de client (particulier / entreprise), avant d'entrer dans le tunnel d'étapes.
 */
@Component({
  selector: 'diaspora-onboarding-welcome',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="min-height:100vh;background:#FFFAF6;font-family:'Inter',system-ui,sans-serif;">
      <header style="background:#fff;border-bottom:1px solid rgba(20,20,30,0.08);padding:14px 7%;">
        <a (click)="goHome($event)" style="cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:10px;width:fit-content;">
          <span style="display:inline-flex;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#C8102E,#8f0e15);color:#fff;align-items:center;justify-content:center;font-weight:800;">A</span>
          <span style="font-family:'Source Serif 4',Georgia,serif;font-size:16px;color:#C8102E;">Ouverture de compte</span>
        </a>
      </header>

      <main style="max-width:900px;margin:0 auto;padding:48px 20px 64px;">
        <div style="background:#fff;border:1px solid rgba(20,20,30,0.08);border-radius:20px;padding:40px;box-shadow:0 18px 45px rgba(20,20,30,0.06);margin-bottom:28px;">
          <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#C8102E;margin-bottom:14px;">
            Bienvenue
          </span>
          <h1 style="margin:0;font-family:'Source Serif 4',Georgia,serif;font-weight:500;font-size:clamp(26px,3.6vw,38px);line-height:1.15;letter-spacing:-0.6px;color:#151821;">
            Ouvrez votre compte Afriland First Bank, où que vous soyez.
          </h1>
          <p style="margin:16px 0 0;color:#6B7280;line-height:1.7;font-size:15px;max-width:640px;">
            Ce parcours 100% digital vous guide étape par étape : vérification WhatsApp,
            capture de vos documents, puis validation de votre dossier par nos équipes conformité.
            Pour commencer, indiquez le type de compte que vous souhaitez ouvrir.
          </p>
        </div>

        <div style="display:grid;gap:18px;grid-template-columns:repeat(2,minmax(0,1fr));" class="dsp-choice-grid">
          <article style="background:#fff;border:1px solid rgba(20,20,30,0.08);border-radius:20px;padding:26px 24px;box-shadow:0 10px 25px rgba(20,20,30,0.05);display:flex;flex-direction:column;justify-content:space-between;gap:18px;">
            <div>
              <span style="display:flex;width:52px;height:52px;border-radius:16px;background:#FFF3E6;align-items:center;justify-content:center;font-size:26px;margin-bottom:14px;">👤</span>
              <h3 style="margin:0 0 8px;font-family:'Source Serif 4',Georgia,serif;font-weight:500;font-size:19px;color:#151821;">Compte personnel</h3>
              <p style="margin:0;color:#6B7280;font-size:13.5px;line-height:1.55;">
                Pour une personne physique résidant au Cameroun ou à l'étranger.
              </p>
            </div>
            <button type="button" (click)="choose('PARTICULIER')"
              style="width:100%;box-sizing:border-box;display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:48px;padding:12px 16px;border-radius:12px;border:none;background:#C8102E;color:#fff;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;box-shadow:0 10px 22px rgba(200,16,46,0.22);">
              Continuer
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </article>

          <article style="background:#fff;border:1px solid rgba(20,20,30,0.08);border-radius:20px;padding:26px 24px;box-shadow:0 10px 25px rgba(20,20,30,0.05);display:flex;flex-direction:column;justify-content:space-between;gap:18px;">
            <div>
              <span style="display:flex;width:52px;height:52px;border-radius:16px;background:#FFF3E6;align-items:center;justify-content:center;font-size:26px;margin-bottom:14px;">🏢</span>
              <h3 style="margin:0 0 8px;font-family:'Source Serif 4',Georgia,serif;font-weight:500;font-size:19px;color:#151821;">Compte entreprise</h3>
              <p style="margin:0;color:#6B7280;font-size:13.5px;line-height:1.55;">
                Pour une société, une association ou tout autre client professionnel.
              </p>
            </div>
            <button type="button" (click)="choose('ENTREPRISE')"
              style="width:100%;box-sizing:border-box;display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:48px;padding:12px 16px;border-radius:12px;border:1.5px solid rgba(200,16,46,0.30);background:rgba(200,16,46,0.04);color:#C8102E;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;">
              Continuer
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </article>
        </div>
      </main>
    </div>
    <style>
      @media (max-width:640px) { .dsp-choice-grid { grid-template-columns:1fr !important; } }
    </style>
  `,
})
export class DiasporaOnboardingWelcomePage {
  private router = inject(Router);

  choose(type: 'PARTICULIER' | 'ENTREPRISE'): void {
    // Préfixe de montage déduit dynamiquement de l'URL active : reste correct que diaspora
    // soit servi seul (/onboarding) ou fédéré sous /diaspora via le shell (un chemin absolu
    // codé en dur casserait la navigation dans l'un des deux cas, cf. NG04002 / retour à l'accueil).
    const target = type === 'PARTICULIER' ? '/onboarding/particulier' : '/onboarding/entreprise';
    this.router.navigateByUrl(siblingUrl(this.router, '/onboarding', target));
  }

  goHome(e: Event): void {
    e.preventDefault();
    this.router.navigateByUrl(siblingUrl(this.router, '/onboarding', '/home'));
  }
}
