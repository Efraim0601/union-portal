import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { CollecteDto, CollecteStats, CreateCollecteRequest } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const PRODUCTS = [
  { code: 'compte_ouvert', label: 'Compte ouvert' },
  { code: 'carte_bancaire', label: 'Carte bancaire' },
  { code: 'sara_money', label: 'Sara Money' },
  { code: 'e_first', label: 'E-First' },
];

@Component({
  selector: 'app-collecte',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="collecte" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:640px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('coll_title') }}</div>
        <div class="kpi" style="margin:12px 0 20px">
          <div style="font-size:26px;font-weight:800;color:var(--primary)">{{ stats()?.total ?? mine().length }}</div>
          <div style="font-size:11px;color:var(--muted)">{{ i18n.t('coll_total') }}</div>
        </div>

        <div class="card" style="padding:18px;margin-bottom:24px">
          <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:14px">{{ i18n.t('coll_new') }}</div>
          <div class="fld">
            <label class="lab">{{ i18n.t('coll_product') }} *</label>
            <select class="in" [value]="product()" (change)="product.set(val($event))">
              @for (p of products; track p.code) { <option [value]="p.code">{{ p.label }}</option> }
            </select>
          </div>
          <div class="fld"><label class="lab">{{ i18n.t('coll_client') }}</label><input class="in" [value]="clientNom()" (input)="clientNom.set(val($event))"></div>
          <div class="fld"><label class="lab">{{ i18n.t('field_phone') }}</label><input class="in" [value]="clientPhone()" (input)="clientPhone.set(val($event))"></div>
          @if (product() === 'compte_ouvert') {
            <div class="fld"><label class="lab">{{ i18n.t('coll_account') }}</label><input class="in" [value]="accountNumber()" (input)="accountNumber.set(val($event))"></div>
          }
          @if (product() === 'carte_bancaire') {
            <div class="fld"><label class="lab">{{ i18n.t('coll_card') }}</label><input class="in" [value]="cardNumber()" (input)="cardNumber.set(val($event))"></div>
          }
          @if (saved()) { <div class="alert-success" style="margin-bottom:10px">✓ {{ i18n.t('coll_saved') }}</div> }
          @if (error()) { <div class="alert-error shake" style="margin-bottom:10px">{{ error() }}</div> }
          <button (click)="save()" class="btn btn-primary" style="border-radius:10px" [disabled]="saving()">{{ i18n.t('coll_save') }}</button>
        </div>

        <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ i18n.t('coll_recent') }}</div>
        @if (mine().length === 0) { <div style="text-align:center;color:var(--muted);padding:24px">{{ i18n.t('coll_empty') }}</div> }
        <div style="display:flex;flex-direction:column;gap:8px">
          @for (c of mine(); track c.ref) {
            <div class="row">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ c.ref }}</span>
                  <div style="font-size:14px;font-weight:700;color:var(--navy);margin-top:2px">{{ c.clientNom || '—' }}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px">{{ label(c.product) }}@if (c.clientPhone) { · {{ c.clientPhone }} }</div>
                </div>
                <div style="font-size:11px;color:var(--muted-2)">{{ date(c.createdAt) }}</div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .kpi { background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .fld { margin-bottom:14px }
    .lab { display:block;font-size:13px;font-weight:600;color:var(--label);margin-bottom:6px }
    .in { width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;background:var(--surface-2) }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
  `],
})
export class CollectePage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  products = PRODUCTS;

  stats = signal<CollecteStats | null>(null);
  mine = signal<CollecteDto[]>([]);
  product = signal('compte_ouvert');
  clientNom = signal(''); clientPhone = signal(''); accountNumber = signal(''); cardNumber = signal('');
  saving = signal(false); saved = signal(false); error = signal('');

  constructor() { this.reload(); }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  label = (code: string) => PRODUCTS.find((p) => p.code === code)?.label ?? code;
  date = (iso: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '');

  private reload() {
    this.api.collecteStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
    this.api.myCollectes().subscribe({ next: (l) => this.mine.set(l), error: () => {} });
  }

  save() {
    this.error.set(''); this.saved.set(false);
    const req: CreateCollecteRequest = {
      product: this.product(),
      clientNom: this.clientNom().trim() || undefined,
      clientPhone: this.clientPhone().trim() || undefined,
      accountNumber: this.accountNumber().trim() || undefined,
      cardNumber: this.cardNumber().trim() || undefined,
    };
    this.saving.set(true);
    this.api.createCollecte(req).subscribe({
      next: () => {
        this.saving.set(false); this.saved.set(true);
        this.clientNom.set(''); this.clientPhone.set(''); this.accountNumber.set(''); this.cardNumber.set('');
        this.reload();
      },
      error: (e) => {
        this.saving.set(false);
        const code = e?.error?.error || e?.error?.message;
        this.error.set(code === 'product_limit_reached'
          ? this.i18n.t('err_product_limit')
          : (code || 'Erreur'));
      },
    });
  }
}
