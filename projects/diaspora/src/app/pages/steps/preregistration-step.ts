import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { OnbFormField, OnbInput, OnbSelect } from '../../ui/form-field';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaApi } from '../../core/diaspora-api.service';
import { ApplicationCreate, Country } from '../../core/application.model';
import { deriveResidencyStatus } from '../../core/residency-rules';
import { COUNTRY_FALLBACK_LIST, dialCodeFor } from '../../core/countries-fallback';

/** Étape 0 du parcours AFB : email, WhatsApp, pays de résidence (dérive le statut résident/non-résident). */
@Component({
  selector: 'diaspora-preregistration-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput, OnbSelect],
  template: `
    <onb-section-card [section]="1" title="Pré-inscription" subtitle="Email, WhatsApp et pays de résidence.">
      <form (submit)="onSubmit($event)" style="display:grid;gap:16px;">
        <onb-form-field label="Adresse e-mail" required>
          <input onbInput type="email" [value]="email()" (input)="email.set($any($event.target).value)" required />
        </onb-form-field>

        <onb-form-field label="Numéro WhatsApp" required hint="Vous recevrez un code de vérification sur ce numéro.">
          <div style="display:grid;grid-template-columns:132px 1fr;gap:8px;">
            <onb-select [value]="dialCode()" [changeFn]="setDialCode">
              @for (c of COUNTRY_FALLBACK_LIST; track c.code) { <option [value]="c.dial">{{ c.name }} ({{ c.dial }})</option> }
            </onb-select>
            <input onbInput type="tel" placeholder="6XX XX XX XX" [value]="localNumber()" (input)="localNumber.set($any($event.target).value)" required />
          </div>
        </onb-form-field>
        @if (localNumber() && !phoneValid()) {
          <p style="font-size:11.5px;color:#C8102E;margin:-10px 0 0;">Numéro invalide — vérifiez l'indicatif et le numéro saisi.</p>
        }

        <onb-form-field label="Pays de résidence" required>
          <onb-select [value]="country()" [changeFn]="setCountry">
            <option value="">— Sélectionner —</option>
            @for (c of countries(); track c.code) { <option [value]="c.code">{{ c.name }}</option> }
          </onb-select>
        </onb-form-field>
        @if (country()) {
          <p style="font-size:11.5px;color:#6B7280;margin:-10px 0 0;">
            Statut : {{ residencyStatus() === 'RESIDENT' ? 'Résident (Cameroun)' : 'Non-résident' }}
          </p>
        }

        <onb-step-nav [onBack]="false" submitLabel="Continuer" />
      </form>
    </onb-section-card>
  `,
})
export class DiasporaPreregistrationStep implements OnInit {
  private api = inject(DiasporaApi);
  readonly COUNTRY_FALLBACK_LIST = COUNTRY_FALLBACK_LIST;

  @Input() model: Partial<ApplicationCreate> = {};
  @Output() modelChange = new EventEmitter<Partial<ApplicationCreate>>();
  @Output() next = new EventEmitter<void>();

  // Toujours peuplée (liste de secours) même si le référentiel /api/countries est indisponible ;
  // remplacée par la vraie liste dès qu'elle répond avec des données.
  countries = signal<Country[]>(COUNTRY_FALLBACK_LIST.map((c) => ({ code: c.code, name: c.name })));
  email = signal('');
  dialCode = signal('+237');
  localNumber = signal('');
  country = signal('');

  phoneValid = computed(() => !this.localNumber() || !!parsePhoneNumberFromString(this.dialCode() + this.localNumber())?.isValid());
  residencyStatus = computed(() => deriveResidencyStatus(this.country()));

  ngOnInit(): void {
    this.email.set(this.model.email ?? '');
    if (this.model.whatsapp_phone_full) {
      const parsed = parsePhoneNumberFromString(this.model.whatsapp_phone_full);
      if (parsed) {
        this.dialCode.set(`+${parsed.countryCallingCode}`);
        this.localNumber.set(parsed.nationalNumber);
      }
    }
    this.country.set(this.model.residence ?? '');
    this.api.countries().subscribe({
      next: (c) => { if (c && c.length) this.countries.set(c); },
      error: () => {},
    });
  }

  setDialCode = (v: string): void => this.dialCode.set(v);
  setCountry = (v: string): void => {
    this.country.set(v);
    // Pré-sélectionne l'indicatif correspondant si le champ WhatsApp n'a pas encore été touché.
    if (!this.localNumber()) {
      const dial = dialCodeFor(v);
      if (dial) this.dialCode.set(dial);
    }
  };

  onSubmit(e: Event): void {
    e.preventDefault();
    if (!this.email() || !this.localNumber() || !this.phoneValid() || !this.country()) return;
    const parsed = parsePhoneNumberFromString(this.dialCode() + this.localNumber());
    this.modelChange.emit({
      ...this.model,
      email: this.email(),
      whatsapp_phone_full: parsed ? parsed.number : this.dialCode() + this.localNumber(),
      residence: this.country(),
      residency_status: this.residencyStatus(),
    });
    this.next.emit();
  }
}
