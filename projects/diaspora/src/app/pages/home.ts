import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { siblingUrl } from '../core/nav';
import { AFB_LOGO_DATA_URI } from '../shared/afb-logo';

/**
 * Hub de services — reproduit la page d'accueil de l'app diaspora-onboarding
 * (topnav + hero + 3 cartes de service) au visuel de portal-client-firstpay
 * (Source Serif 4, Inter, rouge #C8102E, cartes radius 20).
 *
 * Les cartes « Souscription » et « Recharge » pointent vers les fonctionnalités
 * réelles de l'app PROMOTE via la fédération (routes absolues du shell) :
 *   • Ouverture de compte  -> /diaspora/onboarding   (parcours diaspora)
 *   • Souscrire une carte   -> /promote/subscribe     (funnel produit promote)
 *   • Recharger ma carte    -> /promote/recharge      (recharge promote)
 *   • Suivre ma demande     -> /diaspora/status
 *
 * Les liens internes à diaspora (home/onboarding/status) sont résolus dynamiquement via
 * `diasporaBase` (cf. siblingUrl) au lieu du préfixe `/diaspora` codé en dur : ce dernier ne
 * pointe nulle part quand diaspora est servi seul (`ng serve diaspora`, sans le préfixe de
 * montage posé par le shell) — cf. NG04002 déjà documenté sur onboarding-welcome.ts/onboarding.ts.
 * Les liens `/promote/...` restent en dur : diaspora seul ne peut de toute façon pas les résoudre.
 */
@Component({
  selector: 'diaspora-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="hub">
      <!-- ═══════════ Topbar ═══════════ -->
      <header class="topbar">
        <a [routerLink]="diasporaBase + '/home'" class="brand" (click)="closeMenu()">
          <img class="brand-logo" [src]="afbLogo" width="405" height="124" alt="Afriland First Bank" />
          <span class="brand-tag">Portail d'onboarding client</span>
        </a>

        <button type="button" class="menu-toggle" [class.open]="menuOpen()"
                (click)="toggleMenu()" aria-controls="site-menu"
                [attr.aria-expanded]="menuOpen()"
                [attr.aria-label]="menuOpen() ? 'Fermer le menu' : 'Ouvrir le menu'">
          <span></span><span></span><span></span>
        </button>

        <div id="site-menu" class="menu" [class.open]="menuOpen()">
          <nav class="topnav" aria-label="Menu des services">
            <a [routerLink]="diasporaBase + '/home'" (click)="closeMenu()" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Accueil</a>
            <a [routerLink]="diasporaBase + '/onboarding'" (click)="closeMenu()" routerLinkActive="active">Ouverture de compte</a>
            <a routerLink="/promote/subscribe" (click)="closeMenu()" routerLinkActive="active">Souscription produit</a>
            <a routerLink="/promote/recharge" (click)="closeMenu()" routerLinkActive="active">Recharge de carte</a>
            <a [routerLink]="diasporaBase + '/status'" (click)="closeMenu()" routerLinkActive="active">Suivre ma demande</a>
          </nav>
          <a routerLink="/promote/partners" class="staff-access" (click)="closeMenu()" title="Portails partenaires : Gestion de vos encaissements, Portail vente produit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Espace partenaires
          </a>
        </div>
      </header>

      <main>
        <!-- ═══════════ Hero ═══════════ -->
        <section class="hero">
          <div class="hero-main">
            <span class="eyebrow">§ Services bancaires en ligne</span>
            <h1 class="hero-h1">Comment pouvons-nous <span>vous accompagner&nbsp;?</span></h1>
            <p class="hero-p">
              Sélectionnez le service bancaire souhaité&nbsp;: ouvrez un compte à distance,
              souscrivez à une carte ou rechargez-la, le tout depuis l'étranger.
            </p>
          </div>
          <aside class="hero-side">
            <h3>Espace client</h3>
            <p>
              Retrouvez ici les principaux services disponibles pour préparer une demande,
              accéder à un service bancaire ou suivre l'avancement de votre dossier.
            </p>
          </aside>
        </section>

        <!-- ═══════════ Services ═══════════ -->
        <section class="section">
          <div class="section-title">
            <h3>Services disponibles</h3>
            <p>Choisissez le service qui correspond à votre besoin.</p>
          </div>

          <div class="services-grid">
            <!-- Carte 1 — Ouverture de compte (parcours diaspora) -->
            <article class="svc-card">
              <div>
                <div class="svc-top">
                  <span class="svc-icon">🏦</span>
                  <span class="svc-num">§ 01</span>
                </div>
                <span class="badge ready">Disponible</span>
                <h4>Démarrer une ouverture de compte à distance</h4>
                <p>Préparez une demande d'ouverture de compte avec les informations et documents nécessaires.</p>
              </div>
              <a class="btn-primary" [routerLink]="diasporaBase + '/onboarding'">
                Créer un compte
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </a>
            </article>

            <!-- Carte 2 — Souscription carte (PROMOTE /subscribe) -->
            <article class="svc-card">
              <div>
                <div class="svc-top">
                  <span class="svc-icon">💳</span>
                  <span class="svc-num">§ 02</span>
                </div>
                <span class="badge ready">Disponible</span>
                <h4>Souscrire à un produit</h4>
                <p>Choisissez votre produit bancaire, renseignez vos informations et souscrivez en ligne en quelques étapes.</p>
              </div>
              <a class="btn-primary" routerLink="/promote/subscribe">
                Souscrire
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </a>
            </article>

            <!-- Carte 3 — Recharge carte (PROMOTE /recharge) -->
            <article class="svc-card">
              <div>
                <div class="svc-top">
                  <span class="svc-icon">🔁</span>
                  <span class="svc-num">§ 03</span>
                </div>
                <span class="badge ready">Disponible</span>
                <h4>Recharger ma carte</h4>
                <p>Rechargez votre carte via les canaux autorisés (Orange Money, MTN MoMo, carte).</p>
              </div>
              <a class="btn-primary" routerLink="/promote/recharge">
                Recharger
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </a>
            </article>
          </div>
        </section>
      </main>

      <footer class="footer">
        <span>© Afriland First Bank — Portail digital client</span>
        <a routerLink="/promote/login" class="footer-link">Accès personnel Afriland</a>
      </footer>
    </div>
  `,
  styles: [`
    :host { display:block; }
    .hub {
      min-height:100vh; background:#FFFAF6; color:#151821;
      font-family:'Inter',system-ui,sans-serif; display:flex; flex-direction:column;
    }

    /* Topbar */
    .topbar {
      background:#fff; border-bottom:1px solid rgba(20,20,30,0.08);
      padding:14px 7%; display:flex; align-items:center; gap:24px;
      position:sticky; top:0; z-index:1000; flex-wrap:wrap;
    }
    .brand { display:flex; align-items:center; gap:14px; text-decoration:none; flex:0 0 auto; }
    .brand-logo { height:38px; width:auto; display:block; }
    .brand-tag {
      font-size:13px; color:#6B7280; font-weight:600; white-space:nowrap;
      padding-left:14px; border-left:1px solid rgba(20,20,30,0.14);
    }

    /* Bouton hamburger — masqué en desktop, révélé sous 900px */
    .menu-toggle {
      display:none; flex:0 0 auto; margin-left:auto;
      width:44px; height:44px; padding:0;
      flex-direction:column; align-items:center; justify-content:center; gap:5px;
      background:#fff; border:1px solid rgba(20,20,30,0.12); border-radius:11px; cursor:pointer;
      transition:border-color .15s ease;
    }
    .menu-toggle:hover { border-color:rgba(200,16,46,0.35); }
    .menu-toggle span { display:block; width:21px; height:2px; background:#151821; border-radius:2px; transition:transform .22s ease, opacity .18s ease; }
    .menu-toggle.open span:nth-child(1) { transform:translateY(7px) rotate(45deg); }
    .menu-toggle.open span:nth-child(2) { opacity:0; }
    .menu-toggle.open span:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }

    /* Conteneur nav + accès collaborateur (devient le tiroir mobile) */
    .menu { display:flex; align-items:center; gap:16px; flex:1 1 auto; justify-content:flex-end; }

    .topnav { display:flex; align-items:center; gap:4px; flex:0 1 auto; flex-wrap:wrap; }
    .topnav a {
      text-decoration:none; color:#374151; font-weight:600; font-size:13.5px;
      padding:8px 14px; border-radius:999px; white-space:nowrap; transition:.15s ease;
    }
    .topnav a:hover { background:rgba(200,16,46,0.08); color:#C8102E; }
    .topnav a.active { background:#C8102E; color:#fff; }

    .staff-access {
      display:inline-flex; align-items:center; gap:7px; flex:0 0 auto;
      text-decoration:none; padding:8px 14px; border-radius:999px;
      border:1.5px solid rgba(200,16,46,0.30); background:rgba(200,16,46,0.04);
      color:#C8102E; font-size:12.5px; font-weight:700; white-space:nowrap;
      transition:.15s ease;
    }
    .staff-access:hover { background:#C8102E; color:#fff; border-color:#C8102E; }

    /* Hero */
    main { flex:1; }
    .hero {
      padding:48px 7% 24px; display:grid; grid-template-columns:1.2fr 0.8fr;
      gap:24px; align-items:stretch;
    }
    .hero-main {
      background:#fff; border:1px solid rgba(20,20,30,0.08); border-radius:20px;
      padding:40px; box-shadow:0 18px 45px rgba(20,20,30,0.06);
    }
    .eyebrow {
      display:inline-block; font-size:11px; font-weight:700; letter-spacing:1.8px;
      text-transform:uppercase; color:#6B7280; margin-bottom:16px;
    }
    .hero-h1 {
      margin:0; font-family:'Source Serif 4',Georgia,serif; font-weight:500;
      font-size:clamp(30px,4.4vw,50px); line-height:1.05; letter-spacing:-1px; color:#151821;
    }
    .hero-h1 span { color:#C8102E; }
    .hero-p { margin:18px 0 0; color:#6B7280; line-height:1.7; font-size:15.5px; max-width:640px; }
    .hero-side {
      background:linear-gradient(160deg,#C8102E,#7c0c17); color:#fff;
      border-radius:20px; padding:30px; box-shadow:0 18px 45px rgba(200,16,46,0.18);
      display:flex; flex-direction:column; justify-content:center;
    }
    .hero-side h3 { margin:0 0 14px; font-family:'Source Serif 4',Georgia,serif; font-weight:500; font-size:22px; }
    .hero-side p { margin:0; color:rgba(255,255,255,0.9); line-height:1.7; font-size:14.5px; }

    /* Section services */
    .section { padding:24px 7% 64px; }
    .section-title { margin-bottom:22px; }
    .section-title h3 { margin:0; font-family:'Source Serif 4',Georgia,serif; font-weight:500; font-size:26px; color:#151821; letter-spacing:-0.4px; }
    .section-title p { margin:6px 0 0; color:#6B7280; font-size:14px; }

    .services-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; }
    .svc-card {
      background:#fff; border:1px solid rgba(20,20,30,0.08); border-radius:20px;
      padding:24px 22px 22px; min-height:250px;
      box-shadow:0 10px 25px rgba(20,20,30,0.05);
      display:flex; flex-direction:column; justify-content:space-between;
      transition:transform .22s ease, box-shadow .22s ease;
    }
    .svc-card:hover { transform:translateY(-3px); box-shadow:0 24px 64px rgba(20,20,30,0.13); }
    .svc-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
    .svc-icon {
      width:52px; height:52px; border-radius:16px; background:#FFF3E6;
      display:flex; align-items:center; justify-content:center; font-size:26px;
    }
    .svc-num { font-size:9.5px; font-weight:700; letter-spacing:1.6px; color:#C8102E; text-transform:uppercase; }
    .badge {
      display:inline-flex; align-items:center; width:fit-content;
      padding:4px 9px; border-radius:999px; font-size:10.5px; font-weight:800;
      text-transform:uppercase; letter-spacing:.04em; margin-bottom:12px;
    }
    .badge.ready { background:#dcfce7; color:#166534; }
    .svc-card h4 {
      margin:0 0 8px; font-family:'Source Serif 4',Georgia,serif; font-weight:500;
      font-size:18px; color:#151821; line-height:1.25; letter-spacing:-0.2px;
    }
    .svc-card p { margin:0; color:#6B7280; line-height:1.55; font-size:13px; }
    .btn-primary {
      margin-top:20px; width:100%; box-sizing:border-box;
      display:inline-flex; justify-content:center; align-items:center; gap:8px;
      min-height:48px; padding:12px 16px; border-radius:12px; text-decoration:none;
      background:#C8102E; color:#fff; font-size:13px; font-weight:600;
      letter-spacing:1px; text-transform:uppercase;
      box-shadow:0 10px 22px rgba(200,16,46,0.22); transition:opacity .15s ease, transform .12s ease;
    }
    .btn-primary:hover { opacity:.92; }
    .btn-primary:active { transform:scale(.98); }

    .footer {
      padding:22px 7%; border-top:1px solid rgba(20,20,30,0.08); color:#6B7280;
      font-size:13px; background:#fff; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;
    }
    .footer-link { color:#C8102E; text-decoration:none; font-weight:600; }
    .footer-link:hover { text-decoration:underline; }

    /* Responsive */
    @media (max-width:900px) {
      .hero { grid-template-columns:1fr; }
      .services-grid { grid-template-columns:1fr; }

      .topbar { flex-wrap:nowrap; }
      .menu-toggle { display:flex; }
      .brand-tag { display:none; }

      /* Le menu se replie en tiroir déroulant sous l'en-tête */
      .menu {
        position:absolute; top:100%; left:0; right:0;
        flex-direction:column; align-items:stretch; gap:6px;
        padding:12px 7% 16px; background:#fff;
        border-bottom:1px solid rgba(20,20,30,0.08);
        box-shadow:0 16px 30px rgba(20,20,30,0.10);
        max-height:calc(100vh - 72px); overflow-y:auto;
        display:none;
      }
      .menu.open { display:flex; }

      .topnav { flex-direction:column; align-items:stretch; gap:4px; width:100%; }
      .topnav a { padding:12px 14px; border-radius:10px; font-size:14.5px; }
      .staff-access { width:100%; justify-content:center; padding:12px 14px; font-size:13.5px; }
    }
  `],
})
export class DiasporaHomePage {
  private router = inject(Router);
  /** Préfixe de montage déduit dynamiquement (cf. commentaire de classe) — '' en standalone, '/diaspora' sous le shell. */
  readonly diasporaBase = siblingUrl(this.router, '/home', '');
  /** Logo Afriland inliné (data URI partagé) — cf. shared/afb-logo. */
  readonly afbLogo = AFB_LOGO_DATA_URI;

  /** Ouverture du tiroir de navigation mobile (bouton hamburger). */
  readonly menuOpen = signal(false);
  toggleMenu(): void { this.menuOpen.update((v) => !v); }
  closeMenu(): void { this.menuOpen.set(false); }
}
