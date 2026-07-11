import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { PROMOTE_BASE, promoteUrl } from '../core/base';

@Component({
  selector: 'app-change-password',
  template: `
    <div class="screen screen-pad" style="align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(255,255,255,.80) 0%,rgba(254,242,242,.68) 50%,rgba(247,248,250,.55) 100%)">
      <div style="width:100%;max-width:380px" class="slide-up">
        <div class="card" style="padding:28px 24px">
          @if (forced()) {
            <div class="alert-error" style="margin-bottom:14px">{{ i18n.t('pw_forced') }}</div>
          }
          <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:16px">{{ i18n.t('pw_change') }}</div>
          <div class="field"><label class="field-label">{{ i18n.t('pw_current') }}</label><input class="input" type="password" [value]="current()" (input)="current.set(val($event))"></div>
          <div class="field"><label class="field-label">{{ i18n.t('pw_new') }}</label><input class="input" type="password" [value]="pwNew()" (input)="pwNew.set(val($event))"><div style="font-size:10px;color:var(--muted-2);margin-top:3px">{{ i18n.t('pw_min8') }}</div></div>
          <div class="field"><label class="field-label">{{ i18n.t('pw_confirm') }}</label><input class="input" type="password" [value]="confirm()" (input)="confirm.set(val($event))"></div>
          @if (error()) { <div class="alert-error" style="margin-bottom:10px">{{ error() }}</div> }
          @if (done()) { <div class="alert-success" style="margin-bottom:10px">✓ {{ i18n.t('pw_changed') }}</div> }
          <button (click)="submit()" class="btn btn-primary" [disabled]="loading()">{{ i18n.t('pw_change') }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`:host { display:flex;flex:1;flex-direction:column }`],
})
export class ChangePasswordPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  private base = inject(PROMOTE_BASE);

  current = signal(''); pwNew = signal(''); confirm = signal('');
  error = signal(''); done = signal(false); loading = signal(false);
  forced = signal(!!this.auth.user()?.mustChangePassword);

  val(e: Event) { return (e.target as HTMLInputElement).value; }

  submit() {
    this.error.set('');
    if (this.pwNew().length < 8) { this.error.set(this.i18n.t('pw_min8')); return; }
    if (this.pwNew() !== this.confirm()) { this.error.set(this.i18n.t('pw_mismatch')); return; }
    this.loading.set(true);
    this.api.changePassword(this.current(), this.pwNew()).subscribe({
      next: (u) => { this.loading.set(false); this.done.set(true); this.auth.user.set(u); setTimeout(() => this.router.navigateByUrl(promoteUrl(this.base, '/dashboard')), 800); },
      error: (e) => { this.loading.set(false); this.error.set(e?.error?.error || e?.error?.message || 'Erreur'); },
    });
  }
}
