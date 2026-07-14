import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, signal } from '@angular/core';
import { DspIcon } from './capture-icons';

/**
 * Courte vidéo de vérification (liveness) : démarrage manuel, enregistrement automatique de
 * `durationMs`, aperçu + reprise. Pas de gating par détection de visage sur la vidéo (contrairement
 * au selfie photo) — amélioration future possible, hors périmètre pour cette itération.
 */
@Component({
  selector: 'diaspora-liveness-video',
  standalone: true,
  imports: [DspIcon],
  template: `
    @if (videoUrl()) {
      <div style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;background:#fff;border:1px solid rgba(20,20,30,0.10);border-radius:12px;">
        <div [style.width.px]="boxW" [style.height.px]="boxH" style="position:relative;overflow:hidden;border-radius:16px;box-shadow:0 8px 20px rgba(20,20,30,0.10);background:#151821;">
          <video [src]="videoUrl()" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>
        </div>
        <button type="button" (click)="reset()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;font-size:13px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
          <dsp-ic name="refresh" [size]="16"></dsp-ic> Reprendre
        </button>
      </div>
    } @else {
      <div style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;background:#fff;border:1px solid rgba(20,20,30,0.10);border-radius:12px;">
        <div [style.width.px]="boxW" [style.height.px]="boxH" style="position:relative;overflow:hidden;border-radius:16px;background:#151821;display:flex;align-items:center;justify-content:center;">
          <video #video autoplay playsinline muted
                 [style.display]="streaming() ? 'block' : 'none'"
                 style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);"></video>
          @if (!streaming()) {
            <dsp-ic name="camera" [size]="42" style="color:rgba(255,255,255,.35)"></dsp-ic>
          }
          @if (recording()) {
            <span style="position:absolute;top:10px;right:10px;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.55);color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;">
              <span style="width:8px;height:8px;border-radius:50%;background:#C8102E;"></span>
              {{ countdown() }}s
            </span>
          }
        </div>
        <p style="font-size:12px;color:#6B7280;text-align:center;line-height:1.45;max-width:260px;margin:0;">
          {{ guide || 'Filmez votre visage quelques secondes, en tournant légèrement la tête.' }}
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          @if (!streaming()) {
            <button type="button" (click)="start()" [disabled]="starting()" style="width:auto;padding:11px 18px;display:inline-flex;align-items:center;gap:8px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
              <dsp-ic name="camera" [size]="18"></dsp-ic> Activer la caméra
            </button>
          } @else if (!recording()) {
            <button type="button" (click)="record()" style="width:auto;padding:11px 18px;display:inline-flex;align-items:center;gap:8px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
              <dsp-ic name="camera" [size]="18"></dsp-ic> Démarrer l'enregistrement
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class DiasporaLivenessVideoCapture implements OnDestroy {
  @Input() boxW = 240;
  @Input() boxH = 240;
  @Input() durationMs = 4000;
  @Input() guide = '';
  @Output() captured = new EventEmitter<Blob>();
  @Output() retake = new EventEmitter<void>();

  @ViewChild('video') video?: ElementRef<HTMLVideoElement>;

  streaming = signal(false);
  starting = signal(false);
  recording = signal(false);
  countdown = signal(0);
  videoUrl = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private simulatedDrawTimer: ReturnType<typeof setInterval> | null = null;

  async start() {
    this.starting.set(true);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    } catch {
      // Pas de caméra disponible — flux simulé (canvas animé) pour ne pas bloquer le test du
      // parcours, comme le repli déjà en place côté photo (diaspora-photo-capture.simulate()).
      this.stream = this.buildSimulatedStream();
    }
    this.streaming.set(true);
    setTimeout(() => { if (this.video) this.video.nativeElement.srcObject = this.stream; }, 0);
    this.starting.set(false);
  }

  private buildSimulatedStream(): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = this.boxW; canvas.height = this.boxH;
    const ctx = canvas.getContext('2d')!;
    let t = 0;
    this.simulatedDrawTimer = setInterval(() => {
      t += 0.05;
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      g.addColorStop(0, '#F3E4D8'); g.addColorStop(1, '#D8B8A0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8f6a52';
      const cx = canvas.width / 2 + Math.sin(t) * 6;
      ctx.beginPath(); ctx.arc(cx, canvas.height * 0.4, canvas.width * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(canvas.width / 2, canvas.height, canvas.width * 0.3, canvas.height * 0.28, 0, Math.PI, 0, true); ctx.fill();
    }, 1000 / 15);
    return (canvas as HTMLCanvasElement & { captureStream(frameRate?: number): MediaStream }).captureStream(15);
  }

  record() {
    if (!this.stream) return;
    this.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: mimeType });
      this.videoUrl.set(URL.createObjectURL(blob));
      this.stopStream();
      this.captured.emit(blob);
    };
    this.recorder.start();
    this.recording.set(true);
    this.countdown.set(Math.ceil(this.durationMs / 1000));
    this.countdownTimer = setInterval(() => {
      this.countdown.update((v) => Math.max(0, v - 1));
    }, 1000);
    this.stopTimer = setTimeout(() => this.stopRecording(), this.durationMs);
  }

  private stopRecording() {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    this.recording.set(false);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  reset() {
    const url = this.videoUrl();
    if (url) URL.revokeObjectURL(url);
    this.videoUrl.set(null);
    this.streaming.set(false);
    this.retake.emit();
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.streaming.set(false);
    if (this.simulatedDrawTimer) { clearInterval(this.simulatedDrawTimer); this.simulatedDrawTimer = null; }
  }

  ngOnDestroy() {
    this.stopRecording();
    this.stopStream();
    const url = this.videoUrl();
    if (url) URL.revokeObjectURL(url);
  }
}
