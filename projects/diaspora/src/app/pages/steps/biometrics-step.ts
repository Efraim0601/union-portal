import { Component, EventEmitter, Input, OnInit, Output, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaPhotoCapture } from '../../shared/photo-capture';
import { DiasporaLivenessVideoCapture } from '../../shared/liveness-video-capture';
import { dataUrlToFile, blobToFile } from '../../shared/file-utils';
import { DiasporaApi, FaceMatchResult } from '../../core/diaspora-api.service';
import { ApplicationCreate } from '../../core/application.model';

type BioStatus = 'idle' | 'uploading' | 'done' | 'error';

/** Verdict de la vérification faciale (visage filmé ↔ photo de la pièce d'identité). */
type FaceVerdict = 'idle' | 'checking' | 'verified' | 'failed' | 'unavailable';

const FACE_REASON_LABELS: Record<string, string> = {
  NO_FACE_VIDEO: 'Aucun visage détecté dans la vidéo.',
  NO_VIDEO: 'Vidéo manquante.',
  NO_FACE_CNI: "Aucun visage détecté sur la pièce d'identité.",
  NO_CNI: "Pièce d'identité de référence manquante.",
  NO_FACE_SELFIE: 'Aucun visage détecté sur le selfie.',
  NOT_ENOUGH_SOURCES: 'Sources insuffisantes pour la vérification.',
};
function translateFaceReason(code: string): string {
  return FACE_REASON_LABELS[code] ?? code;
}

/** Persisté par le parent (DiasporaOnboardingPage) — le composant d'étape est détruit/recréé
 *  à chaque navigation (@switch), donc son état local ne doit rien contenir d'irrécupérable. */
export interface BiometricsStepState {
  selfieDone: boolean;
  videoDone: boolean;
  selfieStatus: BioStatus;
  videoStatus: BioStatus;
  selfiePreview: string | null;
  /** Verdict de la vérification faciale (persisté pour survivre à la navigation « Retour »). */
  faceStatus: FaceVerdict;
  faceMessage: string | null;
}
export const EMPTY_BIOMETRICS_STATE: BiometricsStepState = {
  selfieDone: false, videoDone: false, selfieStatus: 'idle', videoStatus: 'idle', selfiePreview: null,
  faceStatus: 'idle', faceMessage: null,
};

/** Étape 2-3 (biométrie) du parcours AFB : selfie photo (liveness live) + courte vidéo de vérification. */
@Component({
  selector: 'diaspora-biometrics-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbStepNav, DiasporaPhotoCapture, DiasporaLivenessVideoCapture],
  template: `
    <form (submit)="onContinue($event)">
      <onb-section-card title="Selfie" subtitle="Placez votre visage dans le cadre, la capture se déclenche automatiquement.">
        <diaspora-photo-capture
          [round]="true" [boxW]="220" [boxH]="220" detect="face" [allowGallery]="false"
          guide="Placez votre visage au centre du cadre — la photo se prend automatiquement."
          [imageData]="selfiePreview()" (captured)="onSelfie($event)" (retake)="onSelfieRetake()" />
        @if (selfieStatus() === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Selfie reçu.</p> }
        @if (selfieStatus() === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer.</p> }
      </onb-section-card>

      <onb-section-card title="Vidéo de vérification" subtitle="Filmez votre visage quelques secondes.">
        <diaspora-liveness-video [boxW]="220" [boxH]="220" (captured)="onVideo($event)" />
        @if (videoStatus() === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Vidéo reçue.</p> }
        @if (videoStatus() === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer.</p> }
      </onb-section-card>

      @if (faceStatus() !== 'idle') {
        <onb-section-card title="Vérification d'identité" subtitle="Comparaison du visage filmé avec la photo de votre pièce.">
          @switch (faceStatus()) {
            @case ('checking') {
              <p style="font-size:13px;color:#6B7280;margin:0;display:flex;align-items:center;gap:8px;">
                <span style="width:10px;height:10px;border-radius:50%;background:#F5C542;display:inline-block;"></span>
                Analyse faciale en cours…
              </p>
            }
            @case ('verified') {
              <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:#EAF7EE;border:1px solid rgba(22,163,74,0.3);">
                <span style="font-size:18px;color:#16A34A;">✓</span>
                <p style="font-size:13px;color:#15803D;margin:0;font-weight:600;">Identité vérifiée — le visage correspond à votre pièce.</p>
              </div>
            }
            @case ('failed') {
              <div style="padding:12px 14px;border-radius:10px;background:#FDECEC;border:1px solid rgba(200,16,46,0.28);">
                <p style="font-size:13px;color:#8f0e15;margin:0 0 4px;font-weight:600;">Vérification non concluante</p>
                <p style="font-size:12px;color:#8f0e15;margin:0;line-height:1.4;">{{ faceMessage() }} Vous pouvez continuer ; un conseiller vérifiera manuellement.</p>
              </div>
            }
            @case ('unavailable') {
              <p style="font-size:12px;color:#6B7280;margin:0;line-height:1.4;">{{ faceMessage() }} La vérification sera effectuée lors de l'examen du dossier.</p>
            }
          }
        </onb-section-card>
      }

      @if (!ready()) { <p style="font-size:11.5px;color:#6B7280;margin:0 0 10px;">Prenez le selfie et la vidéo pour continuer.</p> }
      <onb-step-nav [onBack]="true" (back)="back.emit()" submitLabel="Continuer" [isLoading]="false" />
    </form>
  `,
})
export class DiasporaBiometricsStep implements OnInit {
  private api = inject(DiasporaApi);

  @Input() model: Partial<ApplicationCreate> = {};
  @Output() modelChange = new EventEmitter<Partial<ApplicationCreate>>();
  @Output() next = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  /** État persisté par le parent : restauré tel quel au (re)montage pour survivre à la navigation « Retour ». */
  @Input() state: BiometricsStepState = EMPTY_BIOMETRICS_STATE;
  @Output() stateChange = new EventEmitter<BiometricsStepState>();

  selfieDone = signal(false);
  videoDone = signal(false);
  selfieStatus = signal<BioStatus>('idle');
  videoStatus = signal<BioStatus>('idle');
  selfiePreview = signal<string | null>(null);
  faceStatus = signal<FaceVerdict>('idle');
  faceMessage = signal<string | null>(null);
  ready = computed(() => this.selfieDone() && this.videoDone());

  ngOnInit(): void {
    this.selfieDone.set(this.state.selfieDone);
    this.videoDone.set(this.state.videoDone);
    this.selfieStatus.set(this.state.selfieStatus);
    this.videoStatus.set(this.state.videoStatus);
    this.selfiePreview.set(this.state.selfiePreview);
    this.faceStatus.set(this.state.faceStatus ?? 'idle');
    this.faceMessage.set(this.state.faceMessage ?? null);
  }

  private emitState(): void {
    this.stateChange.emit({
      selfieDone: this.selfieDone(),
      videoDone: this.videoDone(),
      selfieStatus: this.selfieStatus(),
      videoStatus: this.videoStatus(),
      selfiePreview: this.selfiePreview(),
      faceStatus: this.faceStatus(),
      faceMessage: this.faceMessage(),
    });
  }

  onSelfieRetake(): void {
    this.selfieDone.set(false);
    this.selfieStatus.set('idle');
    this.selfiePreview.set(null);
    this.emitState();
  }

  async onSelfie(dataUrl: string): Promise<void> {
    this.selfieStatus.set('uploading');
    this.selfiePreview.set(dataUrl);
    this.emitState();
    const sessionId = this.model.pre_onboarding_session_id;
    const file = await dataUrlToFile(dataUrl, 'selfie.jpg');
    if (!sessionId) { this.selfieStatus.set('error'); this.selfieDone.set(true); this.emitState(); return; }
    this.api.preOnboardingUploadDocument(sessionId, file, 'SELFIE').subscribe({
      next: () => { this.selfieStatus.set('done'); this.selfieDone.set(true); this.emitState(); },
      error: () => { this.selfieStatus.set('error'); this.selfieDone.set(true); this.emitState(); },
    });
  }

  onVideo(blob: Blob): void {
    this.videoStatus.set('uploading');
    this.faceStatus.set('checking');
    this.faceMessage.set(null);
    this.emitState();
    const sessionId = this.model.pre_onboarding_session_id;
    const file = blobToFile(blob, 'liveness.webm');
    if (!sessionId) {
      this.videoStatus.set('error'); this.videoDone.set(true);
      this.faceStatus.set('unavailable');
      this.faceMessage.set('Vérification faciale indisponible (session absente).');
      this.emitState();
      return;
    }
    // L'upload du CLIENT_VIDEO déclenche côté backend la comparaison faciale
    // (vidéo ↔ selfie ↔ photo CNI) : le verdict revient dans la réponse `face_match`.
    this.api.preOnboardingUploadDocument(sessionId, file, 'LIVENESS_VIDEO').subscribe({
      next: (res) => {
        this.videoStatus.set('done'); this.videoDone.set(true);
        this.applyFaceVerdict(res.face_match);
        this.emitState();
      },
      error: () => {
        this.videoStatus.set('error'); this.videoDone.set(true);
        this.faceStatus.set('unavailable');
        this.faceMessage.set('Vérification faciale indisponible pour le moment.');
        this.emitState();
      },
    });
  }

  /** Traduit le `face_match` du backend en verdict affichable. Soft-gate : jamais bloquant. */
  private applyFaceVerdict(fm?: FaceMatchResult): void {
    const identity = fm?.identity;
    if (!fm || fm.status === 'MODELS_MISSING' || (!identity && !fm.references)) {
      this.faceStatus.set('unavailable');
      this.faceMessage.set('Vérification faciale indisponible pour le moment.');
      return;
    }
    if (identity?.match) {
      this.faceStatus.set('verified');
      this.faceMessage.set(null);
      return;
    }
    this.faceStatus.set('failed');
    const reasons = identity?.reasons ?? [];
    this.faceMessage.set(
      reasons.length
        ? reasons.map(translateFaceReason).join(' ')
        : "Le visage ne correspond pas de façon fiable à votre pièce d'identité.",
    );
  }

  onContinue(e: Event): void {
    e.preventDefault();
    if (!this.ready()) return;
    this.modelChange.emit({ ...this.model });
    this.next.emit();
  }
}
