import { Component, EventEmitter, Input, OnInit, Output, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { OnbFormField, OnbInput, OnbSelect } from '../../ui/form-field';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaPhotoCapture } from '../../shared/photo-capture';
import { dataUrlToFile } from '../../shared/file-utils';
import { DiasporaApi } from '../../core/diaspora-api.service';
import { ApplicationCreate } from '../../core/application.model';
import {
  DocumentRequirement, IdentityDocumentType, ResidencyStatus, documentRequirements, identityDocumentOptions,
} from '../../core/residency-rules';

type DocStatus = 'idle' | 'uploading' | 'done' | 'error';
type IdentitySide = 'RECTO' | 'VERSO';

/** Persisté par le parent (DiasporaOnboardingPage) — le composant d'étape est détruit/recréé
 *  à chaque navigation (@switch), donc son état local ne doit rien contenir d'irrécupérable. */
export interface DocumentsStepState {
  status: Record<string, DocStatus>;
  identityType: IdentityDocumentType;
  identitySides: Partial<Record<IdentitySide, DocStatus>>;
  ocrFields: Partial<ApplicationCreate>;
  ocrExtracted: boolean;
  /** Adresse / boîte postale extraites du plan de localisation (best-effort, souvent partiel). */
  addressOcrFields: Partial<ApplicationCreate>;
  /** Aperçus (data URL) déjà capturés/importés, par clé de document ('IDENTITY_RECTO', 'IDENTITY_VERSO', req.key). */
  previews: Record<string, string>;
}
export const EMPTY_DOCUMENTS_STATE: DocumentsStepState = {
  status: {}, identityType: 'CNI', identitySides: {}, ocrFields: {}, ocrExtracted: false, addressOcrFields: {}, previews: {},
};

const OCR_FIELD_LABELS: Record<string, string> = {
  last_name: 'Nom', first_name: 'Prénom', birth_date: 'Date de naissance', birth_place: 'Lieu de naissance',
  nationality: 'Nationalité', identity_document_number: "N° pièce d'identité",
  identity_document_issue_date: 'Date de délivrance', identity_document_issue_place: 'Lieu de délivrance',
};
const OCR_FIELDS: (keyof ApplicationCreate)[] = Object.keys(OCR_FIELD_LABELS) as (keyof ApplicationCreate)[];

// Cartes physiques (recto+verso) — seul le passeport (page photo unique) n'a qu'une face à capturer.
const DOUBLE_SIDED_TYPES: readonly IdentityDocumentType[] = ['CNI', 'CARTE_SEJOUR', 'CARTE_CONSULAIRE'];

/** Étape 2-3 du parcours AFB : capture/import des documents requis, OCR de préremplissage
 *  pour la pièce d'identité (mini-récapitulatif éditable), upload simple pour le reste. */
@Component({
  selector: 'diaspora-documents-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbInput, OnbSelect, DiasporaPhotoCapture],
  template: `
    <form (submit)="onContinue($event)">
    @for (req of requirements(); track req.key) {
      <onb-section-card [title]="req.label" [subtitle]="req.required ? 'Obligatoire' : 'Optionnel'">
        @if (req.key === 'IDENTITY') {
          <onb-form-field label="Type de pièce présentée" required>
            <onb-select [value]="identityType()" [changeFn]="setIdentityType">
              @for (o of identityOptions(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
            </onb-select>
          </onb-form-field>

          <p style="font-size:12px;font-weight:600;color:#151821;margin:14px 0 8px;">
            {{ identityNeedsBothSides() ? 'Recto' : 'Page photo' }}
          </p>
          <diaspora-photo-capture
            [guide]="identityNeedsBothSides() ? 'Cadrez le recto entier, bien à plat.' : 'Cadrez la page photo du passeport, bien à plat.'"
            detect="document" [qualityCheck]="true" [imageData]="previews()['IDENTITY_RECTO'] ?? null"
            facing="environment" [allowFlip]="true" [boxW]="420" [boxH]="265"
            (captured)="onIdentityCaptured('RECTO', $event)" (retake)="onIdentityRetake('RECTO')" />
          @if (identityStatus('RECTO') === 'uploading') { <p style="font-size:12px;color:#6B7280;margin-top:10px;">Analyse en cours…</p> }
          @if (identityStatus('RECTO') === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Recto reçu.</p> }
          @if (identityStatus('RECTO') === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer, une nouvelle tentative sera proposée plus tard.</p> }

          @if (identityNeedsBothSides()) {
            <p style="font-size:12px;font-weight:600;color:#151821;margin:18px 0 8px;">Verso</p>
            <diaspora-photo-capture
              guide="Cadrez le verso entier, bien à plat." detect="document" [qualityCheck]="true"
              [imageData]="previews()['IDENTITY_VERSO'] ?? null"
              facing="environment" [allowFlip]="true" [boxW]="420" [boxH]="265"
              (captured)="onIdentityCaptured('VERSO', $event)" (retake)="onIdentityRetake('VERSO')" />
            @if (identityStatus('VERSO') === 'uploading') { <p style="font-size:12px;color:#6B7280;margin-top:10px;">Envoi en cours…</p> }
            @if (identityStatus('VERSO') === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Verso reçu.</p> }
            @if (identityStatus('VERSO') === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer, une nouvelle tentative sera proposée plus tard.</p> }
          }

          @if (ocrExtracted()) {
            <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(20,20,30,0.08);">
              <p style="font-size:11px;font-weight:700;letter-spacing:0.6px;color:#6B7280;text-transform:uppercase;margin:0 0 12px;">
                Informations extraites — vérifiez et corrigez si besoin
              </p>
              <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
                @for (f of ocrFieldKeys; track f) {
                  <onb-form-field [label]="ocrLabel(f)">
                    <input onbInput type="text" [value]="ocrValue(f)" (input)="setOcrField(f, $any($event.target).value)" />
                  </onb-form-field>
                }
              </div>
            </div>
          }
        } @else {
          <diaspora-photo-capture
            guide="Photographiez ou importez le document." detect="off"
            [imageData]="previews()[req.key] ?? null"
            facing="environment" [allowFlip]="true" [boxW]="420" [boxH]="265"
            (captured)="onCaptured(req, $event)" (retake)="onDocRetake(req.key)" />
          @if (status()[req.key] === 'uploading') { <p style="font-size:12px;color:#6B7280;margin-top:10px;">Analyse en cours…</p> }
          @if (status()[req.key] === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Document reçu.</p> }
          @if (status()[req.key] === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer, une nouvelle tentative sera proposée plus tard.</p> }
        }
      </onb-section-card>
    }

    @if (!ready()) { <p style="font-size:11.5px;color:#6B7280;margin:0 0 10px;">Chargez chaque document obligatoire pour continuer.</p> }
    <onb-step-nav [onBack]="true" (back)="back.emit()" submitLabel="Continuer" />
    </form>
  `,
})
export class DiasporaDocumentsStep implements OnInit {
  private api = inject(DiasporaApi);

  @Input() model: Partial<ApplicationCreate> = {};
  @Output() modelChange = new EventEmitter<Partial<ApplicationCreate>>();
  @Output() next = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  /** État persisté par le parent : restauré tel quel au (re)montage pour survivre à la navigation « Retour ». */
  @Input() state: DocumentsStepState = EMPTY_DOCUMENTS_STATE;
  @Output() stateChange = new EventEmitter<DocumentsStepState>();

  readonly ocrFieldKeys = OCR_FIELDS;

  status = signal<Record<string, DocStatus>>({});
  identityType = signal<IdentityDocumentType>('CNI');
  identitySides = signal<Partial<Record<IdentitySide, DocStatus>>>({});
  ocrFields = signal<Partial<ApplicationCreate>>({});
  ocrExtracted = signal(false);
  addressOcrFields = signal<Partial<ApplicationCreate>>({});
  previews = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.status.set(this.state.status);
    this.identityType.set(this.state.identityType);
    this.identitySides.set(this.state.identitySides);
    this.ocrFields.set(this.state.ocrFields);
    this.ocrExtracted.set(this.state.ocrExtracted);
    this.addressOcrFields.set(this.state.addressOcrFields);
    this.previews.set(this.state.previews);
  }

  private emitState(): void {
    this.stateChange.emit({
      status: this.status(),
      identityType: this.identityType(),
      identitySides: this.identitySides(),
      ocrFields: this.ocrFields(),
      ocrExtracted: this.ocrExtracted(),
      addressOcrFields: this.addressOcrFields(),
      previews: this.previews(),
    });
  }

  requirements = computed<DocumentRequirement[]>(() =>
    documentRequirements((this.model.residency_status as ResidencyStatus) ?? 'NON_RESIDENT', this.model.residence),
  );
  identityOptions = computed(() =>
    identityDocumentOptions((this.model.residency_status as ResidencyStatus) ?? 'NON_RESIDENT', this.model.residence),
  );
  identityNeedsBothSides = computed(() => DOUBLE_SIDED_TYPES.includes(this.identityType()));

  /** Tous les documents obligatoires ont au moins été tentés (l'échec réseau n'empêche pas de continuer). */
  ready = computed(() =>
    this.requirements()
      .filter((r) => r.required)
      .every((r) => {
        if (r.key === 'IDENTITY') {
          const sides = this.identitySides();
          const rectoOk = !!sides.RECTO && sides.RECTO !== 'idle';
          return this.identityNeedsBothSides() ? rectoOk && !!sides.VERSO && sides.VERSO !== 'idle' : rectoOk;
        }
        return !!this.status()[r.key] && this.status()[r.key] !== 'idle';
      }),
  );

  setIdentityType = (v: string): void => { this.identityType.set(v as IdentityDocumentType); this.emitState(); };

  identityStatus(side: IdentitySide): DocStatus {
    return this.identitySides()[side] ?? 'idle';
  }

  ocrLabel(f: string): string { return OCR_FIELD_LABELS[f] ?? f; }
  ocrValue(f: keyof ApplicationCreate): string { return String(this.ocrFields()[f] ?? ''); }
  setOcrField(f: keyof ApplicationCreate, v: string): void {
    this.ocrFields.update((m) => ({ ...m, [f]: v }));
    this.emitState();
  }

  onIdentityRetake(side: IdentitySide): void {
    this.identitySides.update((s) => ({ ...s, [side]: 'idle' }));
    this.previews.update((p) => { const { [`IDENTITY_${side}`]: _, ...rest } = p; return rest; });
    this.emitState();
  }

  onDocRetake(key: string): void {
    this.status.update((s) => ({ ...s, [key]: 'idle' }));
    this.previews.update((p) => { const { [key]: _, ...rest } = p; return rest; });
    this.emitState();
  }

  async onIdentityCaptured(side: IdentitySide, dataUrl: string): Promise<void> {
    this.previews.update((p) => ({ ...p, [`IDENTITY_${side}`]: dataUrl }));

    if (side === 'RECTO') {
      // La MRZ (nom/prénom/date de naissance/nationalité) est au verso pour une carte —
      // on attend donc le verso pour lancer l'OCR. Pour un passeport (une seule face), le
      // recto suffit (MRZ en bas de la page photo) : on lance l'extraction tout de suite.
      if (this.identityNeedsBothSides()) {
        this.identitySides.update((s) => ({ ...s, RECTO: 'done' }));
        this.emitState();
      } else {
        const file = await dataUrlToFile(dataUrl, 'identity-recto.jpg');
        this.runExtraction(file, null);
      }
      return;
    }

    // VERSO
    this.identitySides.update((s) => ({ ...s, VERSO: 'uploading' }));
    this.emitState();
    const versoFile = await dataUrlToFile(dataUrl, 'identity-verso.jpg');

    const sessionId = this.model.pre_onboarding_session_id;
    if (sessionId) {
      this.api.preOnboardingUploadDocument(sessionId, versoFile, 'IDENTITY_VERSO').subscribe({
        next: () => { this.identitySides.update((s) => ({ ...s, VERSO: 'done' })); this.emitState(); },
        error: () => { this.identitySides.update((s) => ({ ...s, VERSO: 'error' })); this.emitState(); },
      });
    } else {
      this.identitySides.update((s) => ({ ...s, VERSO: 'error' }));
      this.emitState();
    }

    const rectoDataUrl = this.previews()['IDENTITY_RECTO'];
    if (rectoDataUrl) {
      const rectoFile = await dataUrlToFile(rectoDataUrl, 'identity-recto.jpg');
      this.runExtraction(rectoFile, versoFile);
    }
  }

  private runExtraction(recto: File, verso: File | null): void {
    this.identitySides.update((s) => ({ ...s, RECTO: 'uploading' }));
    this.emitState();
    this.api.preOnboardingExtract(recto, this.identityType(), verso ?? undefined).subscribe({
      next: (res: any) => {
        this.identitySides.update((s) => ({ ...s, RECTO: 'done' }));
        const extracted: Partial<ApplicationCreate> = {};
        for (const f of OCR_FIELDS) if (res?.[f] != null) (extracted as any)[f] = res[f];
        this.ocrFields.set(extracted);
        this.ocrExtracted.set(true);
        this.emitState();
      },
      error: () => {
        // OCR indisponible (backend séparé non branché) — l'utilisateur saisit manuellement.
        this.identitySides.update((s) => ({ ...s, RECTO: 'error' }));
        this.ocrExtracted.set(true);
        this.emitState();
      },
    });
  }

  async onCaptured(req: DocumentRequirement, dataUrl: string): Promise<void> {
    this.status.update((s) => ({ ...s, [req.key]: 'uploading' }));
    this.previews.update((p) => ({ ...p, [req.key]: dataUrl }));
    this.emitState();
    const ext = dataUrl.startsWith('data:application/pdf') ? 'pdf' : 'jpg';
    const file = await dataUrlToFile(dataUrl, `${req.key.toLowerCase()}.${ext}`);

    const sessionId = this.model.pre_onboarding_session_id;
    if (!sessionId) { this.status.update((s) => ({ ...s, [req.key]: 'error' })); this.emitState(); return; }
    this.api.preOnboardingUploadDocument(sessionId, file, req.key).subscribe({
      next: () => { this.status.update((s) => ({ ...s, [req.key]: 'done' })); this.emitState(); },
      error: () => { this.status.update((s) => ({ ...s, [req.key]: 'error' })); this.emitState(); },
    });

    // Plan de localisation : tentative d'extraction best-effort de l'adresse / boîte postale,
    // pour préremplir l'étape « Coordonnées & personnes à contacter » (l'utilisateur reste libre
    // de corriger — l'OCR d'un plan dessiné à la main est intrinsèquement peu fiable).
    if (req.key === 'ADDRESS_PROOF' && !file.type.startsWith('application/pdf')) {
      this.api.preOnboardingExtractAddress(file).subscribe({
        next: (res) => {
          const extracted: Partial<ApplicationCreate> = {};
          if (res.address_location) extracted.address_location = res.address_location;
          if (res.postal_box) extracted.postal_box = res.postal_box;
          if (Object.keys(extracted).length) { this.addressOcrFields.set(extracted); this.emitState(); }
        },
        error: () => { /* best-effort — l'utilisateur saisit manuellement en cas d'échec */ },
      });
    }
  }

  onContinue(e: Event): void {
    e.preventDefault();
    if (!this.ready()) return;
    this.modelChange.emit({
      ...this.model,
      ...this.addressOcrFields(),
      ...this.ocrFields(),
      identity_document_type: this.identityType(),
    });
    this.next.emit();
  }
}
