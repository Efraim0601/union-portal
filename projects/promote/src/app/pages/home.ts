import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../core/i18n';
import { PROMOTE_BASE, promoteUrl } from '../core/base';

@Component({
  selector: 'app-home',
  template: `
    <div class="home-bg screen" style="align-items:center;padding:40px 16px 24px">
      <div style="width:100%;max-width:440px" class="slide-up">
        <!-- Logo -->
        <div style="text-align:center;margin-bottom:32px">
          <div class="brand-logo" style="width:52px;height:52px;margin-bottom:10px">
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
              <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"></path>
            </svg>
          </div>
          <div style="font-size:22px;font-weight:800;color:var(--navy);letter-spacing:-.3px">{{ i18n.t('home_welcome') }}</div>
          <div style="font-size:14px;color:var(--muted);margin-top:4px">{{ i18n.t('home_subtitle') }}</div>
        </div>

        <!-- Action cards -->
        <div style="display:flex;flex-direction:column;gap:14px">
          <button class="action-card" (click)="go('/subscribe')">
            <div class="action-ic" style="background:linear-gradient(135deg,#C8102E,#8B0000)">
              <svg width="24" height="24" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:700;color:var(--navy)">{{ i18n.t('home_subscribe') }}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">{{ i18n.t('home_subscribe_desc') }}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"></path></svg>
          </button>

          <button class="action-card" (click)="go('/recharge')">
            <div class="action-ic" style="background:linear-gradient(135deg,#D97706,#B45309)">
              <svg width="24" height="24" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:700;color:var(--navy)">{{ i18n.t('home_recharge') }}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">{{ i18n.t('home_recharge_desc') }}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"></path></svg>
          </button>
        </div>

        <!-- Staff link -->
        <div style="text-align:center;margin-top:32px">
          <button class="btn-ghost" (click)="go('/login')">{{ i18n.t('login_staff') }}</button>
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
export class HomePage {
  protected i18n = inject(I18n);
  private router = inject(Router);
  private base = inject(PROMOTE_BASE);

  go(path: string) {
    this.router.navigateByUrl(promoteUrl(this.base, path));
  }
}
