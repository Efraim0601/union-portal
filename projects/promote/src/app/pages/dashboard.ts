import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { AgentStats, SubscriptionDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F';
const PAGE = 8;

function isPaid(s: SubscriptionDto) { return s.payStatus === 'paid' || s.payStatus === 'success'; }
function isPending(s: SubscriptionDto) { return s.payStatus === 'pending' || s.status === 'pending'; }
function isFailed(s: SubscriptionDto) { return s.payStatus === 'failed' || s.payStatus === 'expired'; }

@Component({
  selector: 'app-dashboard',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="dashboard" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:800px;margin:0 auto;width:100%">
      <div style="margin-bottom:24px;padding-left:36px" class="fade-in">
        <div style="font-size:22px;font-weight:800;color:var(--navy)">{{ i18n.t('dash_hello') }}, {{ name() }}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px">{{ roleLabel() }}@if (agency()) { · {{ agency() }} }</div>
      </div>

      <!-- KPI cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px;padding-left:36px">
        @for (k of kpis(); track k.label) {
          <div class="kpi-card slide-up">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:18px">{{ k.icon }}</span>
              <div style="width:8px;height:8px;border-radius:50%" [style.background]="k.color"></div>
            </div>
            <div style="font-size:20px;font-weight:800" [style.color]="k.color">{{ k.value }}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;font-weight:500">{{ k.label }}</div>
          </div>
        }
      </div>

      <!-- quick actions -->
      <div style="display:flex;gap:10px;margin-bottom:24px;padding-left:36px">
        <button (click)="go('/subscribe')" class="qa" style="background:var(--primary)"><span style="font-size:16px">➕</span>{{ i18n.t('side_subscribe') }}</button>
        <button (click)="go('/recharge')" class="qa" style="background:#D97706"><span style="font-size:16px">💳</span>{{ i18n.t('side_recharge') }}</button>
      </div>

      <!-- tabs -->
      <div style="display:flex;gap:4px;margin-bottom:16px;padding-left:36px;border-bottom:2px solid var(--surface-3)">
        <button (click)="tab.set('overview')" class="tab" [class.tab-on]="tab() === 'overview'">{{ i18n.t('side_dashboard') }}</button>
        <button (click)="tab.set('sales')" class="tab" [class.tab-on]="tab() === 'sales'">{{ i18n.t('dash_my_sales') }} ({{ sales().length }})</button>
      </div>

      <!-- OVERVIEW -->
      @if (tab() === 'overview') {
        <div style="padding-left:36px;display:flex;flex-direction:column;gap:16px">
          <div class="panel slide-up">
            <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:14px">{{ i18n.t('perf_title') }}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">
              <div style="padding:10px;background:#FEF2F2;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--primary)">{{ conversion() }}%</div><div style="font-size:10px;color:var(--muted)">{{ i18n.t('perf_conversion') }}</div></div>
              <div style="padding:10px;background:#F0FDF4;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:#059669">{{ paidCount() }}</div><div style="font-size:10px;color:var(--muted)">{{ i18n.t('kpi_paid') }}</div></div>
              <div style="padding:10px;background:#F9FAFB;border-radius:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--navy)">{{ avgTicket() }}</div><div style="font-size:10px;color:var(--muted)">{{ i18n.t('perf_avg_ticket') }}</div></div>
              <div style="padding:10px;background:#FFFBEB;border-radius:10px;text-align:center"><div style="font-size:13px;font-weight:700;color:#D97706">{{ topProduct() }}</div><div style="font-size:10px;color:var(--muted)">{{ i18n.t('perf_top_product') }}</div></div>
            </div>
          </div>
        </div>
      }

      <!-- MY SALES -->
      @if (tab() === 'sales') {
        <div style="padding-left:36px">
          <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
            <div style="flex:1;min-width:180px;position:relative">
              <svg width="16" height="16" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
              <input [value]="search()" (input)="search.set(val($event)); page.set(0)" [placeholder]="i18n.t('dash_search')" style="width:100%;padding:10px 12px 10px 36px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;background:var(--surface-2)">
            </div>
            <select [value]="statusFilter()" (change)="statusFilter.set(val($event)); page.set(0)" style="padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:12px;background:var(--surface-2);font-weight:600;color:var(--label)">
              <option value="all">{{ i18n.t('st_all') }}</option>
              <option value="paid">{{ i18n.t('st_paid') }}</option>
              <option value="pending">{{ i18n.t('st_pending') }}</option>
              <option value="failed">{{ i18n.t('st_failed') }}</option>
              <option value="printed">{{ i18n.t('st_printed') }}</option>
            </select>
          </div>

          @if (filtered().length === 0) {
            <div style="text-align:center;color:var(--muted);padding:32px">{{ i18n.t('empty_sales') }}</div>
          }

          <div style="display:flex;flex-direction:column;gap:8px">
            @for (s of paged(); track s.ref) {
              <div class="sale">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ s.ref }}</span>
                      <span class="badge" [style.background]="badge(s).bg" [style.color]="badge(s).color">{{ badge(s).label }}</span>
                    </div>
                    <div style="font-size:14px;font-weight:700;color:var(--navy);margin-top:3px">{{ s.fullName }}</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:15px;font-weight:800;color:var(--primary)">{{ price(s.amount) }}</div>
                    <div style="font-size:11px;color:var(--muted-2);margin-top:1px">{{ date(s.createdAt) }}</div>
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--muted);padding-top:6px;border-top:1px solid var(--surface-3)">
                  @if (s.phone) { <span>📞 {{ s.phone }}</span> }
                  <span>{{ s.productLabel }}</span>
                  <span>{{ s.pay }}</span>
                  @if (s.delivery) { <span>{{ s.delivery }}</span> }
                  @if (s.printed) { <span style="color:#059669">✓ {{ i18n.t('st_printed') }}</span> }
                </div>
              </div>
            }
          </div>

          @if (pageCount() > 1) {
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;margin-top:8px">
              <button (click)="page.set(page() - 1)" [disabled]="page() === 0" class="pg">← {{ i18n.t('pg_prev') }}</button>
              <span style="font-size:12px;font-weight:600;color:var(--muted)">{{ i18n.t('pg_page', { n: page() + 1, t: pageCount() }) }}</span>
              <button (click)="page.set(page() + 1)" [disabled]="page() >= pageCount() - 1" class="pg">{{ i18n.t('pg_next') }} →</button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .kpi-card { background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .qa { flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:12px;color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s }
    .qa:hover { opacity:.9 } .qa:active { transform:scale(.97) }
    .tab { padding:10px 16px;border:none;background:none;font-size:13px;font-weight:700;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s }
    .tab-on { color:var(--primary);border-bottom-color:var(--primary) }
    .panel { background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .sale { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .badge { padding:3px 8px;border-radius:12px;font-size:10px;font-weight:700 }
    .pg { padding:6px 14px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:600;cursor:pointer;color:var(--label) }
    .pg:disabled { opacity:.4;cursor:default }
  `],
})
export class DashboardPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);

  stats = signal<AgentStats | null>(null);
  sales = signal<SubscriptionDto[]>([]);
  tab = signal<'overview' | 'sales'>('overview');
  search = signal('');
  statusFilter = signal('all');
  page = signal(0);

  name = computed(() => this.auth.user()?.name || this.auth.claims()?.email?.split('@')[0] || '');
  agency = computed(() => this.auth.user()?.agency || '');
  roleLabel = computed(() => this.auth.roles().join(' · '));

  paidCount = computed(() => this.stats()?.paid ?? this.sales().filter(isPaid).length);
  kpis = computed(() => {
    const s = this.stats();
    const total = s?.total ?? this.sales().length;
    const paid = s?.paid ?? this.sales().filter(isPaid).length;
    const pending = s?.pending ?? this.sales().filter(isPending).length;
    const collected = s?.collected ?? this.sales().filter((x) => x.pay === 'cash').length;
    return [
      { icon: '📋', label: this.i18n.t('kpi_total'), value: String(total), color: '#1B1B2F' },
      { icon: '✅', label: this.i18n.t('kpi_paid'), value: String(paid), color: '#059669' },
      { icon: '⏳', label: this.i18n.t('kpi_pending'), value: String(pending), color: '#D97706' },
      { icon: '💵', label: this.i18n.t('kpi_collected'), value: String(collected), color: '#2563EB' },
    ];
  });

  conversion = computed(() => {
    const t = this.sales().length;
    return t ? Math.round((this.sales().filter(isPaid).length / t) * 100) : 0;
  });
  avgTicket = computed(() => {
    const paid = this.sales().filter(isPaid);
    if (!paid.length) return fcfa(0);
    return fcfa(paid.reduce((a, s) => a + (s.amount || 0), 0) / paid.length);
  });
  topProduct = computed(() => {
    const counts = new Map<string, number>();
    for (const s of this.sales()) counts.set(s.productLabel, (counts.get(s.productLabel) || 0) + 1);
    let best = '—', n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
  });

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.statusFilter();
    return this.sales().filter((s) => {
      if (q && !(`${s.ref} ${s.fullName} ${s.phone ?? ''}`.toLowerCase().includes(q))) return false;
      if (f === 'paid') return isPaid(s);
      if (f === 'pending') return isPending(s);
      if (f === 'failed') return isFailed(s);
      if (f === 'printed') return !!s.printed;
      return true;
    });
  });
  pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  paged = computed(() => this.filtered().slice(this.page() * PAGE, this.page() * PAGE + PAGE));

  constructor() {
    if (!this.auth.user()) this.auth.refreshMe().subscribe({ error: () => {} });
    this.api.agentStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
    this.api.mySubscriptions().subscribe({ next: (l) => this.sales.set(l), error: () => {} });
  }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  price = (n: number) => fcfa(n);
  date = (iso: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '');
  go(r: string) { this.router.navigateByUrl(r); }

  badge(s: SubscriptionDto) {
    if (isPaid(s)) return { label: this.i18n.t('st_paid'), bg: '#ECFDF5', color: '#059669' };
    if (isFailed(s)) return { label: this.i18n.t('st_failed'), bg: '#FEF2F2', color: '#DC2626' };
    return { label: this.i18n.t('st_pending'), bg: '#FFFBEB', color: '#D97706' };
  }
}
