import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { HierarchyStatsDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

@Component({
  selector: 'app-supervision',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="supervision" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:900px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:16px">{{ i18n.t('sup_title') }}</div>
        @if (hier()) {
          <div class="kpis">
            <div class="kpi"><div class="kv">{{ hier()!.totalSubscriptions }}</div><div class="kl">{{ i18n.t('mgr_total_subs') }}</div></div>
            <div class="kpi"><div class="kv" style="color:var(--primary)">{{ money(hier()!.totalSubscriptionsAmount) }}</div><div class="kl">{{ i18n.t('mgr_total_amount') }}</div></div>
            <div class="kpi"><div class="kv" style="color:#2563EB">{{ hier()!.totalCollectes }}</div><div class="kl">{{ i18n.t('mgr_total_collectes') }}</div></div>
            <div class="kpi"><div class="kv" style="color:#059669">{{ money(hier()!.totalCommissions) }}</div><div class="kl">{{ i18n.t('mgr_total_comm') }}</div></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            @for (m of hier()!.members; track m.id) {
              <div class="row">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
                  <div style="min-width:0"><div style="font-size:13px;font-weight:700;color:var(--navy)">{{ m.name }}</div><div style="font-size:11px;color:var(--muted)">{{ m.role }}</div></div>
                  <div style="display:flex;gap:14px;flex-shrink:0;text-align:right">
                    <div><div style="font-size:13px;font-weight:800;color:var(--navy)">{{ m.subscriptions }}</div><div class="kl">{{ i18n.t('mgr_total_subs') }}</div></div>
                    <div><div style="font-size:13px;font-weight:800;color:#2563EB">{{ m.collectes }}</div><div class="kl">{{ i18n.t('mgr_total_collectes') }}</div></div>
                  </div>
                </div>
              </div>
            }
          </div>
        } @else {
          <div style="text-align:center;color:var(--muted);padding:24px">{{ i18n.t('adm_no_data') }}</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .kpis { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px }
    .kpi { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kv { font-size:20px;font-weight:800;color:var(--navy) }
    .kl { font-size:11px;color:var(--muted);margin-top:2px }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
  `],
})
export class SupervisionPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  hier = signal<HierarchyStatsDto | null>(null);
  constructor() { this.api.hierarchyStats().subscribe({ next: (h) => this.hier.set(h), error: () => {} }); }
  money = (n: number) => fcfa(n);
}
