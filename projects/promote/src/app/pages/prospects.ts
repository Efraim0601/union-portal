import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { PROMOTE_BASE, promoteUrl } from '../core/base';
import { ProspectDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

/**
 * Prospects: subscription attempts that were started but never completed (payment failed or still
 * pending). Surfaced so staff can call the customer back, resume a pre-filled subscription, and mark
 * the lead as contacted. Scope is enforced server-side (own sub-tree; admin/manager global).
 */
@Component({
  selector: 'app-prospects',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="prospects" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:820px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('prospects_title') }}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:16px">{{ i18n.t('prospects_hint') }}</div>

        <div class="filters">
          <button class="chip" [class.chip-on]="filter() === 'all'" (click)="filter.set('all')">{{ i18n.t('prospects_all') }} ({{ items().length }})</button>
          <button class="chip" [class.chip-on]="filter() === 'todo'" (click)="filter.set('todo')">{{ i18n.t('prospects_todo') }} ({{ todoCount() }})</button>
        </div>

        @if (loading()) {
          <div style="text-align:center;color:var(--muted);padding:24px">…</div>
        } @else if (visible().length === 0) {
          <div style="text-align:center;color:var(--muted);padding:24px">{{ i18n.t('prospects_none') }}</div>
        } @else {
          <div style="display:flex;flex-direction:column;gap:8px">
            @for (p of visible(); track p.ref) {
              <div class="row">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                  <div style="min-width:0;flex:1">
                    <div style="font-size:14px;font-weight:800;color:var(--navy)">{{ p.fullName || i18n.t('prospects_anon') }}</div>
                    <div style="font-size:12px;color:var(--muted)">{{ p.phone }}<span> · {{ p.productLabel || p.productCode }}</span><span> · {{ money(p.amount) }}</span></div>
                    <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                      <span class="pill" [class.pill-fail]="p.payStatus === 'failed'" [class.pill-pend]="p.payStatus !== 'failed'">{{ statusLabel(p) }}</span>
                      @if (p.paymentMessage) { <span style="font-size:11px;color:#B91C1C">{{ p.paymentMessage }}</span> }
                    </div>
                    <div style="font-size:11px;color:var(--muted-2);margin-top:4px">
                      {{ i18n.t('prospect_agent') }}: {{ p.agentName || p.referrerName || i18n.t('prospect_unassigned') }} · {{ date(p.createdAt) }}
                    </div>
                    @if (p.contacted) {
                      <div style="font-size:11px;color:#059669;margin-top:3px">✓ {{ i18n.t('prospect_contacted') }} {{ p.contactedBy ? ('— ' + p.contactedBy) : '' }} {{ p.contactedAt ? ('· ' + date(p.contactedAt)) : '' }}</div>
                    }
                  </div>
                  <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
                    <a class="mini mini-call" [href]="'tel:' + p.phone">📞 {{ i18n.t('prospect_call') }}</a>
                    <button class="mini" (click)="resume(p)">↻ {{ i18n.t('prospect_resume') }}</button>
                    @if (!p.contacted) {
                      <button class="mini mini-ok" [disabled]="busy() === p.ref" (click)="markContacted(p)">✓ {{ i18n.t('prospect_mark') }}</button>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .filters { display:flex;gap:8px;margin-bottom:14px }
    .chip { padding:6px 12px;border-radius:20px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer }
    .chip-on { background:#FEF2F2;border-color:var(--primary);color:var(--primary) }
    .pill { padding:2px 8px;border-radius:12px;font-size:10px;font-weight:800 }
    .pill-fail { background:#FEF2F2;color:#B91C1C }
    .pill-pend { background:#FFF7ED;color:#C2410C }
    .mini { padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:11px;font-weight:700;color:var(--label);cursor:pointer;white-space:nowrap;text-align:center;text-decoration:none }
    .mini:hover { background:var(--surface-3) }
    .mini-call { color:#2563EB;border-color:#BFDBFE }
    .mini-ok { color:#059669;border-color:#A7F3D0 }
    .mini:disabled { opacity:.5;cursor:default }
  `],
})
export class ProspectsPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private router = inject(Router);
  private base = inject(PROMOTE_BASE);

  items = signal<ProspectDto[]>([]);
  loading = signal(true);
  busy = signal<string | null>(null);
  filter = signal<'all' | 'todo'>('todo');

  todoCount = computed(() => this.items().filter((p) => !p.contacted).length);
  visible = computed(() => this.filter() === 'todo' ? this.items().filter((p) => !p.contacted) : this.items());

  constructor() { this.reload(); }

  private reload() {
    this.loading.set(true);
    this.api.prospects().subscribe({
      next: (l) => { this.items.set(l); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  money = (n: number) => fcfa(n);
  date(iso: string | null) { return iso ? new Date(iso).toLocaleDateString('fr-FR') : ''; }
  statusLabel(p: ProspectDto) {
    return p.payStatus === 'failed' ? this.i18n.t('prospect_status_failed') : this.i18n.t('prospect_status_pending');
  }

  markContacted(p: ProspectDto) {
    this.busy.set(p.ref);
    this.api.markProspectContacted(p.ref).subscribe({
      next: (dto) => { this.items.update((l) => l.map((x) => x.ref === p.ref ? dto : x)); this.busy.set(null); },
      error: () => this.busy.set(null),
    });
  }

  /** Resume: open the subscription funnel pre-filled with the prospect's identity. */
  resume(p: ProspectDto) {
    const [prenom, ...rest] = (p.fullName || '').trim().split(/\s+/);
    const nom = rest.join(' ');
    const q = new URLSearchParams();
    if (prenom) q.set('prenom', prenom);
    if (nom) q.set('nom', nom);
    if (p.phone) q.set('phone', p.phone);
    const url = promoteUrl(this.base, '/subscribe') + (q.toString() ? '?' + q.toString() : '');
    this.router.navigateByUrl(url);
  }
}
