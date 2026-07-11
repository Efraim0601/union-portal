import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { OnbSectionCard, OnbStepNav } from '../ui/section-card';
import { OnbFormField, OnbInput, OnbSelect } from '../ui/form-field';
import { OnbStepperRail, StepDef } from '../ui/stepper-rail';
import { DiasporaApi } from '../core/diaspora-api.service';
import { ApplicationCreate, Country, Nationality, Agency } from '../core/application.model';
import { ONBOARDING_STEPS } from '../core/onboarding-flow';

const LABELS: Record<string, string> = {
  last_name: 'Nom', first_name: 'Prénom', birth_name: 'Nom de naissance',
  birth_date: 'Date de naissance', birth_place: 'Lieu de naissance',
  birth_department: 'Département de naissance', sex: 'Sexe',
  marital_status: 'Situation matrimoniale', matrimonial_regime: 'Régime matrimonial',
  father_name: 'Nom du père', mother_name: 'Nom de la mère',
  nationality: 'Nationalité', residence: 'Pays de résidence', residency_status: 'Statut de résidence',
  address_location: 'Adresse', postal_box: 'Boîte postale', phone: 'Téléphone',
  whatsapp_phone_full: 'WhatsApp', email: 'E-mail',
  contact_person_1_name: 'Contact 1 — nom', contact_person_1_phone: 'Contact 1 — téléphone',
  contact_person_2_name: 'Contact 2 — nom', contact_person_2_phone: 'Contact 2 — téléphone',
  identity_document_number: "N° pièce d'identité",
  identity_document_issue_date: 'Date de délivrance', identity_document_issue_place: 'Lieu de délivrance',
  activity_sector: "Secteur d'activité", activity_subsector: 'Sous-secteur',
  income_range: 'Tranche de revenus', income_currency: 'Devise', funds_origin: 'Origine des fonds',
  account_object: 'Objet du compte', account_type: 'Type de compte', preferred_branch: 'Agence',
  account_purpose: 'Finalité du compte',
};

const ENUMS: Record<string, { value: string; label: string }[]> = {
  sex: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }],
  marital_status: [
    { value: 'SINGLE', label: 'Célibataire' }, { value: 'MARRIED', label: 'Marié(e)' },
    { value: 'DIVORCED', label: 'Divorcé(e)' }, { value: 'WIDOWED', label: 'Veuf/Veuve' },
  ],
  residency_status: [
    { value: 'RESIDENT', label: 'Résident' }, { value: 'NON_RESIDENT', label: 'Non-résident' },
  ],
  income_currency: [
    { value: 'XAF', label: 'FCFA (XAF)' }, { value: 'EUR', label: 'Euro (EUR)' }, { value: 'USD', label: 'Dollar (USD)' },
  ],
  account_type: [
    { value: 'COURANT', label: 'Compte courant' }, { value: 'EPARGNE', label: 'Compte épargne' },
  ],
};

@Component({
  selector: 'diaspora-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput, OnbSelect, OnbStepperRail],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;">
      <div style="max-width:1040px;margin:0 auto;padding:32px 20px 60px;">
        <!-- En-tête -->
        <div style="margin-bottom:28px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#C8102E;text-transform:uppercase;margin-bottom:6px;">
            Ouverture de compte · Diaspora
          </div>
          <h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:28px;font-weight:500;color:#151821;letter-spacing:-0.5px;margin:0;">
            {{ step().title }}
          </h1>
          <p style="font-size:13px;color:#6B7280;margin-top:6px;">{{ step().description }}</p>
        </div>

        <div style="display:grid;gap:32px;grid-template-columns:1fr;" class="onb-grid">
          <!-- Sidebar StepperRail -->
          <aside class="onb-rail">
            <onb-stepper-rail [steps]="railSteps" [currentStep]="current() - 1" />
          </aside>

          <!-- Formulaire de l'étape -->
          <form (submit)="onSubmitForm($event)">
            @if (step().key !== 'review') {
              <onb-section-card [section]="current()" [title]="step().title" [subtitle]="step().description">
                <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;" class="onb-fields">
                  @for (f of step().fields; track f) {
                    <div [style.grid-column]="isWide(f) ? '1 / -1' : 'auto'">
                      <onb-form-field [label]="label(f)">
                        @if (options(f); as opts) {
                          <onb-select [value]="value(f)" [changeFn]="setter(f)">
                            <option value="">— Sélectionner —</option>
                            @for (o of opts; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                          </onb-select>
                        } @else {
                          <input onbInput [type]="inputType(f)" [value]="value(f)" (input)="setEvt(f, $event)" />
                        }
                      </onb-form-field>
                    </div>
                  }
                </div>
                <onb-step-nav [onBack]="current() > 1" (back)="prev()" submitLabel="Continuer" />
              </onb-section-card>
            } @else {
              <onb-section-card [section]="current()" title="Récapitulatif" subtitle="Vérifiez vos informations avant l'envoi.">
                <dl style="display:grid;gap:12px;grid-template-columns:1fr 1fr;">
                  @for (e of filled(); track e[0]) {
                    <div>
                      <dt style="font-size:10px;font-weight:600;letter-spacing:0.4px;color:#9CA3AF;text-transform:uppercase;">{{ label(e[0]) }}</dt>
                      <dd style="font-size:13.5px;color:#151821;margin:2px 0 0;">{{ e[1] }}</dd>
                    </div>
                  }
                </dl>
                <onb-step-nav [onBack]="true" (back)="prev()" [submitLabel]="submitting() ? 'Envoi…' : 'Envoyer la demande'" [isLoading]="submitting()" />
              </onb-section-card>
            }
            @if (error()) { <p style="font-size:12px;color:#C8102E;margin-top:12px;">{{ error() }}</p> }
          </form>
        </div>
      </div>
    </div>

    <style>
      @media (min-width: 900px) {
        .onb-grid { grid-template-columns: 240px 1fr !important; }
      }
      @media (max-width: 899px) { .onb-rail { display: none; } }
      @media (max-width: 640px) { .onb-fields { grid-template-columns: 1fr !important; } }
    </style>
  `,
})
export class DiasporaOnboardingPage {
  private api = inject(DiasporaApi);
  private router = inject(Router);

  readonly steps = ONBOARDING_STEPS;
  readonly railSteps: StepDef[] = ONBOARDING_STEPS.map((s) => ({ label: s.title, desc: s.description }));
  readonly current = signal(1);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  private countries = signal<Country[]>([]);
  private nationalities = signal<Nationality[]>([]);
  private agencies = signal<Agency[]>([]);
  private model = signal<Partial<ApplicationCreate>>({ residency_status: 'RESIDENT', is_pep: false });

  readonly step = computed(() => this.steps[this.current() - 1]);
  readonly filled = computed(() => Object.entries(this.model()).filter(([, v]) => v !== '' && v != null));

  constructor() {
    this.api.countries().subscribe({ next: (c) => this.countries.set(c ?? []), error: () => {} });
    this.api.nationalities().subscribe({ next: (n) => this.nationalities.set(n ?? []), error: () => {} });
    this.api.agencies().subscribe({ next: (a) => this.agencies.set(a ?? []), error: () => {} });
  }

  label(f: string): string { return LABELS[f] ?? f; }
  isWide(f: string): boolean { return f === 'address_location' || f === 'email'; }
  inputType(f: string): string {
    if (f.includes('date')) return 'date';
    if (f === 'email') return 'email';
    if (f.includes('phone')) return 'tel';
    return 'text';
  }
  options(f: string): { value: string; label: string }[] | null {
    if (ENUMS[f]) return ENUMS[f];
    if (f === 'nationality') return this.nationalities().map((n) => ({ value: n.code, label: n.name }));
    if (f === 'residence') return this.countries().map((c) => ({ value: c.code, label: c.name }));
    if (f === 'preferred_branch') return this.agencies().map((a) => ({ value: a.code, label: a.name }));
    return null;
  }
  value(f: string): string { return String((this.model() as Record<string, unknown>)[f] ?? ''); }
  setter(f: string) { return (v: string) => this.set(f, v); }
  setEvt(f: string, e: Event) { this.set(f, (e.target as HTMLInputElement).value); }
  set(f: string, v: unknown): void { this.model.update((m) => ({ ...m, [f]: v })); }

  onSubmitForm(e: Event): void {
    e.preventDefault();
    if (this.step().key === 'review') this.submit();
    else this.next();
  }
  next(): void { if (this.current() < this.steps.length) this.current.update((v) => v + 1); }
  prev(): void { if (this.current() > 1) this.current.update((v) => v - 1); }

  submit(): void {
    this.submitting.set(true);
    this.error.set(null);
    this.api.createApplication(this.model() as ApplicationCreate).subscribe({
      next: (res) => this.router.navigate(['/status'], { queryParams: { reference: res.reference } }),
      error: (err) => { this.error.set('Échec de l’envoi. Vérifiez les champs obligatoires.'); this.submitting.set(false); console.error(err); },
    });
  }
}
