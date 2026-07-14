import { Component, EventEmitter, Input, OnInit, Output, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { OnbSectionCard, OnbStepNav } from '../../ui/section-card';
import { DiasporaPhotoCapture } from '../../shared/photo-capture';
import { DiasporaLivenessVideoCapture } from '../../shared/liveness-video-capture';
import { dataUrlToFile, blobToFile } from '../../shared/file-utils';
import { DiasporaApi } from '../../core/diaspora-api.service';
import { ApplicationCreate } from '../../core/application.model';

type BioStatus = 'idle' | 'uploading' | 'done' | 'error';

/** Persisté par le parent (DiasporaOnboardingPage) — le composant d'étape est détruit/recréé
 *  à chaque navigation (@switch), donc son état local ne doit rien contenir d'irrécupérable. */
export interface BiometricsStepState {
  selfieDone: boolean;
  videoDone: boolean;
  selfieStatus: BioStatus;
  videoStatus: BioStatus;
  selfiePreview: string | null;
}
export const EMPTY_BIOMETRICS_STATE: BiometricsStepState = {
  selfieDone: false, videoDone: false, selfieStatus: 'idle', videoStatus: 'idle', selfiePreview: null,
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
          [imageData]="selfiePreview()" (captured)="onSelfie($event)" (retake)="onSelfieRetake()" />
        @if (selfieStatus() === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Selfie reçu.</p> }
        @if (selfieStatus() === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer.</p> }
      </onb-section-card>

      <onb-section-card title="Vidéo de vérification" subtitle="Filmez votre visage quelques secondes.">
        <diaspora-liveness-video [boxW]="220" [boxH]="220" (captured)="onVideo($event)" />
        @if (videoStatus() === 'done') { <p style="font-size:12px;color:#16A34A;margin-top:10px;">Vidéo reçue.</p> }
        @if (videoStatus() === 'error') { <p style="font-size:12px;color:#C8102E;margin-top:10px;">Échec de l'envoi — vous pouvez continuer.</p> }
      </onb-section-card>

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
  ready = computed(() => this.selfieDone() && this.videoDone());

  ngOnInit(): void {
    this.selfieDone.set(this.state.selfieDone);
    this.videoDone.set(this.state.videoDone);
    this.selfieStatus.set(this.state.selfieStatus);
    this.videoStatus.set(this.state.videoStatus);
    this.selfiePreview.set(this.state.selfiePreview);
  }

  private emitState(): void {
    this.stateChange.emit({
      selfieDone: this.selfieDone(),
      videoDone: this.videoDone(),
      selfieStatus: this.selfieStatus(),
      videoStatus: this.videoStatus(),
      selfiePreview: this.selfiePreview(),
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
    this.emitState();
    const sessionId = this.model.pre_onboarding_session_id;
    const file = blobToFile(blob, 'liveness.webm');
    if (!sessionId) { this.videoStatus.set('error'); this.videoDone.set(true); this.emitState(); return; }
    this.api.preOnboardingUploadDocument(sessionId, file, 'LIVENESS_VIDEO').subscribe({
      next: () => { this.videoStatus.set('done'); this.videoDone.set(true); this.emitState(); },
      error: () => { this.videoStatus.set('error'); this.videoDone.set(true); this.emitState(); },
    });
  }

  onContinue(e: Event): void {
    e.preventDefault();
    if (!this.ready()) return;
    this.modelChange.emit({ ...this.model });
    this.next.emit();
  }
}
