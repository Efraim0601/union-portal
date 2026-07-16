import { Component, computed, effect, inject, signal, untracked, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { siblingUrl } from '../core/nav';
import { OnbSectionCard, OnbStepNav } from '../ui/section-card';
import { OnbFormField, OnbInput, OnbSelect, OnbCheckbox } from '../ui/form-field';
import { OnbStepperRail, StepDef } from '../ui/stepper-rail';
import { DiasporaApi } from '../core/diaspora-api.service';
import { OcrPrefillService } from '../core/ocr-prefill.service';
import { ApplicationCreate, Nationality, Agency, LookupOption, PackageOffer, Subsector } from '../core/application.model';
import { PARTICULIER_ONBOARDING_STEPS } from '../core/onboarding-flow';
import { COUNTRY_FALLBACK_LIST } from '../core/countries-fallback';
import { DiasporaPreregistrationStep } from './steps/preregistration-step';
import { DiasporaOtpStep } from './steps/otp-step';
import { DiasporaDocumentsStep, DocumentsStepState, EMPTY_DOCUMENTS_STATE } from './steps/documents-step';
import { DiasporaBiometricsStep, BiometricsStepState, EMPTY_BIOMETRICS_STATE } from './steps/biometrics-step';

const LABELS: Record<string, string> = {
  last_name: 'Nom', first_name: 'Prénom(s)', birth_name: 'Nom d’épouse',
  birth_date: 'Date de naissance', birth_place: 'Lieu de naissance',
  birth_department: 'Département de naissance', sex: 'Sexe',
  marital_status: 'Situation matrimoniale', matrimonial_regime: 'Régime matrimonial',
  father_name: 'Nom et prénoms du père', father_phone: 'Téléphone du père',
  mother_name: 'Nom et prénoms de la mère', mother_phone: 'Téléphone de la mère',
  nationality: 'Nationalité', residence: 'Pays de résidence', residency_status: 'Statut de résidence',
  address_location: 'Adresse', postal_box: 'Boîte postale',
  whatsapp_phone_full: 'WhatsApp', email: 'E-mail',
  contact_person_1_name: 'Contact 1 — nom et prénoms', contact_person_1_phone: 'Contact 1 — téléphone',
  contact_person_2_name: 'Contact 2 — nom et prénoms', contact_person_2_phone: 'Contact 2 — téléphone',
  identity_document_number: "N° pièce d'identité",
  identity_document_issue_date: 'Date de délivrance', identity_document_issue_place: 'Lieu de délivrance',
  identity_document_type: "Type de pièce d'identité",
  profession: 'Profession', income_type: 'Type de revenu',
  activity_sector: "Secteur d'activité", activity_subsector: 'Sous-secteur',
  income_range: 'Tranche de revenus', income_currency: 'Devise des revenus',
  funds_origin: 'Origine des fonds', funds_origin_other: 'Origine des fonds — précisez',
  account_object: 'Objet du compte', account_object_other: 'Objet du compte — précisez',
  account_type: 'Type de compte', account_currency: 'Devise', preferred_branch: 'Agence', rib: 'RIB (si disponible)',
  account_purpose: 'Finalité du compte', client_type: 'Type de client',
};

const ENUMS: Record<string, { value: string; label: string }[]> = {
  sex: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }],
  marital_status: [
    { value: 'SINGLE', label: 'Célibataire' }, { value: 'MARRIED', label: 'Marié(e)' },
    { value: 'DIVORCED', label: 'Divorcé(e)' }, { value: 'WIDOWED', label: 'Veuf/Veuve' },
  ],
  matrimonial_regime: [
    { value: 'MONOGAMIE', label: 'Monogamie' }, { value: 'POLYGAMIE', label: 'Polygamie' },
  ],
  income_currency: [
    { value: 'XAF', label: 'FCFA (XAF)' }, { value: 'EUR', label: 'Euro (EUR)' }, { value: 'USD', label: 'Dollar (USD)' },
  ],
  account_currency: [
    { value: 'XAF', label: 'FCFA (XAF)' }, { value: 'EUR', label: 'Euro (EUR)' }, { value: 'USD', label: 'Dollar (USD)' },
  ],
  account_type: [
    { value: 'COURANT', label: 'Compte courant' }, { value: 'EPARGNE', label: 'Compte épargne' },
  ],
};

const IDENTITY_TYPE_LABELS: Record<string, string> = {
  CNI: "Carte nationale d'identité", PASSEPORT: 'Passeport',
  CARTE_SEJOUR: 'Carte de séjour', CARTE_CONSULAIRE: 'Carte consulaire',
};

/** Champs préremplis en amont (pré-inscription / choix de la pièce à l'étape documents) :
 *  lecture seule une fois renseignés, pour ne pas invalider ce qui a déjà été vérifié en amont
 *  (le statut résident/non-résident et les documents requis dépendent de `residence`).
 *  EXCEPTION : si la valeur provient de l'OCR (cf. `ocrFilledKeys`), le champ reste ÉDITABLE —
 *  l'OCR peut se tromper et l'utilisateur doit pouvoir corriger, sans quoi une erreur de lecture
 *  bloque définitivement le champ (cf. retour terrain : valeurs fausses non corrigibles). */
const READONLY_ONCE_FILLED = new Set(['residence', 'identity_document_type']);

/** Champs obligatoires — bloquent le passage à l'étape suivante tant qu'ils sont vides
 *  (en plus de l'astérisque affiché sur le libellé). */
const REQUIRED_FIELDS = new Set([
  'sex', 'marital_status', 'last_name', 'first_name', 'birth_place', 'birth_date', 'residence', 'nationality',
  'address_location', 'postal_box', 'whatsapp_phone_full', 'email',
  'father_name', 'father_phone', 'mother_name', 'mother_phone',
  'contact_person_1_name', 'contact_person_1_phone', 'contact_person_2_name', 'contact_person_2_phone',
  'identity_document_type', 'identity_document_number', 'identity_document_issue_date', 'identity_document_issue_place',
  'profession', 'income_range',
]);

/** Bookkeeping interne — jamais affiché dans le récapitulatif final (la case à cocher le montre déjà). */
const REVIEW_HIDDEN_KEYS = new Set([
  'pre_onboarding_session_id', 'whatsapp_otp_verified', 'whatsapp_otp_verified_at', 'client_type', 'consent_accepted',
]);

@Component({
  selector: 'diaspora-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OnbSectionCard, OnbStepNav, OnbFormField, OnbInput, OnbSelect, OnbCheckbox, OnbStepperRail,
    DiasporaPreregistrationStep, DiasporaOtpStep, DiasporaDocumentsStep, DiasporaBiometricsStep,
  ],
  // Scope page : la lecture OCR de la pièce survit à la navigation entre étapes (@switch), et
  // sa seule instance est partagée avec l'étape Documents ; repartie à zéro à chaque parcours.
  providers: [OcrPrefillService],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;">
      <div style="max-width:1040px;margin:0 auto;padding:32px 20px 60px;">
        <!-- En-tête -->
        <div style="margin-bottom:28px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#C8102E;text-transform:uppercase;margin-bottom:6px;">
            Ouverture de compte à distance
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

          <!-- Contenu de l'étape -->
          <div>
            @switch (step().kind) {
              @case ('custom') {
                @switch (step().key) {
                  @case ('preregistration') {
                    <diaspora-preregistration-step [model]="model()" (modelChange)="model.set($event)" (next)="next()" />
                  }
                  @case ('otp') {
                    <diaspora-otp-step [phone]="model().whatsapp_phone_full ?? ''" [model]="model()"
                      (modelChange)="model.set($event)" (verified)="next()" (back)="prev()" />
                  }
                  @case ('documents') {
                    <diaspora-documents-step [model]="model()" (modelChange)="model.set($event)" (next)="next()" (back)="prev()"
                      [state]="docState()" (stateChange)="docState.set($event)" />
                  }
                  @case ('biometrics') {
                    <diaspora-biometrics-step [model]="model()" (modelChange)="model.set($event)" (next)="next()" (back)="prev()"
                      [state]="bioState()" (stateChange)="bioState.set($event)" />
                  }
                }
              }
              @case ('review') {
                <onb-section-card [section]="current()" title="Récapitulatif" subtitle="Vérifiez vos informations avant l'envoi.">
                  <form (submit)="onSubmitForm($event)">
                    <dl style="display:grid;gap:12px;grid-template-columns:1fr 1fr;">
                      @for (e of filled(); track e[0]) {
                        <div>
                          <dt style="font-size:10px;font-weight:600;letter-spacing:0.4px;color:#9CA3AF;text-transform:uppercase;">{{ label(e[0]) }}</dt>
                          <dd style="font-size:13.5px;color:#151821;margin:2px 0 0;">{{ e[1] }}</dd>
                        </div>
                      }
                    </dl>

                    <div style="margin:22px 0 4px;padding-top:18px;border-top:1px solid rgba(20,20,30,0.08);">
                      <p style="font-size:11px;font-weight:700;letter-spacing:0.6px;color:#6B7280;text-transform:uppercase;margin:0 0 10px;">
                        Consentement et autorisation
                      </p>
                      <p style="font-size:12.5px;color:#6B7280;line-height:1.55;margin:0 0 14px;">
                        En soumettant ce formulaire, vous autorisez la banque à vérifier les informations fournies, à contrôler
                        les documents transmis et à effectuer les diligences nécessaires à l'ouverture de votre compte.
                      </p>
                      <onb-checkbox
                        [checked]="model().consent_accepted ?? false" [changeFn]="setConsent"
                        label="Je certifie que les informations fournies sont exactes et j'autorise Afriland First Bank à effectuer les contrôles KYC, la vérification documentaire, le filtrage de conformité et les diligences nécessaires à l'ouverture de mon compte." />
                    </div>

                    <onb-step-nav [onBack]="true" (back)="prev()" [submitLabel]="submitting() ? 'Envoi…' : 'Envoyer la demande'"
                      [isLoading]="submitting()" [disabled]="!model().consent_accepted" />
                    @if (error()) { <p style="font-size:12px;color:#C8102E;margin-top:12px;">{{ error() }}</p> }
                  </form>
                </onb-section-card>
              }
              @default {
                <form (submit)="onSubmitForm($event)">
                  <onb-section-card [section]="current()" [title]="step().title" [subtitle]="step().description">
                    <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;" class="onb-fields">
                      @for (f of step().fields; track f) {
                        @if (isVisible(f)) {
                          <div [style.grid-column]="isWide(f) ? '1 / -1' : 'auto'">
                            <onb-form-field [label]="label(f)" [required]="isRequired(f)">
                              @if (isReadOnly(f)) {
                                <div style="padding:10px 12px;border:1px solid rgba(20,20,30,0.08);border-radius:8px;background:#F7F2EC;font-size:13.5px;color:#151821;">
                                  {{ displayValue(f) }}
                                </div>
                              } @else if (options(f); as opts) {
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
                      }
                    </div>

                    @if (step().key === 'package') {
                      <div style="margin:22px 0 6px;">
                        <p style="font-size:11px;font-weight:700;letter-spacing:0.6px;color:#6B7280;text-transform:uppercase;margin:0 0 12px;">
                          Package souhaité
                        </p>
                        <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">
                          @for (pkg of packages(); track pkg.code) {
                            <button type="button" (click)="selectPackage(pkg)"
                              [style.border]="value('selected_package_code') === pkg.code ? '2px solid #C8102E' : '1px solid rgba(20,20,30,0.12)'"
                              style="text-align:left;padding:16px;border-radius:10px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:8px;font-family:'Inter',system-ui,sans-serif;">
                              <div style="font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:600;color:#151821;">{{ pkg.name }}</div>
                              @if (pkg.tagline) { <div style="font-size:12px;color:#6B7280;">{{ pkg.tagline }}</div> }
                              <ul style="margin:4px 0 0;padding-left:16px;font-size:12px;color:#151821;line-height:1.6;">
                                @for (feat of pkg.features; track feat) { <li>{{ feat }}</li> }
                              </ul>
                              <div style="font-size:12px;font-weight:600;color:#C8102E;margin-top:6px;">
                                {{ pkg.opening_fee }} {{ pkg.currency }} à l'ouverture · {{ pkg.monthly_fee }} {{ pkg.currency }}/mois
                              </div>
                            </button>
                          }
                        </div>
                        @if (!value('selected_package_code')) {
                          <p style="font-size:11.5px;color:#6B7280;margin:10px 0 0;">Sélectionnez une formule pour continuer.</p>
                        }
                      </div>
                    }

                    <onb-step-nav [onBack]="current() > 1" (back)="prev()" submitLabel="Continuer" />
                  </onb-section-card>
                  @if (error()) { <p style="font-size:12px;color:#C8102E;margin-top:12px;">{{ error() }}</p> }
                </form>
              }
            }
          </div>
        </div>
      </div>
    </div>

    <style>
      @media (min-width: 900px) {
        .onb-grid { grid-template-columns: 240px 1fr !important; }
        /* Rail des étapes fixe pendant le défilement du contenu (align-self:start
           laisse au sticky la marge nécessaire, sinon l'aside s'étire sur toute la ligne). */
        .onb-rail { position: sticky; top: 24px; align-self: start; }
      }
      @media (max-width: 899px) { .onb-rail { display: none; } }
      @media (max-width: 640px) { .onb-fields { grid-template-columns: 1fr !important; } }
    </style>
  `,
})
export class DiasporaOnboardingPage {
  private api = inject(DiasporaApi);
  private router = inject(Router);
  /** Lecture OCR de la pièce menée en arrière-plan (déclenchée sur l'étape Documents). */
  private ocr = inject(OcrPrefillService);

  readonly steps = PARTICULIER_ONBOARDING_STEPS;
  readonly railSteps: StepDef[] = PARTICULIER_ONBOARDING_STEPS.map((s) => ({ label: s.title, desc: s.description }));
  readonly current = signal(1);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  private nationalities = signal<Nationality[]>([]);
  private agencies = signal<Agency[]>([]);
  // Toujours peuplée (liste de secours) pour afficher un nom de pays lisible sur le champ
  // `residence` en lecture seule, même si /api/countries est indisponible.
  private countries = signal(COUNTRY_FALLBACK_LIST.map((c) => ({ code: c.code, name: c.name })));
  private sectors = signal<LookupOption[]>([]);
  private subsectorsAll = signal<Subsector[]>([]);
  private incomeRanges = signal<LookupOption[]>([]);
  private incomeTypes = signal<LookupOption[]>([]);
  private fundsOrigins = signal<LookupOption[]>([]);
  private accountObjects = signal<LookupOption[]>([]);
  private professions = signal<LookupOption[]>([]);
  readonly packages = signal<PackageOffer[]>([]);
  readonly model = signal<Partial<ApplicationCreate>>({ client_type: 'PARTICULIER' });
  /** Champs dont la valeur a été renseignée par l'OCR — exclus du verrou READONLY_ONCE_FILLED
   *  pour rester corrigibles (une lecture OCR erronée ne doit jamais figer un champ). */
  private readonly ocrFilledKeys = signal<Set<string>>(new Set());
  /** Survit à la destruction/recréation des étapes documents/biométrie lors de la navigation (@switch). */
  readonly docState = signal<DocumentsStepState>(EMPTY_DOCUMENTS_STATE);
  readonly bioState = signal<BiometricsStepState>(EMPTY_BIOMETRICS_STATE);

  readonly step = computed(() => this.steps[this.current() - 1]);
  readonly filled = computed(() =>
    Object.entries(this.model()).filter(([k, v]) => v !== '' && v != null && !REVIEW_HIDDEN_KEYS.has(k)),
  );

  constructor() {
    // Préremplissage en arrière-plan : dès que la lecture de la pièce (ou du plan de localisation)
    // aboutit, on fusionne les champs lus dans le modèle — SANS jamais écraser une saisie du client
    // (on ne remplit que les champs encore vides). Le client, lui, a déjà pu avancer.
    effect(() => {
      const incoming = this.resolveOcrCodes({ ...this.ocr.addressFields(), ...this.ocr.fields() });
      if (!Object.keys(incoming).length) return;
      // Modèle courant lu HORS suivi réactif : l'effet ne dépend que des signaux OCR (il écrit
      // le modèle, le relire réactivement le ferait se redéclencher).
      const current = untracked(() => this.model()) as Record<string, unknown>;
      const filledNow = Object.entries(incoming)
        .filter(([k, v]) => v != null && String(v).trim() !== ''
          && (current[k] == null || String(current[k]).trim() === ''))
        .map(([k]) => k);
      if (!filledNow.length) return;
      this.model.update((m) => this.fillMissing(m, incoming));
      // Mémorise quels champs viennent de l'OCR → ils restent éditables même s'ils font partie
      // de READONLY_ONCE_FILLED (l'OCR peut se tromper, l'utilisateur doit pouvoir corriger).
      this.ocrFilledKeys.update((s) => {
        const next = new Set(s);
        for (const k of filledNow) next.add(k);
        return next;
      });
    });

    this.api.nationalities().subscribe({ next: (n) => this.nationalities.set(n ?? []), error: () => {} });
    this.api.agencies().subscribe({ next: (a) => this.agencies.set(a ?? []), error: () => {} });
    this.api.countries().subscribe({ next: (c) => { if (c && c.length) this.countries.set(c); }, error: () => {} });
    this.api.lookup('sectors').subscribe({ next: (l) => this.sectors.set(l ?? []), error: () => {} });
    this.api.lookup('income-ranges').subscribe({ next: (l) => this.incomeRanges.set(l ?? []), error: () => {} });
    this.api.lookup('income-types').subscribe({ next: (l) => this.incomeTypes.set(l ?? []), error: () => {} });
    this.api.lookup('funds-origins').subscribe({ next: (l) => this.fundsOrigins.set(l ?? []), error: () => {} });
    this.api.lookup('account-objects').subscribe({ next: (l) => this.accountObjects.set(l ?? []), error: () => {} });
    this.api.lookup('professions').subscribe({ next: (l) => this.professions.set(l ?? []), error: () => {} });
    this.api.lookupSubsectors().subscribe({ next: (l) => this.subsectorsAll.set(l ?? []), error: () => {} });
    this.api.packages().subscribe({ next: (l) => this.packages.set(l ?? []), error: () => {} });
  }

  label(f: string): string { return LABELS[f] ?? f; }
  isWide(f: string): boolean { return f === 'address_location' || f === 'email'; }
  isReadOnly(f: string): boolean {
    // Verrou uniquement si le champ a été renseigné en amont (pré-inscription), PAS par l'OCR :
    // une donnée récupérée par l'OCR doit toujours pouvoir être corrigée.
    return READONLY_ONCE_FILLED.has(f) && !!this.value(f) && !this.ocrFilledKeys().has(f);
  }
  isRequired(f: string): boolean { return REQUIRED_FIELDS.has(f); }
  /** Un champ obligatoire mais masqué (ex. régime matrimonial pour un homme célibataire) ne
   *  doit jamais bloquer la progression — seuls les champs visibles sont vérifiés. */
  private stepValid(): boolean {
    return this.step().fields.every((f) => !REQUIRED_FIELDS.has(f) || !this.isVisible(f) || !!this.value(f));
  }
  displayValue(f: string): string {
    if (f === 'identity_document_type') return IDENTITY_TYPE_LABELS[this.value(f)] ?? this.value(f);
    if (f === 'residence') return this.countries().find((c) => c.code === this.value(f))?.name ?? this.value(f);
    return this.value(f);
  }
  /** Les champs "précisez" (autre) ne s'affichent que si l'option "Autre" a été choisie juste avant. */
  isVisible(f: string): boolean {
    if (f === 'funds_origin_other') return this.value('funds_origin') === 'AUTRE';
    if (f === 'account_object_other') return this.value('account_object') === 'AUTRE';
    // Régime matrimonial ne concerne pas un homme célibataire.
    if (f === 'matrimonial_regime') {
      return !(this.value('sex') === 'M' && this.value('marital_status') === 'SINGLE');
    }
    // Nom d'épouse : uniquement pertinent pour une personne mariée ou veuve.
    if (f === 'birth_name') {
      return this.value('marital_status') === 'MARRIED' || this.value('marital_status') === 'WIDOWED';
    }
    return true;
  }
  inputType(f: string): string {
    if (f.includes('date')) return 'date';
    if (f === 'email') return 'email';
    if (f.includes('phone')) return 'tel';
    return 'text';
  }
  options(f: string): { value: string; label: string }[] | null {
    if (ENUMS[f]) return ENUMS[f];
    if (f === 'nationality') return this.nationalities().map((n) => ({ value: n.code, label: n.name }));
    if (f === 'preferred_branch') return this.agencies().map((a) => ({ value: a.code, label: a.name }));
    if (f === 'activity_sector') return this.sectors().map((s) => ({ value: s.code, label: s.name }));
    if (f === 'activity_subsector') {
      const sectorCode = this.value('activity_sector');
      return this.subsectorsAll()
        .filter((s) => !sectorCode || s.sector_code === sectorCode)
        .map((s) => ({ value: s.code, label: s.name }));
    }
    if (f === 'income_range') return this.incomeRanges().map((r) => ({ value: r.code, label: r.name }));
    if (f === 'income_type') return this.incomeTypes().map((r) => ({ value: r.code, label: r.name }));
    if (f === 'funds_origin') return this.fundsOrigins().map((r) => ({ value: r.code, label: r.name }));
    if (f === 'account_object') return this.accountObjects().map((r) => ({ value: r.code, label: r.name }));
    if (f === 'profession') return this.professions().map((r) => ({ value: r.code, label: r.name }));
    return null;
  }
  value(f: string): string { return String((this.model() as Record<string, unknown>)[f] ?? ''); }
  setter(f: string) { return (v: string) => this.set(f, v); }
  setEvt(f: string, e: Event) { this.set(f, (e.target as HTMLInputElement).value); }
  set(f: string, v: unknown): void { this.model.update((m) => ({ ...m, [f]: v })); }
  setConsent = (v: boolean): void => this.set('consent_accepted', v);

  /** Fusionne les champs lus par l'OCR dans le modèle en ne touchant QUE les champs vides — une
   *  valeur déjà présente (saisie du client, ou lecture précédente) n'est jamais écrasée. */
  private fillMissing(
    model: Partial<ApplicationCreate>,
    incoming: Partial<ApplicationCreate>,
  ): Partial<ApplicationCreate> {
    const out = { ...model } as Record<string, unknown>;
    for (const [k, v] of Object.entries(incoming)) {
      const cur = out[k];
      if (v != null && String(v).trim() !== '' && (cur == null || String(cur).trim() === '')) {
        out[k] = v;
      }
    }
    return out as Partial<ApplicationCreate>;
  }

  /** Traduit les valeurs OCR exprimées en libellé vers le code attendu par les listes déroulantes
   *  (ex. nationalité « CAMEROUNAISE » → « CM ») : sans cela, le `<select>` ne peut pas afficher la
   *  valeur lue (ses options sont indexées par code). Une valeur non résolue est retirée — le champ
   *  reste vide, à choisir manuellement (mieux qu'une valeur invisible qui semble « non préremplie »). */
  private resolveOcrCodes(incoming: Partial<ApplicationCreate>): Partial<ApplicationCreate> {
    const out = { ...incoming } as Record<string, unknown>;
    const nat = out['nationality'];
    if (nat != null && String(nat).trim() !== '') {
      const code = this.matchNationalityCode(String(nat));
      if (code) out['nationality'] = code; else delete out['nationality'];
    }
    return out as Partial<ApplicationCreate>;
  }

  /** Retrouve le code d'une nationalité à partir de son libellé OCR (insensible à la casse/aux
   *  accents), en s'appuyant sur la liste chargée depuis le backend (lecture réactive : dès que la
   *  liste arrive, l'effet OCR se rejoue et la nationalité se résout). */
  private matchNationalityCode(raw: string): string | undefined {
    const norm = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
    const target = norm(raw);
    if (!target) return undefined;
    const hit = this.nationalities().find((n) => norm(n.name) === target || n.code.toLowerCase() === target);
    return hit?.code;
  }

  selectPackage(pkg: PackageOffer): void {
    this.model.update((m) => ({
      ...m,
      selected_package_code: pkg.code,
      selected_package_name: pkg.name,
      selected_package_currency: pkg.currency,
      selected_package_opening_fee: pkg.opening_fee,
      selected_package_subscription_fee: pkg.subscription_fee,
      selected_package_monthly_fee: pkg.monthly_fee,
      selected_package_payment_required: pkg.payment_required,
    }));
  }

  onSubmitForm(e: Event): void {
    e.preventDefault();
    if (this.step().key === 'review') { this.submit(); return; }
    if (this.step().kind === 'generic' && !this.stepValid()) {
      this.error.set('Veuillez remplir tous les champs obligatoires avant de continuer.');
      return;
    }
    this.error.set(null);
    this.next();
  }
  next(): void { if (this.current() < this.steps.length) this.current.update((v) => v + 1); }
  prev(): void { this.error.set(null); if (this.current() > 1) this.current.update((v) => v - 1); }

  submit(): void {
    if (!this.model().consent_accepted) {
      this.error.set('Vous devez accepter les conditions de consentement pour continuer.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.api.createApplication(this.model() as ApplicationCreate).subscribe({
      next: (res) => this.router.navigateByUrl(
        `${siblingUrl(this.router, '/onboarding/particulier', '/status')}?reference=${encodeURIComponent(res.reference)}`,
      ),
      error: (err) => { this.error.set('Échec de l’envoi. Vérifiez les champs obligatoires.'); this.submitting.set(false); console.error(err); },
    });
  }
}
