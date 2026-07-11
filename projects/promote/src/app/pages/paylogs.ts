import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { PaymentStats, SubscriptionDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';
const PAGE = 12;

@Component({
  selector: 'app-paylogs',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="paylogs" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:900px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:22px;font-weight:800;color:var(--navy)">{{ i18n.t('pl_title') }}</div>
          <button (click)="exportCsv()" class="btn-soft" style="border-radius:8px">⬇ {{ i18n.t('pl_export') }}</button>
        </div>

        @if (pay()) {
          <div class="panel" style="margin-bottom:16px">
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <div><span style="font-size:20px;font-weight:800;color:var(--navy)">{{ pay()!.momoTotal }}</span><div class="kl">{{ i18n.t('adm_total_momo') }}</div></div>
              <div><span style="font-size:20px;font-weight:800;color:#059669">{{ pay()!.momoPaid }}</span><div class="kl">{{ i18n.t('adm_paid') }}</div></div>
              <div><span style="font-size:20px;font-weight:800;color:#DC2626">{{ pay()!.momoFailed }}</span><div class="kl">{{ i18n.t('adm_failed') }}</div></div>
              <div><span style="font-size:20px;font-weight:800;color:#D97706">{{ pay()!.momoPending }}</span><div class="kl">{{ i18n.t('kpi_pending') }}</div></div>
              <div><span style="font-size:20px;font-weight:800;color:var(--primary)">{{ successRate() }}%</span><div class="kl">{{ i18n.t('adm_success_rate') }}</div></div>
            </div>
          </div>
        }

        <div style="display:flex;flex-direction:column;gap:8px">
          @for (s of paged(); track s.ref) {
            <div class="sale">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ s.ref }}</span>
                  <div style="font-size:13px;font-weight:700;color:var(--navy);margin-top:2px">{{ s.fullName }}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px">{{ s.pay }} · {{ s.payStatus }}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:14px;font-weight:800;color:var(--primary)">{{ money(s.amount) }}</div>
                  <span class="badge" [style.background]="badge(s).bg" [style.color]="badge(s).color">{{ badge(s).label }}</span>
                </div>
              </div>
            </div>
          }
        </div>
        @if (pageCount() > 1) {
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;margin-top:8px">
            <button (click)="page.set(page() - 1)" [disabled]="page() === 0" class="pg">←</button>
            <span style="font-size:12px;color:var(--muted)">{{ i18n.t('pg_page', { n: page() + 1, t: pageCount() }) }}</span>
            <button (click)="page.set(page() + 1)" [disabled]="page() >= pageCount() - 1" class="pg">→</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .panel { background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kl { font-size:10px;color:var(--muted);margin-top:2px }
    .sale { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .badge { padding:3px 8px;border-radius:12px;font-size:10px;font-weight:700;display:inline-block;margin-top:4px }
    .pg { padding:6px 14px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:600;cursor:pointer }
    .pg:disabled { opacity:.4;cursor:default }
  `],
})
export class PaylogsPage {
  protected i18n = inject(I18n);
  private api = inject(Api);

  pay = signal<PaymentStats | null>(null);
  all = signal<SubscriptionDto[]>([]);
  page = signal(0);

  momo = computed(() => this.all().filter((s) => s.pay === 'om' || s.pay === 'mtn'));
  pageCount = computed(() => Math.max(1, Math.ceil(this.momo().length / PAGE)));
  paged = computed(() => this.momo().slice(this.page() * PAGE, this.page() * PAGE + PAGE));
  successRate = computed(() => { const p = this.pay(); return p && p.momoTotal ? Math.round((p.momoPaid / p.momoTotal) * 100) : 0; });

  constructor() {
    this.api.paymentStats().subscribe({ next: (p) => this.pay.set(p), error: () => {} });
    this.api.allSubscriptions().subscribe({ next: (l) => this.all.set(l), error: () => {} });
  }

  money = (n: number) => fcfa(n);
  badge(s: SubscriptionDto) {
    if (s.payStatus === 'paid' || s.payStatus === 'success') return { label: this.i18n.t('st_paid'), bg: '#ECFDF5', color: '#059669' };
    if (s.payStatus === 'failed' || s.payStatus === 'expired') return { label: this.i18n.t('st_failed'), bg: '#FEF2F2', color: '#DC2626' };
    return { label: this.i18n.t('st_pending'), bg: '#FFFBEB', color: '#D97706' };
  }
  exportCsv() {
    const rows = [['ref', 'name', 'pay', 'status', 'amount', 'createdAt'],
      ...this.momo().map((s) => [s.ref, s.fullName, s.pay, s.payStatus, String(s.amount), s.createdAt])];
    const csv = rows.map((r) => r.map((c) => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'paylogs.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
