import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { OnbSectionCard, OnbStepNav } from '../ui/section-card';
import { OnbFormField, OnbInput } from '../ui/form-field';
import { DiasporaApi } from '../core/diaspora-api.service';
import { AdminAuth } from '../core/admin-auth';

/**
 * Connexion admin diaspora — protège /admin/parametrage. Passe par /api/admin/login, mocké en
 * dev uniquement (cf. mock-api.interceptor.ts) tant qu'aucun vrai backend d'authentification
 * n'existe pour ce projet ; en déploiement réel, sans backend, la connexion échoue simplement
 * (aucun accès possible), ce qui est le comportement de repli souhaité.
 */
@Component({
  selector: 'diaspora-admin-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="width:100%;max-width:420px;">
        <div style="margin-bottom:20px;text-align:center;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#C8102E;text-transform:uppercase;margin-bottom:6px;">
            Diaspora · Paramétrage admin
          </div>
          <h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:24px;font-weight:500;color:#151821;margin:0;">
            Connexion
          </h1>
        </div>

        <onb-section-card>
          <form (submit)="onSubmit($event)" style="display:grid;gap:16px;">
            <onb-form-field label="E-mail" required>
              <input onbInput type="email" [value]="email()" (input)="email.set($any($event.target).value)" required />
            </onb-form-field>
            <onb-form-field label="Mot de passe" required>
              <input onbInput type="password" [value]="password()" (input)="password.set($any($event.target).value)" required />
            </onb-form-field>
            @if (error()) { <p style="font-size:12px;color:#C8102E;margin:0;">{{ error() }}</p> }
            <onb-step-nav [onBack]="false" submitLabel="Se connecter" [isLoading]="loading()" />
          </form>
        </onb-section-card>

        <div style="margin-top:16px;padding:12px 14px;border-radius:8px;background:rgba(20,20,30,0.04);border:1px solid rgba(20,20,30,0.08);">
          <p style="font-size:11.5px;color:#6B7280;line-height:1.5;margin:0;">
            Identifiants de dev (mock local, tant qu'aucun vrai backend n'est branché) :<br>
            <strong>admin&#64;diaspora.local</strong> / <strong>Diaspora-Admin-2026!</strong>
          </p>
        </div>
      </div>
    </div>
  `,
})
export class DiasporaAdminLoginPage {
  private api = inject(DiasporaApi);
  private auth = inject(AdminAuth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = signal('');
  password = signal('');
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit(e: Event): void {
    e.preventDefault();
    this.loading.set(true);
    this.error.set(null);
    this.api.adminLogin(this.email(), this.password()).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.auth.setSession(res.token, new Date(res.expires_at).getTime());
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/admin/parametrage';
        this.router.navigateByUrl(returnUrl);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Identifiants invalides.');
      },
    });
  }
}
