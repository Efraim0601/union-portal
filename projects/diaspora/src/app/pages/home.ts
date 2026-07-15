import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

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
        <a routerLink="/diaspora/home" class="brand">
          <span class="brand-mark">A</span>
          <span class="brand-txt">
            <span class="brand-title">Portail d'onboarding client</span>
            <span class="brand-sub">Services bancaires digitaux à distance</span>
          </span>
        </a>
        <nav class="topnav" aria-label="Menu des services">
          <a routerLink="/diaspora/home" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Accueil</a>
          <a routerLink="/diaspora/onboarding" routerLinkActive="active">Ouverture de compte</a>
          <a routerLink="/promote/subscribe" routerLinkActive="active">Souscription produit</a>
          <a routerLink="/promote/recharge" routerLinkActive="active">Recharge de carte</a>
          <a routerLink="/diaspora/status" routerLinkActive="active">Suivre ma demande</a>
        </nav>
        <a routerLink="/promote/partners" class="staff-access" title="Portails partenaires : Gestion de vos encaissements, Portail vente produit">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Espace partenaires
        </a>
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
              <a class="btn-primary" routerLink="/diaspora/onboarding">
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
    .brand-mark {
      width:42px; height:42px; border-radius:12px; flex:0 0 auto;
      background:linear-gradient(135deg,#C8102E,#8f0e15); color:#fff;
      display:flex; align-items:center; justify-content:center;
      font-weight:800; font-size:19px; box-shadow:0 8px 20px rgba(200,16,46,0.22);
    }
    .brand-txt { display:flex; flex-direction:column; }
    .brand-title { font-family:'Source Serif 4',Georgia,serif; font-size:16px; color:#C8102E; letter-spacing:-0.2px; }
    .brand-sub { font-size:12px; color:#6B7280; margin-top:1px; }

    .topnav { display:flex; align-items:center; gap:4px; flex:1 1 auto; justify-content:flex-end; flex-wrap:wrap; }
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
      .topnav { justify-content:flex-start; width:100%; overflow-x:auto; }
      .brand-sub { display:none; }
    }
  `],
})
export class DiasporaHomePage {}
