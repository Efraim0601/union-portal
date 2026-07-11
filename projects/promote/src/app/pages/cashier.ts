import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { CashierStats, RechargeDto, SubscriptionDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

@Component({
  selector: 'app-cashier',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="cashier" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:800px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('cash_title') }}</div>

        <div style="display:flex;gap:10px;margin:12px 0 20px">
          <div class="kpi"><div style="font-size:22px;font-weight:800;color:#D97706">{{ stats()?.pendingCount ?? 0 }}</div><div class="kl">{{ i18n.t('cash_pending') }}</div></div>
          <div class="kpi"><div style="font-size:22px;font-weight:800;color:#059669">{{ money(stats()?.myCollected) }}</div><div class="kl">{{ i18n.t('cash_collected') }}</div></div>
        </div>

        <div style="display:flex;gap:2px;margin-bottom:16px;border-bottom:2px solid var(--surface-3)">
          <button (click)="mode.set('cash')" class="tab" [class.tab-on]="mode() === 'cash'">{{ i18n.t('cash_mode_cash') }}</button>
          <button (click)="loadRecharges()" class="tab" [class.tab-on]="mode() === 'recharge'">{{ i18n.t('cash_mode_recharge') }} ({{ recharges().length }})</button>
        </div>

        @if (mode() === 'cash') {
          <div style="margin-bottom:12px;position:relative">
            <svg width="16" height="16" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
            <input [value]="q()" (input)="q.set(val($event))" (keydown.enter)="doSearch()" [placeholder]="i18n.t('search_ph')" style="width:100%;padding:10px 12px 10px 36px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;background:var(--surface-2)">
          </div>
          @if (results().length === 0) { <div style="text-align:center;color:var(--muted);padding:28px">{{ i18n.t('cash_empty') }}</div> }
          <div style="display:flex;flex-direction:column;gap:8px">
            @for (s of results(); track s.ref) {
              <div class="row">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                  <div>
                    <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ s.ref }}</span>
                    <div style="font-size:14px;font-weight:700;color:var(--navy);margin-top:3px">{{ s.fullName }}</div>
                  </div>
                  <div style="text-align:right"><div style="font-size:18px;font-weight:800;color:#D97706">{{ money(s.amount) }}</div></div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--muted);padding:6px 0;border-top:1px solid var(--surface-3);border-bottom:1px solid var(--surface-3);margin-bottom:8px">
                  @if (s.phone) { <span>{{ s.phone }}</span> } <span>{{ s.productLabel }}</span><span>{{ s.pay }}</span><span>{{ s.payStatus }}</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button (click)="validate(s)" class="btn-ok">{{ i18n.t('cash_validate') }}</button>
                  <button (click)="reject(s)" class="btn-no">{{ i18n.t('cash_reject') }}</button>
                </div>
              </div>
            }
          </div>
        }

        @if (mode() === 'recharge') {
          @if (recharges().length === 0) { <div style="text-align:center;color:var(--muted);padding:28px">—</div> }
          <div style="display:flex;flex-direction:column;gap:8px">
            @for (r of recharges(); track r.ref) {
              <div class="row" style="border-left:4px solid #D97706">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                  <div>
                    <span class="mono" style="font-size:12px;font-weight:700">{{ r.ref }}</span>
                    <div style="font-size:14px;font-weight:600;color:var(--navy);margin-top:2px">{{ r.fullName }}</div>
                    <div style="font-size:12px;color:var(--muted)">PAN: {{ r.pan }}</div>
                  </div>
                  <div style="font-size:18px;font-weight:800;color:#D97706">{{ money(r.amount) }}</div>
                </div>
                <button (click)="fulfill(r)" class="btn-ok" style="width:100%">{{ i18n.t('cash_credit_recharge') }}</button>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .kpi { flex:1;background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kl { font-size:11px;color:var(--muted);margin-top:2px }
    .tab { padding:8px 12px;border:none;background:none;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap }
    .tab-on { color:var(--primary);border-bottom-color:var(--primary) }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .btn-ok { flex:1;padding:10px;border-radius:8px;background:#059669;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer }
    .btn-ok:hover { background:#047857 }
    .btn-no { padding:10px 16px;border-radius:8px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;font-size:13px;font-weight:600;cursor:pointer }
  `],
})
export class CashierPage {
  protected i18n = inject(I18n);
  private api = inject(Api);

  stats = signal<CashierStats | null>(null);
  mode = signal<'cash' | 'recharge'>('cash');
  q = signal('');
  results = signal<SubscriptionDto[]>([]);
  recharges = signal<RechargeDto[]>([]);

  constructor() {
    this.api.cashierStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  money = (n: number | undefined) => fcfa(n || 0);

  doSearch() {
    const q = this.q().trim();
    if (!q) { this.results.set([]); return; }
    this.api.searchSubscriptions(q).subscribe({ next: (l) => this.results.set(l), error: () => this.results.set([]) });
  }
  loadRecharges() {
    this.mode.set('recharge');
    this.api.pendingRecharges().subscribe({ next: (l) => this.recharges.set(l), error: () => {} });
  }
  validate(s: SubscriptionDto) {
    this.api.cashValidateSubscription(s.ref, 'success', s.ref).subscribe({ next: () => this.afterAction(s.ref) });
  }
  reject(s: SubscriptionDto) {
    this.api.cashValidateSubscription(s.ref, 'failed').subscribe({ next: () => this.afterAction(s.ref) });
  }
  fulfill(r: RechargeDto) {
    this.api.fulfillRecharge(r.ref).subscribe({ next: () => this.recharges.set(this.recharges().filter((x) => x.ref !== r.ref)) });
  }
  private afterAction(ref: string) {
    this.results.set(this.results().filter((x) => x.ref !== ref));
    this.api.cashierStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }
}
