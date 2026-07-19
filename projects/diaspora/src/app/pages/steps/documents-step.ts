import { Component, EventEmitter, Input, OnInit, Output, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { OnbFormField, OnbSelect } from '../../ui/form-field';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaPhotoCapture } from '../../shared/photo-capture';
import { dataUrlToFile } from '../../shared/file-utils';
import { DiasporaApi } from '../../core/diaspora-api.service';
import { OcrPrefillService } from '../../core/ocr-prefill.service';
import { ApplicationCreate } from '../../core/application.model';
import {
  DocumentRequirement, IdentityDocumentType, ResidencyStatus, documentRequirements, identityDocumentOptions,
} from '../../core/residency-rules';

type DocStatus = 'idle' | 'uploading' | 'done' | 'error';
type IdentitySide = 'RECTO' | 'VERSO';

/** Persisté par le parent (DiasporaOnboardingPage) — le composant d'étape est détruit/recréé
 *  à chaque navigation (@switch), donc son état local ne doit rien contenir d'irrécupérable.
 *  La lecture OCR (champs lus, alertes, progression) vit désormais dans OcrPrefillService, qui
 *  survit lui aussi à la navigation : elle n'a donc plus sa place ici. */
export interface DocumentsStepState {
  status: Record<string, DocStatus>;
  identityType: IdentityDocumentType;
  identitySides: Partial<Record<IdentitySide, DocStatus>>;
  /** Aperçus (data URL) déjà capturés/importés, par clé de document ('IDENTITY_RECTO', 'IDENTITY_VERSO', req.key). */
  previews: Record<string, string>;
}
export const EMPTY_DOCUMENTS_STATE: DocumentsStepState = {
  status: {}, identityType: 'CNI', identitySides: {}, previews: {},
};

// Cartes physiques (recto+verso) — seul le passeport (page photo unique) n'a qu'une face à capturer.
const DOUBLE_SIDED_TYPES: readonly IdentityDocumentType[] = ['CNI', 'CARTE_SEJOUR', 'CARTE_CONSULAIRE'];

/** Étape « Documents » du parcours AFB : capture/import des documents requis. La pièce d'identité
 *  est simplement RECONNUE ici (bon type / bon côté). Sa LECTURE (OCR de préremplissage) se poursuit
 *  en arrière-plan via OcrPrefillService pendant que le client remplit la suite — les champs lus
 *  préremplissent alors les étapes « Informations personnelles » et « Activité & conformité ». Le
 *  client ne l'attend jamais. Les autres documents sont un simple upload. */
@Component({
  selector: 'diaspora-documents-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, OnbFormField, OnbSelect, DiasporaPhotoCapture],
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

          @if (ocr.authenticityWarning(); as w) {
            <div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:#FDECEC;border:1px solid rgba(200,16,46,0.28);color:#8f0e15;font-size:12px;line-height:1.4;">
              ⚠ {{ w }}
            </div>
          }
          @if (ocr.sideWarning(); as w) {
            <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:#FFF9E6;border:1px solid rgba(245,197,66,0.55);color:#8a6d00;font-size:12px;line-height:1.4;">
              ⚠ {{ w }}
            </div>
          }

          <!-- Lecture menée en arrière-plan : le client n'attend pas, l'extraction préremplit
               l'étape « Informations personnelles » (et « Activité & conformité ») quand elle aboutit. -->
          @if (ocr.extracting()) {
            <p style="font-size:12px;color:#6B7280;margin-top:14px;">Lecture de la pièce en arrière-plan — inutile d'attendre, vous pouvez continuer.</p>
          } @else if (ocr.extracted() && !ocr.authenticityWarning()) {
            <p style="font-size:12px;color:#16A34A;margin-top:14px;">Pièce lue — vos informations personnelles seront préremplies à l'étape suivante.</p>
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
  /** Lecture OCR en arrière-plan : partagée avec le parent (même instance, scope page). */
  readonly ocr = inject(OcrPrefillService);

  @Input() model: Partial<ApplicationCreate> = {};
  @Output() modelChange = new EventEmitter<Partial<ApplicationCreate>>();
  @Output() next = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  /** État persisté par le parent : restauré tel quel au (re)montage pour survivre à la navigation « Retour ». */
  @Input() state: DocumentsStepState = EMPTY_DOCUMENTS_STATE;
  @Output() stateChange = new EventEmitter<DocumentsStepState>();

  status = signal<Record<string, DocStatus>>({});
  identityType = signal<IdentityDocumentType>('CNI');
  identitySides = signal<Partial<Record<IdentitySide, DocStatus>>>({});
  previews = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.status.set(this.state.status);
    this.identityType.set(this.state.identityType);
    this.identitySides.set(this.state.identitySides);
    this.previews.set(this.state.previews);
    // Le défaut 'CNI' n'existe pas pour un non-résident hors CEMAC (passeport/séjour/consulaire) :
    // le <select> s'affichait VIDE et le flux traitait la pièce comme une carte recto/verso.
    // On recale sur la première option réellement proposée.
    const opts = this.identityOptions();
    if (opts.length && !opts.some((o) => o.value === this.identityType())) {
      this.identityType.set(opts[0].value);
      this.emitState();
    }
  }

  private emitState(): void {
    this.stateChange.emit({
      status: this.status(),
      identityType: this.identityType(),
      identitySides: this.identitySides(),
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

  private sessionId(): string | undefined { return this.model.pre_onboarding_session_id ?? undefined; }
  private accountType(): string { return this.model.client_type ?? 'PARTICULIER'; }

  onIdentityRetake(side: IdentitySide): void {
    this.identitySides.update((s) => ({ ...s, [side]: 'idle' }));
    this.previews.update((p) => { const { [`IDENTITY_${side}`]: _, ...rest } = p; return rest; });
    // Nouvelle capture => la lecture précédente n'est plus valable.
    this.ocr.resetIdentity();
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
      const rectoFile = await dataUrlToFile(dataUrl, 'identity-recto.jpg');
      // Portrait de la pièce = image de RÉFÉRENCE pour la comparaison faciale : envoyée à la
      // session sous CNI_RECTO, seul emplacement « document » qu'examine le moteur face-match
      // du backend. Non bloquant.
      this.uploadIdentityReference('IDENTITY_RECTO', rectoFile);
      // La capture est acceptée immédiatement : le client peut poursuivre.
      this.identitySides.update((s) => ({ ...s, RECTO: 'done' }));
      // La MRZ (nom/prénom/date de naissance/nationalité) est au verso pour une carte — on attend
      // donc le verso pour lancer la lecture. Pour un passeport (une seule face), le recto suffit
      // (MRZ en bas de la page photo) : on lance la lecture tout de suite, en arrière-plan.
      if (!this.identityNeedsBothSides()) {
        this.ocr.extractIdentity(rectoFile, this.identityType(), null, this.accountType(), this.sessionId());
      }
      this.emitState();
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

    // Recto + verso en main => lecture OCR en arrière-plan.
    const rectoDataUrl = this.previews()['IDENTITY_RECTO'];
    if (rectoDataUrl) {
      const rectoFile = await dataUrlToFile(rectoDataUrl, 'identity-recto.jpg');
      this.ocr.extractIdentity(rectoFile, this.identityType(), versoFile, this.accountType(), this.sessionId());
    }
  }

  /** Envoie la pièce à la session comme référence face-match (best-effort, non bloquant). */
  private uploadIdentityReference(documentKey: 'IDENTITY_RECTO' | 'IDENTITY_VERSO', file: File): void {
    const sessionId = this.model.pre_onboarding_session_id;
    if (!sessionId) return;
    this.api.preOnboardingUploadDocument(sessionId, file, documentKey).subscribe({ next: () => {}, error: () => {} });
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

    // Plan de localisation : lecture best-effort de l'adresse / boîte postale, en arrière-plan,
    // pour préremplir l'étape « Coordonnées & personnes à contacter » (l'utilisateur reste libre
    // de corriger — l'OCR d'un plan dessiné à la main est intrinsèquement peu fiable).
    if (req.key === 'ADDRESS_PROOF' && !file.type.startsWith('application/pdf')) {
      this.ocr.extractAddress(file);
    }
  }

  onContinue(e: Event): void {
    e.preventDefault();
    if (!this.ready()) return;
    // Les champs lus sur la pièce sont fusionnés dans le modèle par le parent (via OcrPrefillService),
    // au fur et à mesure de la lecture — ici on ne remonte que le type de pièce choisi.
    this.modelChange.emit({ ...this.model, identity_document_type: this.identityType() });
    this.next.emit();
  }
}
