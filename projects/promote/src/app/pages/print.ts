import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { PrintStats, SubscriptionDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

@Component({
  selector: 'app-print',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="print" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:800px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('print_title') }}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 20px">
          <div class="kpi"><div style="font-size:22px;font-weight:800;color:#7C3AED">{{ stats()?.myPrinted ?? 0 }}</div><div class="kl">{{ i18n.t('print_printed') }}</div></div>
          <div class="kpi"><div style="font-size:22px;font-weight:800;color:#059669">{{ stats()?.myPrintedToday ?? 0 }}</div><div class="kl">{{ i18n.t('print_today') }}</div></div>
          <div class="kpi"><div style="font-size:22px;font-weight:800;color:#D97706">{{ stats()?.queue ?? 0 }}</div><div class="kl">{{ i18n.t('print_queue_kpi') }}</div></div>
        </div>

        <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ i18n.t('print_queue') }}</div>
        <div style="margin-bottom:12px;position:relative">
          <svg width="16" height="16" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
          <input [value]="q()" (input)="q.set(val($event))" (keydown.enter)="doSearch()" [placeholder]="i18n.t('search_ph')" style="width:100%;padding:10px 12px 10px 36px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;background:var(--surface-2)">
        </div>

        @if (results().length === 0) { <div style="text-align:center;color:var(--muted);padding:28px">{{ i18n.t('print_empty') }}</div> }
        <div style="display:flex;flex-direction:column;gap:10px">
          @for (s of results(); track s.ref) {
            <div class="row">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                <div>
                  <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ s.ref }}</span>
                  <div style="font-size:15px;font-weight:700;color:var(--navy);margin-top:3px">{{ s.fullName }}</div>
                </div>
                <div style="font-size:16px;font-weight:800;color:var(--navy)">{{ money(s.amount) }}</div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--muted);padding:6px 0;border-top:1px solid var(--surface-3);margin-bottom:8px">
                @if (s.phone) { <span>{{ s.phone }}</span> } <span>{{ s.productLabel }}</span><span>{{ s.pay }}</span>
                @if (s.printed) { <span style="color:#059669">✓ {{ i18n.t('print_printed') }}</span> }
              </div>
              <button (click)="print(s)" [disabled]="!!s.printed" class="btn-print"><span>🖨</span> {{ i18n.t('print_print_card') }}</button>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .kpi { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kl { font-size:11px;color:var(--muted);margin-top:2px }
    .row { background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .btn-print { width:100%;padding:12px;border-radius:10px;background:#7C3AED;color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px }
    .btn-print:hover { background:#6D28D9 } .btn-print:disabled { opacity:.5;cursor:default }
  `],
})
export class PrintPage {
  protected i18n = inject(I18n);
  private api = inject(Api);

  stats = signal<PrintStats | null>(null);
  q = signal('');
  results = signal<SubscriptionDto[]>([]);

  constructor() {
    this.api.printStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }
  val(e: Event) { return (e.target as HTMLInputElement).value; }
  money = (n: number | undefined) => fcfa(n || 0);

  doSearch() {
    const q = this.q().trim();
    if (!q) { this.results.set([]); return; }
    this.api.searchSubscriptions(q).subscribe({ next: (l) => this.results.set(l), error: () => this.results.set([]) });
  }
  print(s: SubscriptionDto) {
    this.api.printSubscription(s.ref).subscribe({
      next: (u) => { this.results.set(this.results().map((x) => (x.ref === s.ref ? u : x))); this.api.printStats().subscribe({ next: (st) => this.stats.set(st), error: () => {} }); },
    });
  }
}
