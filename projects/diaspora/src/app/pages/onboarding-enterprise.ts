import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { siblingUrl } from '../core/nav';
import { OnbSectionCard, OnbStepNav } from '../ui/section-card';
import { OnbFormField, OnbInput } from '../ui/form-field';
import { OnbStepperRail, StepDef } from '../ui/stepper-rail';
import { DiasporaApi } from '../core/diaspora-api.service';
import { EnterpriseApplicationCreate } from '../core/enterprise-application.model';
import { ENTERPRISE_ONBOARDING_STEPS } from '../core/onboarding-flow';

const LABELS: Record<string, string> = {
  company_name: 'Raison sociale', rccm_number: 'N° RCCM', activity_sector: "Secteur d'activité",
  legal_rep_last_name: 'Représentant légal — nom', legal_rep_first_name: 'Représentant légal — prénom',
  legal_rep_role: 'Représentant légal — fonction', head_office_address: 'Adresse du siège',
  email: 'E-mail', phone: 'Téléphone',
};

const ENTERPRISE_DOCS = [
  { key: 'RCCM', label: 'RCCM' },
  { key: 'STATUTS', label: 'Statuts' },
  { key: 'TAX_CARD', label: 'Carte de contribuable' },
  { key: 'HEAD_OFFICE_PROOF', label: 'Justificatif de siège' },
];

/**
 * Parcours entreprise — squelette minimal parallèle au parcours particulier.
 * Champs volontairement réduits (raison sociale, RCCM, représentant légal…) : à valider
 * avec la conformité avant mise en production, cf. EnterpriseApplicationCreate.
 */
@Component({
  selector: 'diaspora-onboarding-enterprise',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput, OnbStepperRail],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;">
      <div style="max-width:1040px;margin:0 auto;padding:32px 20px 60px;">
        <div style="margin-bottom:28px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#C8102E;text-transform:uppercase;margin-bottom:6px;">
            Ouverture de compte · Entreprise
          </div>
          <h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:28px;font-weight:500;color:#151821;letter-spacing:-0.5px;margin:0;">
            {{ step().title }}
          </h1>
          <p style="font-size:13px;color:#6B7280;margin-top:6px;">{{ step().description }}</p>
        </div>

        <div style="display:grid;gap:32px;grid-template-columns:1fr;" class="onb-grid">
          <aside class="onb-rail">
            <onb-stepper-rail [steps]="railSteps" [currentStep]="current() - 1" />
          </aside>

          <form (submit)="onSubmitForm($event)">
            @switch (step().kind) {
              @case ('review') {
                <onb-section-card [section]="current()" title="Récapitulatif" subtitle="Vérifiez vos informations avant l'envoi.">
                  <dl class="onb-review" style="display:grid;gap:12px;grid-template-columns:1fr 1fr;">
                    @for (e of filled(); track e[0]) {
                      <div style="min-width:0;">
                        <dt style="font-size:10px;font-weight:600;letter-spacing:0.4px;color:#9CA3AF;text-transform:uppercase;">{{ label(e[0]) }}</dt>
                        <dd style="font-size:13.5px;color:#151821;margin:2px 0 0;overflow-wrap:anywhere;">{{ e[1] }}</dd>
                      </div>
                    }
                  </dl>
                  <onb-step-nav [onBack]="true" (back)="prev()" [submitLabel]="submitting() ? 'Envoi…' : 'Envoyer la demande'" [isLoading]="submitting()" />
                </onb-section-card>
              }
              @case ('custom') {
                <onb-section-card [section]="current()" [title]="step().title" [subtitle]="step().description">
                  <div style="display:grid;gap:16px;">
                    @for (d of enterpriseDocs; track d.key) {
                      <onb-form-field [label]="d.label">
                        <input type="file" accept="image/*,.pdf" (change)="onDocSelected(d.key, $event)" />
                        @if (docNames()[d.key]) { <p style="font-size:11.5px;color:#16A34A;margin:4px 0 0;">{{ docNames()[d.key] }}</p> }
                      </onb-form-field>
                    }
                  </div>
                  <onb-step-nav [onBack]="true" (back)="prev()" submitLabel="Continuer" />
                </onb-section-card>
              }
              @default {
                <onb-section-card [section]="current()" [title]="step().title" [subtitle]="step().description">
                  <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;" class="onb-fields">
                    @for (f of step().fields; track f) {
                      <div [style.grid-column]="isWide(f) ? '1 / -1' : 'auto'">
                        <onb-form-field [label]="label(f)">
                          <input onbInput [type]="inputType(f)" [value]="value(f)" (input)="setEvt(f, $event)" />
                        </onb-form-field>
                      </div>
                    }
                  </div>
                  <onb-step-nav [onBack]="current() > 1" (back)="prev()" submitLabel="Continuer" />
                </onb-section-card>
              }
            }
            @if (error()) { <p style="font-size:12px;color:#C8102E;margin-top:12px;">{{ error() }}</p> }
          </form>
        </div>
      </div>
    </div>

    <style>
      /* min-width:auto des enfants de grille : un contenu à largeur fixe déborderait du viewport mobile. */
      .onb-grid > * { min-width: 0; }
      @media (min-width: 900px) { .onb-grid { grid-template-columns: 240px 1fr !important; } }
      @media (max-width: 899px) { .onb-rail { display: none; } }
      @media (max-width: 640px) {
        .onb-fields { grid-template-columns: 1fr !important; }
        .onb-review { grid-template-columns: 1fr !important; }
      }
    </style>
  `,
})
export class DiasporaOnboardingEnterprisePage {
  private api = inject(DiasporaApi);
  private router = inject(Router);

  readonly steps = ENTERPRISE_ONBOARDING_STEPS;
  readonly railSteps: StepDef[] = ENTERPRISE_ONBOARDING_STEPS.map((s) => ({ label: s.title, desc: s.description }));
  readonly current = signal(1);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly enterpriseDocs = ENTERPRISE_DOCS;
  readonly docNames = signal<Record<string, string>>({});

  private model = signal<Partial<EnterpriseApplicationCreate>>({ client_type: 'ENTREPRISE' });

  readonly step = computed(() => this.steps[this.current() - 1]);
  readonly filled = computed(() => Object.entries(this.model()).filter(([, v]) => v !== '' && v != null));

  label(f: string): string { return LABELS[f] ?? f; }
  isWide(f: string): boolean { return f === 'head_office_address' || f === 'email'; }
  inputType(f: string): string {
    if (f === 'email') return 'email';
    if (f === 'phone') return 'tel';
    return 'text';
  }
  value(f: string): string { return String((this.model() as Record<string, unknown>)[f] ?? ''); }
  setEvt(f: string, e: Event): void {
    this.model.update((m) => ({ ...m, [f]: (e.target as HTMLInputElement).value }));
  }

  onDocSelected(key: string, e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.docNames.update((m) => ({ ...m, [key]: file.name }));
  }

  onSubmitForm(e: Event): void {
    e.preventDefault();
    if (this.step().key === 'review') this.submit();
    else this.next();
  }
  next(): void { if (this.current() < this.steps.length) { this.current.update((v) => v + 1); this.scrollToTop(); } }
  prev(): void { if (this.current() > 1) { this.current.update((v) => v - 1); this.scrollToTop(); } }

  /** Remonte en haut du parcours au changement d'étape (sinon la nouvelle étape s'affiche
   *  à la position du bouton « Continuer », donc en bas). */
  private scrollToTop(): void {
    requestAnimationFrame(() => {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
    });
  }

  submit(): void {
    this.submitting.set(true);
    this.error.set(null);
    this.api.createEnterpriseApplication(this.model() as EnterpriseApplicationCreate).subscribe({
      next: () => this.router.navigateByUrl(siblingUrl(this.router, '/onboarding/entreprise', '/status')),
      error: (err) => { this.error.set('Échec de l’envoi. Vérifiez les champs obligatoires.'); this.submitting.set(false); console.error(err); },
    });
  }
}
