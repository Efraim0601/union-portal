import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';

interface NavItem { id: string; icon: string; label: string; route: string; external?: boolean; }

@Component({
  selector: 'app-staff-sidebar',
  template: `
    <!-- hamburger -->
    <button (click)="open.set(true)" class="burger" aria-label="menu">
      <svg width="18" height="18" fill="none" stroke="#374151" stroke-width="2" viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"></path></svg>
    </button>

    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="drawer">
        <div style="padding:20px 16px;border-bottom:1px solid var(--surface-3)">
          <div class="avatar">{{ initial() }}</div>
          <div style="font-size:14px;font-weight:700;color:var(--navy)">{{ name() }}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">{{ roleLabel() }}</div>
          @if (agency()) { <div style="font-size:11px;color:var(--muted-2);margin-top:2px">{{ agency() }}</div> }
        </div>
        <div style="flex:1;padding:8px">
          @for (it of items(); track it.id) {
            <button (click)="go(it.route, it.external)" class="navi" [class.navi-on]="active() === it.id">
              <span style="font-size:16px;width:20px;text-align:center">{{ it.icon }}</span>
              <span style="font-size:14px;font-weight:600;color:var(--label)">{{ it.label }}</span>
            </button>
          }
        </div>
        <div style="padding:8px;border-top:1px solid var(--surface-3)">
          <button (click)="logout()" class="navi" style="color:var(--primary)">
            <span style="font-size:16px;width:20px;text-align:center">⎋</span>
            <span style="font-size:14px;font-weight:600;color:var(--primary)">{{ i18n.t('side_logout') }}</span>
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .burger { position:fixed;top:44px;left:8px;z-index:60;width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.08) }
    .backdrop { position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.3) }
    .drawer { position:fixed;top:var(--topbar-h);left:0;bottom:0;width:260px;background:#fff;z-index:80;box-shadow:2px 0 16px rgba(0,0,0,.08);display:flex;flex-direction:column;overflow-y:auto;animation:slideLeft .2s ease }
    .avatar { width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#C8102E,#8B0000);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;margin-bottom:8px }
    .navi { width:100%;display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;border:none;background:none;cursor:pointer;transition:all .15s;text-align:left;margin-bottom:2px }
    .navi:hover { background:var(--surface-3) }
    .navi-on { background:#FEF2F2 }
  `],
})
export class StaffSidebar {
  protected i18n = inject(I18n);
  private auth = inject(Auth);
  private router = inject(Router);

  active = input<string>('');
  open = signal(false);

  name = computed(() => this.auth.user()?.name || this.auth.claims()?.email || '');
  agency = computed(() => this.auth.user()?.agency || '');
  roleLabel = computed(() => this.auth.roles().join(' · '));
  initial = computed(() => (this.name()[0] || '?').toUpperCase());

  items = computed<NavItem[]>(() => {
    const t = this.i18n.t;
    const out: NavItem[] = [{ id: 'dashboard', icon: '📊', label: t('side_dashboard'), route: '/dashboard' }];
    if (this.auth.hasRole('ADMIN')) {
      out.push({ id: 'admin', icon: '🛡️', label: t('side_admin'), route: '/admin' });
      out.push({ id: 'manager', icon: '🗂️', label: t('side_manager'), route: '/manager' });
      out.push({ id: 'paylogs', icon: '🧾', label: t('side_paylogs'), route: '/paylogs' });
      out.push({ id: 'recon', icon: '🔄', label: t('side_recon'), route: '/recon' });
    }
    if (this.auth.hasRole('MANAGER', 'CHEF_EQUIPE')) {
      out.push({ id: 'manager', icon: '🗂️', label: t('side_manager'), route: '/manager' });
      out.push({ id: 'team', icon: '👥', label: t('side_team'), route: '/team' });
    }
    if (this.auth.hasRole('SUPERVISEUR')) out.push({ id: 'supervision', icon: '🔎', label: t('side_supervision'), route: '/supervision' });
    if (this.auth.hasRole('CASHIER')) out.push({ id: 'cashier', icon: '💵', label: t('side_cashier'), route: '/cashier' });
    if (this.auth.hasRole('PRINT_AGENT')) out.push({ id: 'print', icon: '🖨️', label: t('side_print'), route: '/print' });
    if (this.auth.hasRole('COLLECTEUR')) out.push({ id: 'collecte', icon: '📦', label: t('side_collecte'), route: '/collecte' });
    out.push({ id: 'subscribe', icon: '➕', label: t('side_subscribe'), route: '/subscribe' });
    out.push({ id: 'recharge', icon: '💳', label: t('side_recharge'), route: '/recharge' });
    out.push({ id: 'guide', icon: '📘', label: t('side_guide'), route: '/guide-utilisateur.html', external: true });
    out.push({ id: 'change-password', icon: '🔑', label: t('pw_change'), route: '/change-password' });
    return out;
  });

  go(route: string, external = false) {
    this.open.set(false);
    if (external) { window.open(route, '_blank', 'noopener'); return; }
    this.router.navigateByUrl(route);
  }
  logout() { this.open.set(false); this.auth.logout(); }
}
