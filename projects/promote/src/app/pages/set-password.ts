import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { PROMOTE_BASE, promoteUrl } from '../core/base';

/**
 * Landing page for the one-time link emailed on account creation / password reset. Lets the user
 * define their password DIRECTLY from the token, without signing in first. On success it redirects
 * to /login so they sign in with their brand-new password.
 */
@Component({
  selector: 'app-set-password',
  template: `
    <div class="screen screen-pad" style="align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(255,255,255,.80) 0%,rgba(254,242,242,.68) 50%,rgba(247,248,250,.55) 100%)">
      <div style="width:100%;max-width:380px" class="slide-up">
        <div class="card" style="padding:28px 24px">
          <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:6px">{{ i18n.t('sp_title') }}</div>

          @if (invalid()) {
            <div class="alert-error" style="margin:12px 0">{{ i18n.t('sp_invalid') }}</div>
            <button (click)="goLogin()" class="btn btn-primary">{{ i18n.t('sp_go_login') }}</button>
          } @else if (done()) {
            <div class="alert-success" style="margin:12px 0">✓ {{ i18n.t('sp_done') }}</div>
            <button (click)="goLogin()" class="btn btn-primary">{{ i18n.t('sp_go_login') }}</button>
          } @else {
            @if (email()) {
              <div style="font-size:12px;color:var(--muted);margin-bottom:16px">{{ i18n.t('sp_for') }} <b>{{ email() }}</b></div>
            } @else {
              <div style="font-size:12px;color:var(--muted);margin-bottom:16px">{{ i18n.t('sp_subtitle') }}</div>
            }
            <div class="field"><label class="field-label">{{ i18n.t('pw_new') }}</label><input class="input" type="password" [value]="pwNew()" (input)="pwNew.set(val($event))"><div style="font-size:10px;color:var(--muted-2);margin-top:3px">{{ i18n.t('pw_min8') }}</div></div>
            <div class="field"><label class="field-label">{{ i18n.t('pw_confirm') }}</label><input class="input" type="password" [value]="confirm()" (input)="confirm.set(val($event))"></div>
            @if (error()) { <div class="alert-error" style="margin-bottom:10px">{{ error() }}</div> }
            <button (click)="submit()" class="btn btn-primary" [disabled]="loading()">{{ i18n.t('sp_submit') }}</button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`:host { display:flex;flex:1;flex-direction:column }`],
})
export class SetPasswordPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private base = inject(PROMOTE_BASE);

  private token = '';
  email = signal(''); pwNew = signal(''); confirm = signal('');
  error = signal(''); done = signal(false); loading = signal(false); invalid = signal(false);

  constructor() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) { this.invalid.set(true); return; }
    // Best-effort: show who the link is for; a bad/expired token flips to the invalid state.
    this.api.setupTokenInfo(this.token).subscribe({
      next: (info) => this.email.set(info.email),
      error: () => this.invalid.set(true),
    });
  }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  goLogin() { this.router.navigateByUrl(promoteUrl(this.base, '/login')); }

  submit() {
    this.error.set('');
    if (this.pwNew().length < 8) { this.error.set(this.i18n.t('pw_min8')); return; }
    if (this.pwNew() !== this.confirm()) { this.error.set(this.i18n.t('pw_mismatch')); return; }
    this.loading.set(true);
    this.api.setPassword(this.token, this.pwNew()).subscribe({
      next: () => { this.loading.set(false); this.done.set(true); },
      error: (e) => {
        this.loading.set(false);
        const code = e?.error?.error || e?.error?.message || '';
        if (code === 'invalid_or_expired_token') { this.invalid.set(true); return; }
        this.error.set(this.reason(code));
      },
    });
  }

  private reason(code: string): string {
    return {
      too_short: this.i18n.t('pw_min8'),
      password_too_short: this.i18n.t('pw_min8'),
      invalid_or_expired_token: this.i18n.t('sp_invalid'),
    }[code] || code || 'Erreur';
  }
}
