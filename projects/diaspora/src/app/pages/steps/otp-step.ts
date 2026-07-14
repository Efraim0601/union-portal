import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { OnbFormField, OnbInput } from '../../ui/form-field';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaApi } from '../../core/diaspora-api.service';
import { ApplicationCreate } from '../../core/application.model';

const RESEND_COOLDOWN_S = 60;

/** Étape 1 du parcours AFB : vérification du numéro WhatsApp par code OTP (Callbell côté backend). */
@Component({
  selector: 'diaspora-otp-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput],
  template: `
    <onb-section-card [section]="2" title="Vérification WhatsApp" [subtitle]="'Code envoyé à ' + phone">
      <form (submit)="onSubmit($event)" style="display:grid;gap:16px;">
        @if (!sent()) {
          <p style="font-size:13px;color:#6B7280;margin:0;">
            Un code à 6 chiffres va être envoyé par WhatsApp au numéro renseigné à l'étape précédente.
          </p>
        } @else {
          <onb-form-field label="Code reçu" required>
            <input onbInput type="text" inputmode="numeric" maxlength="6" placeholder="123456"
                   [value]="code()" (input)="code.set($any($event.target).value)" />
          </onb-form-field>
        }

        @if (fallbackOtp()) {
          <div style="border:1px solid #F5C542;background:#FFF9E6;border-radius:10px;padding:12px 14px;display:grid;gap:4px;">
            <p style="font-size:12.5px;color:#8A6100;margin:0;font-weight:600;">
              Livraison WhatsApp indisponible
            </p>
            <p style="font-size:12.5px;color:#6B5200;margin:0;">
              Nous n'avons pas pu vous remettre le code par WhatsApp. Voici votre code de vérification :
            </p>
            <p style="font-size:22px;letter-spacing:4px;font-weight:700;color:#151821;margin:4px 0 0;">
              {{ fallbackOtp() }}
            </p>
          </div>
        }

        @if (error()) { <p style="font-size:12px;color:#C8102E;margin:0;">{{ error() }}</p> }

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <button type="button" (click)="sendOtp()" [disabled]="sending() || cooldown() > 0"
            style="padding:10px 18px;border-radius:8px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;font-size:12.5px;font-weight:600;cursor:pointer;"
            [style.opacity]="cooldown() > 0 ? 0.6 : 1">
            {{ !sent() ? 'Envoyer le code' : (cooldown() > 0 ? 'Renvoyer (' + cooldown() + 's)' : 'Renvoyer le code') }}
          </button>
        </div>

        <onb-step-nav [onBack]="true" (back)="back.emit()" submitLabel="Vérifier" [isLoading]="verifying()" />
      </form>
    </onb-section-card>
  `,
})
export class DiasporaOtpStep implements OnInit, OnDestroy {
  private api = inject(DiasporaApi);

  @Input() phone = '';
  @Input() model: Partial<ApplicationCreate> = {};
  @Output() modelChange = new EventEmitter<Partial<ApplicationCreate>>();
  @Output() verified = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  sent = signal(false);
  sending = signal(false);
  verifying = signal(false);
  code = signal('');
  error = signal<string | null>(null);
  /** Code renvoyé par le backend quand WhatsApp n'a PAS livré le message (repli anti-blocage). */
  fallbackOtp = signal<string | null>(null);
  cooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.sendOtp();
  }

  /** Clé de la session OTP côté backend : générée par le client, identique entre envoi et vérification. */
  private sessionId(): string {
    let id = this.model.pre_onboarding_session_id;
    if (!id) {
      id = crypto.randomUUID();
      this.model = { ...this.model, pre_onboarding_session_id: id };
      this.modelChange.emit(this.model);
    }
    return id;
  }

  sendOtp(): void {
    if (this.sending() || this.cooldown() > 0) return;
    this.sending.set(true);
    this.error.set(null);
    this.fallbackOtp.set(null);
    this.api.sendWhatsappOtp(this.phone, this.sessionId()).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.sent.set(true);
        // WhatsApp n'a pas remis le code : on l'affiche pour ne pas bloquer le parcours.
        if (res?.fallback_otp) this.fallbackOtp.set(res.fallback_otp);
        this.startCooldown();
      },
      error: () => {
        this.sending.set(false);
        this.sent.set(true);
        this.error.set("Échec de l'envoi du code. Vérifiez votre connexion puis réessayez.");
        this.startCooldown();
      },
    });
  }

  private startCooldown(): void {
    this.cooldown.set(RESEND_COOLDOWN_S);
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      this.cooldown.update((v) => {
        if (v <= 1 && this.cooldownTimer) { clearInterval(this.cooldownTimer); this.cooldownTimer = null; }
        return Math.max(0, v - 1);
      });
    }, 1000);
  }

  onSubmit(e: Event): void {
    e.preventDefault();
    if (this.code().length !== 6) { this.error.set('Saisissez le code à 6 chiffres.'); return; }
    this.verifying.set(true);
    this.error.set(null);
    this.api.verifyWhatsappOtp(this.phone, this.code(), this.sessionId()).subscribe({
      next: (res) => {
        this.verifying.set(false);
        this.modelChange.emit({
          ...this.model,
          pre_onboarding_session_id: res?.session_id ?? this.model.pre_onboarding_session_id,
          whatsapp_otp_verified: true,
          whatsapp_otp_verified_at: res?.whatsapp_otp_verified_at ?? new Date().toISOString(),
        });
        this.verified.emit();
      },
      error: () => {
        this.verifying.set(false);
        this.error.set('Code invalide ou service indisponible. Réessayez.');
      },
    });
  }

  ngOnDestroy(): void {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
  }
}
