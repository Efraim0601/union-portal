import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { Role } from '../core/models';
import { PROMOTE_BASE, promoteUrl } from '../core/base';

/** Landing route per role after a successful staff login. */
function landingFor(roles: Role[]): string {
  if (roles.includes('ADMIN')) return '/admin';
  if (roles.includes('MANAGER') || roles.includes('CHEF_EQUIPE')) return '/manager';
  if (roles.includes('SUPERVISEUR')) return '/supervision';
  if (roles.includes('CASHIER')) return '/cashier';
  if (roles.includes('PRINT_AGENT')) return '/print';
  if (roles.includes('COLLECTEUR')) return '/collecte';
  if (roles.includes('AGENT')) return '/dashboard';
  return '/home';
}

@Component({
  selector: 'app-login',
  template: `
    <div class="login-bg screen screen-pad">
      <div style="width:100%;max-width:400px" class="slide-up">
        <!-- Logo area -->
        <div style="text-align:center;margin-bottom:32px">
          <div class="brand-logo" style="width:56px;height:56px;margin-bottom:12px">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
              <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"></path>
            </svg>
          </div>
          <div style="font-size:20px;font-weight:800;color:var(--navy);letter-spacing:-.3px">Afriland First Bank</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">{{ i18n.t('login_title') }}</div>
        </div>

        <!-- Login card -->
        <div class="card" style="padding:28px 24px">
          <div class="field" style="margin-bottom:18px">
            <label class="field-label">{{ i18n.t('login_email') }}</label>
            <input class="input" type="email" [value]="email()" (input)="email.set($any($event.target).value)"
                   placeholder="email@afrilandfirstbank.com" autocomplete="username" />
          </div>

          <div class="field" style="margin-bottom:8px">
            <label class="field-label">{{ i18n.t('login_password') }}</label>
            <div style="position:relative">
              <input class="input" [type]="showPw() ? 'text' : 'password'" [value]="password()"
                     (input)="password.set($any($event.target).value)" (keydown.enter)="submit()"
                     placeholder="••••••••" autocomplete="current-password" style="padding-right:44px" />
              <button type="button" (click)="showPw.set(!showPw())"
                      style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted-2);padding:4px">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
          </div>

          @if (error()) {
            <div class="alert-error shake" style="margin-bottom:12px;margin-top:8px">{{ error() }}</div>
          }
          @if (notice()) {
            <div class="alert-success" style="margin-bottom:12px;margin-top:8px">✓ {{ notice() }}</div>
          }

          <button class="btn btn-primary" style="margin-top:12px" (click)="submit()" [disabled]="loading()">
            {{ loading() ? '…' : i18n.t('login_submit') }}
          </button>
          <button class="btn-ghost" style="width:100%;padding:10px;margin-top:8px" (click)="forgot()">
            {{ i18n.t('login_forgot') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-bg {
      align-items: center;
      justify-content: center;
      background: linear-gradient(160deg, rgba(255,255,255,.80) 0%, rgba(254,242,242,.68) 50%, rgba(247,248,250,.55) 100%);
    }
  `],
})
export class LoginPage {
  protected i18n = inject(I18n);
  private auth = inject(Auth);
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private base = inject(PROMOTE_BASE);

  email = signal('');
  password = signal('');
  showPw = signal(false);
  error = signal('');
  loading = signal(false);
  notice = signal('');

  submit() {
    if (this.loading()) return;
    const email = this.email().trim();
    const pw = this.password();
    if (!email || !pw) {
      this.error.set(this.i18n.t('login_err_required'));
      return;
    }
    this.error.set('');
    this.loading.set(true);
    this.auth.login(email, pw).subscribe({
      next: () => {
        this.auth.refreshMe().subscribe({
          next: (u) => {
            this.loading.set(false);
            const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
            if (u.mustChangePassword) this.router.navigateByUrl(promoteUrl(this.base, '/change-password'));
            else if (returnUrl) this.router.navigateByUrl(returnUrl);
            else this.router.navigateByUrl(promoteUrl(this.base, landingFor(this.auth.roles())));
          },
          error: () => { this.loading.set(false); this.router.navigateByUrl(promoteUrl(this.base, landingFor(this.auth.roles()))); },
        });
      },
      error: () => {
        this.loading.set(false);
        this.error.set(this.i18n.t('login_err_credentials'));
      },
    });
  }

  forgot() {
    const email = this.email().trim();
    if (!email) {
      this.notice.set('');
      this.error.set(this.i18n.t('login_forgot_need_email'));
      return;
    }
    this.error.set('');
    // Always show the same confirmation (never reveal whether the email is registered).
    this.api.forgotPassword(email).subscribe({
      next: () => this.notice.set(this.i18n.t('login_forgot_sent')),
      error: () => this.notice.set(this.i18n.t('login_forgot_sent')),
    });
  }
}
