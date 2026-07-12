import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { CreateRechargeRequest } from '../core/models';

type Phase = 'form' | 'paying' | 'success' | 'failure';
const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';

@Component({
  selector: 'app-recharge',
  template: `
    @if (phase() === 'form') {
      <div style="flex:1;display:flex;flex-direction:column;background:rgba(255,255,255,.82)">
        <div style="padding:12px 16px;border-bottom:1px solid #F3F4F6;display:flex;align-items:center;gap:12px;position:sticky;top:38px;z-index:50;background:#fff">
          <button (click)="goHome()" class="icon-sq"><svg width="18" height="18" fill="none" stroke="#374151" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"></path></svg></button>
          <div style="font-family:var(--font-serif);font-size:16px;font-weight:500;letter-spacing:-0.2px;color:var(--navy)">{{ i18n.t('rech_title') }}</div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:20px 16px 100px">
          <div style="max-width:480px;margin:0 auto;width:100%">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
              <div><label class="lab">{{ i18n.t('field_firstname') }} *</label><input class="in" [value]="firstName()" (input)="firstName.set(val($event))"></div>
              <div><label class="lab">{{ i18n.t('field_lastname') }} *</label><input class="in" [value]="lastName()" (input)="lastName.set(val($event))"></div>
            </div>
            <div style="margin-bottom:16px">
              <label class="lab">{{ i18n.t('field_phone') }} *</label>
              <div style="display:flex;gap:8px"><div class="prefix">+237</div><input type="tel" class="in" placeholder="6XXXXXXXX" [value]="phone()" (input)="phone.set(val($event))"></div>
            </div>
            <div style="margin-bottom:16px">
              <label class="lab">{{ i18n.t('rech_card_number') }} *</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input class="in mono" maxlength="4" placeholder="XXXX" style="width:80px;text-align:center;letter-spacing:2px;font-size:18px" [value]="pan1()" (input)="pan1.set(val($event))">
                <span style="color:var(--muted-2)">****</span><span style="color:var(--muted-2)">****</span>
                <input class="in mono" maxlength="4" placeholder="XXXX" style="width:80px;text-align:center;letter-spacing:2px;font-size:18px" [value]="pan2()" (input)="pan2.set(val($event))">
              </div>
            </div>
            <div style="margin-bottom:16px">
              <label class="lab">{{ i18n.t('rech_amount') }} *</label>
              <input class="in" inputmode="numeric" placeholder="10 000" [value]="amount()" (input)="amount.set(val($event))">
              <div style="font-size:11px;color:var(--muted-2);margin-top:4px">{{ i18n.t('rech_amount_hint') }}</div>
            </div>
            <div style="margin-bottom:16px">
              <label class="lab" style="margin-bottom:10px">{{ i18n.t('pay_method') }}</label>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                @for (m of payMethods; track m.id) {
                  <button (click)="payMethod.set(m.id)" class="pm" [style.border-color]="payMethod() === m.id ? m.color : 'var(--border)'">
                    <div class="pm-ic" [style.background]="m.color"><span style="font-size:12px;font-weight:800" [style.color]="m.text">{{ m.icon }}</span></div>
                    <span style="font-size:11px;font-weight:600;color:var(--label)">{{ i18n.t(m.label) }}</span>
                  </button>
                }
              </div>
            </div>
            @if (payMethod() === 'om' || payMethod() === 'mtn') {
              <div style="margin-bottom:16px" class="fade-in">
                <label class="lab">{{ i18n.t('pay_momo_phone') }} *</label>
                <div style="display:flex;gap:8px"><div class="prefix">+237</div><input type="tel" class="in" placeholder="6XXXXXXXX" [value]="momoPhone()" (input)="momoPhone.set(val($event))"></div>
              </div>
            }
            @if (error()) { <div class="alert-error shake">{{ error() }}</div> }
          </div>
        </div>
        <div style="position:fixed;bottom:0;left:0;right:0;padding:12px 16px;background:#fff;border-top:1px solid #F3F4F6;z-index:50">
          <div style="max-width:480px;margin:0 auto">
            <button (click)="submit()" class="btn btn-primary" style="border-radius:12px" [disabled]="submitting()">{{ i18n.t('pay_now') }}</button>
          </div>
        </div>
      </div>
    }

    @if (phase() === 'paying') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:rgba(255,255,255,.82)">
        <div class="fade-in" style="max-width:400px;width:100%">
          <div style="position:relative;width:100px;height:100px;margin:0 auto 24px">
            <svg width="100" height="100" viewBox="0 0 100 100" style="animation:spinRing 2s linear infinite"><circle cx="50" cy="50" r="42" stroke="#F3F4F6" stroke-width="5" fill="none"></circle><circle cx="50" cy="50" r="42" stroke="#D97706" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="100"></circle></svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span style="font-size:18px;font-weight:800;color:#D97706;animation:pulse 1.5s ease infinite">₣</span></div>
          </div>
          <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px">{{ i18n.t('pay_processing_title') }}</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:16px">{{ i18n.t('processing_ussd') }}</div>
          <div style="padding:10px 16px;background:var(--surface-2);border-radius:10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin-bottom:20px">{{ i18n.t('processing_ref') }} <span class="mono" style="font-weight:700;color:var(--navy)">{{ ref() }}</span></div>
          <div style="font-size:12px;color:var(--muted-2)">{{ i18n.t('pay_wait_hint') }}</div>
        </div>
      </div>
    }

    @if (phase() === 'success') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:linear-gradient(180deg,#ECFDF5 0%,#fff 40%)">
        <div class="slide-up" style="max-width:400px;width:100%">
          <svg width="80" height="80" viewBox="0 0 80 80" style="animation:countPulse .6s ease;margin-bottom:20px"><circle cx="40" cy="40" r="36" fill="#059669" opacity=".12"></circle><circle cx="40" cy="40" r="20" fill="#059669"></circle><path d="M28 40l8 8 16-16" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="40" style="animation:drawCheck .5s ease .3s forwards"></path></svg>
          <div style="font-size:22px;font-weight:800;color:#059669;margin-bottom:8px">{{ i18n.t('success_title') }}</div>
          <div style="padding:12px 20px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);display:inline-block;margin-bottom:20px">
            <div style="font-size:11px;color:var(--muted-2)">{{ i18n.t('success_ref') }}</div>
            <div class="mono" style="font-size:22px;font-weight:800;color:var(--navy)">{{ ref() }}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button (click)="goHome()" class="btn btn-primary" style="border-radius:12px">{{ i18n.t('success_home') }}</button>
          </div>
        </div>
      </div>
    }

    @if (phase() === 'failure') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:linear-gradient(180deg,#FEF2F2 0%,#fff 40%)">
        <div style="animation:shakeX .5s ease forwards;max-width:400px;width:100%">
          <svg width="80" height="80" viewBox="0 0 80 80" style="margin-bottom:20px"><circle cx="40" cy="40" r="36" fill="#DC2626" opacity=".1"></circle><circle cx="40" cy="40" r="20" fill="#DC2626"></circle><path d="M30 30l20 20M50 30l-20 20" stroke="#fff" stroke-width="3" stroke-linecap="round"></path></svg>
          <div style="font-size:22px;font-weight:800;color:#DC2626;margin-bottom:8px">{{ i18n.t('failure_title') }}</div>
          <div style="font-size:14px;color:var(--muted);margin-bottom:24px">{{ i18n.t('failure_msg') }}</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button (click)="phase.set('form')" class="btn btn-primary" style="border-radius:12px">{{ i18n.t('failure_retry') }}</button>
            <button (click)="goHome()" class="btn-soft" style="width:100%;border-radius:12px;padding:14px">{{ i18n.t('failure_home') }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .icon-sq { display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;flex-shrink:0 }
    .lab { display:block;font-size:13px;font-weight:600;color:var(--label);margin-bottom:6px }
    .in { width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;background:var(--surface-2);transition:all .2s }
    .prefix { flex-shrink:0;padding:12px 10px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;color:var(--muted);background:var(--surface-3);font-weight:600 }
    .pm { display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:12px;border:2px solid var(--border);background:#fff;cursor:pointer;transition:all .2s }
    .pm-ic { width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center }
  `],
})
export class RechargePage implements OnDestroy {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private router = inject(Router);

  /** Timer du suivi de paiement mobile money (polling du statut backend). */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  phase = signal<Phase>('form');
  error = signal('');
  submitting = signal(false);
  ref = signal('');

  firstName = signal(''); lastName = signal(''); phone = signal('');
  pan1 = signal(''); pan2 = signal(''); amount = signal('');
  payMethod = signal(''); momoPhone = signal('');

  payMethods = [
    { id: 'om', label: 'pay_om', icon: 'OM', color: '#FF7900', text: '#fff' },
    { id: 'mtn', label: 'pay_mtn', icon: 'MTN', color: '#FFCB05', text: '#1B1B2F' },
    { id: 'cash', label: 'pay_cash', icon: '₣', color: '#059669', text: '#fff' },
  ];

  val(e: Event) { return (e.target as HTMLInputElement).value; }

  private amountNum(): number {
    return parseInt(this.amount().replace(/\D/g, ''), 10) || 0;
  }

  submit() {
    this.error.set('');
    if (!this.firstName() || !this.lastName() || !this.phone() || !this.pan1() || !this.pan2() || !this.amountNum()) {
      this.error.set(this.i18n.t('err_required_fields')); return;
    }
    if (!this.payMethod()) { this.error.set(this.i18n.t('err_pay_method')); return; }
    if ((this.payMethod() === 'om' || this.payMethod() === 'mtn') && !this.momoPhone()) {
      this.error.set(this.i18n.t('err_momo_phone')); return;
    }
    const req: CreateRechargeRequest = {
      prenom: this.firstName().trim(),
      nom: this.lastName().trim(),
      phone: this.phone().trim(),
      pan: `${this.pan1().trim()} **** **** ${this.pan2().trim()}`,
      amount: this.amountNum(),
      pay: this.payMethod(),
      payPhone: this.momoPhone().trim() || undefined,
    };
    this.submitting.set(true);
    this.api.createRecharge(req).subscribe({
      next: (r) => {
        this.submitting.set(false);
        this.ref.set(r.ref);
        if (this.payMethod() === 'cash') { this.phase.set('success'); }
        else { this.phase.set('paying'); this.startPolling(r.ref); }
      },
      error: (e) => {
        this.submitting.set(false);
        this.error.set(e?.error?.error || e?.error?.message || this.i18n.t('failure_msg'));
      },
    });
  }

  /** Statuts terminaux renvoyés par le backend (insensible à la casse). */
  private static readonly PAID = ['paid', 'success'];
  private static readonly FAILED = ['failed', 'rejected', 'cancelled', 'canceled', 'expired', 'error'];
  private static readonly MAX_POLL_MS = 3 * 60_000; // abandon après 3 min sans confirmation
  private static readonly POLL_INTERVAL_MS = 3000;

  /**
   * Interroge le backend (payStatus) jusqu'à confirmation réelle du paiement.
   * Le push mobile money est déclenché par le backend à la création de la recharge ;
   * cette page reflète simplement l'état réel, sans plus aucune simulation.
   */
  private startPolling(ref: string) {
    this.stopPolling();
    const started = Date.now();
    let inFlight = false;
    this.pollHandle = setInterval(() => {
      if (inFlight) return;
      if (Date.now() - started > RechargePage.MAX_POLL_MS) {
        this.stopPolling();
        this.error.set(this.i18n.t('pay_timeout'));
        this.phase.set('failure');
        return;
      }
      inFlight = true;
      this.api.rechargeStatus(ref).subscribe({
        next: (s) => {
          inFlight = false;
          const st = (s.payStatus || '').toLowerCase();
          if (RechargePage.PAID.includes(st)) { this.stopPolling(); this.phase.set('success'); }
          else if (RechargePage.FAILED.includes(st)) {
            this.stopPolling();
            this.error.set(s.message || this.i18n.t('failure_msg'));
            this.phase.set('failure');
          }
          // sinon (pending/awaiting/initiated) : on continue d'attendre
        },
        error: () => { inFlight = false; }, // erreur réseau transitoire : on réessaiera au prochain tick
      });
    }, RechargePage.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
  }

  ngOnDestroy() { this.stopPolling(); }

  goHome() { this.stopPolling(); this.router.navigateByUrl('/'); }
}
