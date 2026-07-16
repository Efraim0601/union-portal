import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { RechargeDto, SubscriptionDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

type Row =
  | { type: 'sub'; ref: string; name: string; phone: string; label: string; pay: string; payStatus: string; amount: number; createdAt: string; sub: SubscriptionDto }
  | { type: 'rch'; ref: string; name: string; phone: string; label: string; pay: string; payStatus: string; amount: number; createdAt: string; rch: RechargeDto };

type ImgKind = { kind: string; label: string };

/**
 * Management transaction console: search subscriptions AND recharges by reference, name, first name,
 * phone (also CNI / PAN / email server-side), and open any record to review the full KYC detail and
 * the captured images. Gated to ADMIN / MANAGER / SUPERVISEUR (route guard + server-side roles).
 */
@Component({
  selector: 'app-transactions',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="transactions" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:880px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('tx_title') }}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:16px">{{ i18n.t('tx_hint') }}</div>

        <div style="position:relative;margin-bottom:14px">
          <svg width="16" height="16" fill="none" stroke="#9CA3AF" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
          <input [value]="q()" (input)="onInput(val($event))" (keyup.enter)="run()"
                 [placeholder]="i18n.t('tx_search_ph')"
                 style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--surface-2)">
        </div>

        @if (loading()) {
          <div style="text-align:center;color:var(--muted);padding:24px">…</div>
        } @else if (searched() && rows().length === 0) {
          <div style="text-align:center;color:var(--muted);padding:24px">{{ i18n.t('tx_none') }}</div>
        } @else if (!searched()) {
          <div style="text-align:center;color:var(--muted-2);padding:24px">{{ i18n.t('tx_prompt') }}</div>
        } @else {
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">{{ rows().length }} {{ i18n.t('tx_results') }}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            @for (r of rows(); track r.type + r.ref) {
              <div class="sale" style="cursor:pointer" (click)="open(r)" [title]="i18n.t('tx_open')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                  <div style="min-width:0">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="badge" [class.badge-rch]="r.type === 'rch'">{{ r.type === 'rch' ? i18n.t('tx_type_rch') : i18n.t('tx_type_sub') }}</span>
                      <span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ r.ref }}</span>
                    </div>
                    <div style="font-size:14px;font-weight:700;color:var(--navy);margin-top:3px">{{ r.name }}</div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px">{{ r.phone }}<span> · {{ r.label }}</span><span> · {{ r.pay }} · {{ r.payStatus }}</span></div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:15px;font-weight:800;color:var(--primary)">{{ money(r.amount) }}</div>
                    <div style="font-size:11px;color:var(--muted-2)">{{ date(r.createdAt) }}</div>
                    <div style="font-size:11px;color:var(--primary);font-weight:700;margin-top:2px">{{ i18n.t('tx_details') }} ›</div>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- DETAIL MODAL -->
    @if (selected(); as sel) {
      <div class="tx-overlay" (click)="close()">
        <div class="tx-card" (click)="$event.stopPropagation()">
          <div class="tx-head">
            <div>
              <div style="font-size:11px;color:var(--muted)">{{ sel.type === 'rch' ? i18n.t('tx_type_rch') : i18n.t('tx_type_sub') }}</div>
              <div class="mono" style="font-size:16px;font-weight:800;color:var(--navy)">{{ sel.ref }}</div>
            </div>
            <button (click)="close()" class="mini" style="color:var(--navy);border-color:var(--border)">✕</button>
          </div>
          <div class="tx-grid">
            @for (row of details(); track row.label) {
              <div class="kv"><span class="kv-l">{{ row.label }}</span><span class="kv-v">{{ row.value }}</span></div>
            }
          </div>
          @if (kinds().length) {
            <div style="font-weight:700;color:var(--navy);margin:16px 0 8px">{{ i18n.t('tx_images') }}</div>
            <div class="tx-imgs">
              @for (im of kinds(); track im.kind) {
                <div class="tx-img">
                  <div style="font-size:11px;color:var(--muted);margin-bottom:4px">{{ im.label }}</div>
                  @if (im.kind === 'sara-receipt' || im.kind === 'recharge-evidence') {
                    @if (imgs()[im.kind]) { <a [href]="imgs()[im.kind]" target="_blank" class="linkbtn">{{ i18n.t('tx_open_img') }} ↗</a> }
                    @else if (imgErr()[im.kind]) { <div style="font-size:11px;color:#DC2626">{{ i18n.t('tx_img_na') }}</div> }
                    @else { <div style="font-size:11px;color:var(--muted)">…</div> }
                  } @else {
                    @if (imgs()[im.kind]) { <img [src]="imgs()[im.kind]" [alt]="im.label" style="width:100%;border-radius:8px;border:1px solid var(--surface-3);display:block"> }
                    @else if (imgErr()[im.kind]) { <div style="font-size:11px;color:#DC2626">{{ i18n.t('tx_img_na') }}</div> }
                    @else { <div style="font-size:11px;color:var(--muted)">…</div> }
                  }
                </div>
              }
            </div>
          } @else {
            <div style="font-size:12px;color:var(--muted);margin-top:14px">{{ i18n.t('tx_no_image') }}</div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .sale { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .sale:hover { border-color:var(--primary) }
    .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace }
    .badge { padding:2px 7px;border-radius:10px;font-size:9.5px;font-weight:800;background:#EEF2FF;color:#4338CA;text-transform:uppercase;letter-spacing:.3px }
    .badge-rch { background:#F3E8FF;color:#7E22CE }
    .mini { padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:700;cursor:pointer }
    .tx-overlay { position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto }
    .tx-card { background:#fff;border-radius:16px;padding:20px;max-width:560px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.25) }
    .tx-head { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px }
    .tx-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px 16px }
    .kv { display:flex;flex-direction:column;border-bottom:1px solid var(--surface-3);padding-bottom:5px }
    .kv-l { font-size:10.5px;color:var(--muted);font-weight:600 }
    .kv-v { font-size:13px;color:var(--navy);font-weight:600;word-break:break-word }
    .tx-imgs { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px }
    .tx-img { background:var(--surface-2);border-radius:10px;padding:8px }
    .linkbtn { display:inline-block;font-size:12px;font-weight:700;color:var(--primary);text-decoration:none;padding:6px 0 }
  `],
})
export class TransactionsPage {
  protected i18n = inject(I18n);
  private api = inject(Api);

  q = signal('');
  loading = signal(false);
  searched = signal(false);
  rows = signal<Row[]>([]);
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  selected = signal<Row | null>(null);
  imgs = signal<Record<string, string>>({});
  imgErr = signal<Record<string, boolean>>({});

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  money = (n: number) => fcfa(n);
  date(iso: string | null | undefined) { return iso ? new Date(iso).toLocaleDateString('fr-FR') : ''; }

  onInput(v: string) {
    this.q.set(v);
    if (this.timer) clearTimeout(this.timer);
    if (v.trim().length < 2) { this.searched.set(false); this.rows.set([]); return; }
    this.timer = setTimeout(() => this.run(), 350);
  }

  run() {
    const query = this.q().trim();
    if (query.length < 2) return;
    const mine = ++this.seq;
    this.loading.set(true);
    forkJoin({
      subs: this.api.searchSubscriptions(query).pipe(catchError(() => of([] as SubscriptionDto[]))),
      rchs: this.api.searchRecharges(query).pipe(catchError(() => of([] as RechargeDto[]))),
    }).subscribe(({ subs, rchs }) => {
      if (mine !== this.seq) return; // a newer search superseded this one
      const rows: Row[] = [
        ...subs.map((s): Row => ({
          type: 'sub', ref: s.ref, name: s.fullName || `${s.prenom || ''} ${s.nom || ''}`.trim(),
          phone: s.phone || '', label: s.productLabel || s.productCode || '', pay: s.pay || '',
          payStatus: s.payStatus || '', amount: s.amount || 0, createdAt: s.createdAt || '', sub: s,
        })),
        ...rchs.map((r): Row => ({
          type: 'rch', ref: r.ref, name: r.fullName || `${r.prenom || ''} ${r.nom || ''}`.trim(),
          phone: r.phone || '', label: this.i18n.t('tx_type_rch') + ' ' + (r.pan || ''), pay: r.pay || '',
          payStatus: r.payStatus || '', amount: r.amount || 0, createdAt: r.createdAt || '', rch: r,
        })),
      ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      this.rows.set(rows);
      this.loading.set(false);
      this.searched.set(true);
    });
  }

  open(r: Row) {
    this.close();
    this.selected.set(r);
    for (const { kind } of this.kinds()) {
      const req = r.type === 'sub' ? this.api.subscriptionImage(r.ref, kind) : this.api.rechargeImage(r.ref, kind);
      req.subscribe({
        next: (blob) => this.imgs.set({ ...this.imgs(), [kind]: URL.createObjectURL(blob) }),
        error: () => this.imgErr.set({ ...this.imgErr(), [kind]: true }),
      });
    }
  }
  close() {
    const cur = this.imgs();
    for (const k of Object.keys(cur)) URL.revokeObjectURL(cur[k]);
    this.imgs.set({});
    this.imgErr.set({});
    this.selected.set(null);
  }

  kinds(): ImgKind[] {
    const sel = this.selected();
    if (!sel) return [];
    const out: ImgKind[] = [];
    if (sel.type === 'sub') {
      const s = sel.sub;
      if (s.hasSelfie) out.push({ kind: 'selfie', label: this.i18n.t('tx_img_selfie') });
      if (s.hasCniRecto) out.push({ kind: 'cni-recto', label: this.i18n.t('tx_img_cni_recto') });
      if (s.hasCniVerso) out.push({ kind: 'cni-verso', label: this.i18n.t('tx_img_cni_verso') });
      if (s.hasSaraReceipt) out.push({ kind: 'sara-receipt', label: this.i18n.t('tx_img_sara') });
    } else {
      const r = sel.rch;
      if (r.hasSaraReceipt) out.push({ kind: 'sara-receipt', label: this.i18n.t('tx_img_sara') });
      if (r.hasEvidence) out.push({ kind: 'recharge-evidence', label: this.i18n.t('tx_img_evidence') });
    }
    return out;
  }

  details(): { label: string; value: string }[] {
    const sel = this.selected();
    if (!sel) return [];
    const rows: { label: string; value: string }[] = [];
    const add = (label: string, v: unknown) => {
      const str = v == null || v === '' ? '' : String(v);
      if (str) rows.push({ label, value: str });
    };
    const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR') : '');
    const t = this.i18n.t;
    if (sel.type === 'sub') {
      const s = sel.sub;
      add(t('tx_f_status'), s.status);
      add(t('tx_f_paystatus'), s.payStatus);
      add(t('tx_f_client'), s.fullName || `${s.prenom || ''} ${s.nom || ''}`.trim());
      add(t('tx_f_sexe'), s.sexe);
      add(t('tx_f_phone'), s.phone);
      add(t('tx_f_email'), s.email);
      add(t('tx_f_doctype'), s.docType);
      add(t('tx_f_cni'), s.cni);
      add(t('tx_f_niu'), s.niu);
      add(t('tx_f_cniexp'), s.cniExp);
      add(t('tx_f_region'), s.region);
      add(t('tx_f_ville'), s.ville);
      add(t('tx_f_quartier'), s.quartier);
      add(t('tx_f_product'), s.productLabel || s.productCode);
      add(t('tx_f_amount'), s.amount != null ? this.money(s.amount) : '');
      add(t('tx_f_pay'), s.pay);
      add(t('tx_f_payphone'), s.payPhone);
      add(t('tx_f_paymsg'), s.paymentMessage);
      add(t('tx_f_delivery'), s.delivery);
      add(t('tx_f_pickup'), s.pickupAgencyName);
      add(t('tx_f_printed'), s.printed == null ? '' : s.printed ? t('yes') : t('no'));
      add(t('tx_f_channel'), s.channel);
      add(t('tx_f_agent'), s.agentId);
      add(t('tx_f_referrer'), s.referrerName);
      add(t('tx_f_referrer_phone'), s.referrerPhone);
      add(t('tx_f_card'), s.cardNumber || s.pan);
      add(t('tx_f_created'), dt(s.createdAt));
    } else {
      const r = sel.rch;
      add(t('tx_f_status'), r.status);
      add(t('tx_f_paystatus'), r.payStatus);
      add(t('tx_f_client'), r.fullName || `${r.prenom || ''} ${r.nom || ''}`.trim());
      add(t('tx_f_phone'), r.phone);
      add(t('tx_f_card'), r.pan);
      add(t('tx_f_amount'), r.amount != null ? this.money(r.amount) : '');
      add(t('tx_f_pay'), r.pay);
      add(t('tx_f_payphone'), r.payPhone);
      add(t('tx_f_paymsg'), r.paymentMessage);
      add(t('tx_f_fulfilled'), r.fulfilled == null ? '' : r.fulfilled ? t('yes') : t('no'));
      add(t('tx_f_fulfilled_by'), r.fulfilledBy);
      add(t('tx_f_fulfilled_at'), dt(r.fulfilledAt));
      add(t('tx_f_cash_by'), r.cashCollectedBy);
      add(t('tx_f_cash_at'), dt(r.cashCollectedAt));
      add(t('tx_f_agent'), r.agentId);
      add(t('tx_f_created'), dt(r.createdAt));
    }
    return rows;
  }
}
