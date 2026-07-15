import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject, signal } from '@angular/core';
import { DspIcon } from './capture-icons';
import { assessClarity, assessDocument, DocIssue } from './image-quality';
import { FaceDetection, FaceMesh } from './face-mesh';

/** Boîte englobante normalisée (0..1) — pièce d'identité ou visage, utilisée pour le cadrage live. */
type TrackedBox = { x: number; y: number; w: number; h: number };

/** Live detection on the preview: 'face' (selfie head check), 'document' (ID auto-frame), or off. */
export type DetectMode = 'off' | 'face' | 'document';
/** State surfaced by the live detector, drives the on-screen hint + the ready ring. */
export type DetectState =
  | 'idle' | 'searching' | 'none' | 'multiple'
  | 'too_small' | 'too_close' | 'offcenter' | 'look_straight' | 'tilt'
  | 'dark' | 'blurry' | 'ready';

/** Ported from projects/promote/src/app/shared/photo-capture.ts — same engine, French strings inlined
 *  (diaspora has no i18n abstraction) and plain inline SVGs instead of promote's IconComponent. */
const KYC_SMART_CAPTURE = true;

const T: Record<string, string> = {
  selfie_retake: 'Reprendre',
  cam_gallery: 'Choisir depuis la galerie',
  cam_open: 'Afficher la caméra',
  cam_take: 'Prendre la photo',
  cam_front: 'Caméra avant',
  cam_rear: 'Caméra arrière',
  selfie_guide: 'Cadrez votre visage ou le document dans le cadre.',
  selfie_shooting: 'Capture…',
  q_blurry: 'Image floue — tenez le document bien à plat et stable, puis reprenez.',
  q_dark: 'Image trop sombre — placez-vous dans un endroit mieux éclairé.',
  q_glare: 'Reflet / trop de lumière — évitez le flash et inclinez le document pour supprimer le reflet.',
  q_too_far: 'Document trop petit — rapprochez-le pour remplir le cadre.',
  q_cut_off: 'Document coupé — replacez tout le document (4 coins) dans le cadre.',
  q_no_card: 'Document non détecté — posez-le sur un fond uni et cadrez-le dans le rectangle.',
  q_keep_or_retake: 'Vous pouvez reprendre la photo ou la conserver telle quelle.',
  cap_searching: 'Recherche en cours…',
  cap_none: 'Aucun visage détecté — placez votre visage face à la caméra.',
  cap_multiple: 'Plusieurs visages détectés — restez seul dans le cadre.',
  cap_too_small: 'Rapprochez-vous pour remplir le cadre.',
  cap_offcenter: 'Centrez bien le visage dans le cadre.',
  cap_too_close: 'Reculez un peu, le visage est trop près.',
  cap_look_straight: 'Regardez droit vers la caméra.',
  cap_tilt: 'Tenez la tête droite (sans incliner).',
  cap_dark: 'Trop sombre — placez-vous dans un endroit mieux éclairé.',
  cap_blurry: 'Image floue — stabilisez le téléphone.',
  cap_ready: 'Bien cadré — vous pouvez prendre la photo.',
  cap_hold_still: 'Bien cadré — ne bougez plus, capture automatique…',
};

/**
 * Capture photo KYC via la caméra (getUserMedia). Caméra avant (selfie) ou arrière, cadrage
 * rond ou rectangulaire, émet le cliché en JPEG data URL. Repli sur un aperçu neutre si aucune
 * caméra n'est disponible (origine non sécurisée, refus, aucun périphérique).
 * Nécessite HTTPS en production ; fonctionne sur http://localhost.
 */
@Component({
  selector: 'diaspora-photo-capture',
  standalone: true,
  imports: [DspIcon],
  template: `
    @if (imageData) {
      <div style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;background:#fff;border:1px solid rgba(20,20,30,0.10);border-radius:12px;">
        <div [style.width.px]="boxW" [style.height.px]="boxH" [style.border-radius.px]="round ? boxW : 16"
             style="position:relative;overflow:hidden;box-shadow:0 8px 20px rgba(20,20,30,0.10);">
          @if (isImagePreview()) {
            <img [src]="imageData" alt="capture" style="width:100%;height:100%;object-fit:cover" />
          } @else {
            <div style="width:100%;height:100%;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;background:#151821;color:#fff;padding:8px;text-align:center;">
              <dsp-ic name="idcard" [size]="32" style="color:rgba(255,255,255,.6)"></dsp-ic>
              <span style="font-size:11px;word-break:break-all;line-height:1.3;">{{ pickedDocName() }}</span>
            </div>
          }
          <span style="position:absolute;right:8px;bottom:8px;width:28px;height:28px;border-radius:50%;background:#16A34A;color:#fff;display:flex;align-items:center;justify-content:center;">
            <dsp-ic name="check" [size]="16" [sw]="2.6"></dsp-ic>
          </span>
        </div>
        @if (qualityIssue()) {
          <p style="display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.4;max-width:280px;text-align:left;color:#C8102E;font-weight:600;background:rgba(200,16,46,0.06);border-radius:10px;padding:9px 11px;margin:0;">
            <dsp-ic name="alert" [size]="16" [sw]="2.4" style="flex:0 0 auto;margin-top:1px"></dsp-ic>
            <span>{{ qualityMsg() }}<br><span style="font-weight:500;color:#6B7280;">{{ T['q_keep_or_retake'] }}</span></span>
          </p>
        }
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <button type="button" (click)="retakePhoto()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;font-size:13px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
            <dsp-ic name="refresh" [size]="16"></dsp-ic> {{ T['selfie_retake'] }}
          </button>
          @if (allowGallery) {
            <button type="button" (click)="pickFromGallery()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;font-size:13px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
              <dsp-ic name="image" [size]="16"></dsp-ic> {{ T['cam_gallery'] }}
            </button>
          }
        </div>
      </div>
    } @else {
      <div style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;background:#fff;border:1px solid rgba(20,20,30,0.10);border-radius:12px;">
        <div [style.width.px]="boxW" [style.height.px]="boxH" [style.border-radius.px]="round ? boxW : 16"
             style="position:relative;overflow:hidden;background:#151821;display:flex;align-items:center;justify-content:center;">
          <video #video autoplay playsinline muted
                 [style.display]="streaming() ? 'block' : 'none'"
                 [style.transform]="facing === 'user' ? 'scaleX(-1)' : 'none'"
                 style="width:100%;height:100%;object-fit:cover"></video>
          @if (liveActive()) {
            <canvas #overlay
                    [style.transform]="facing === 'user' ? 'scaleX(-1)' : 'none'"
                    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
          }
          @if (!streaming()) {
            <dsp-ic [name]="round ? 'user' : 'idcard'" [size]="46" style="color:rgba(255,255,255,.35)"></dsp-ic>
          }
          @if (!liveActive() && !round && streaming()) {
            <span style="position:absolute;inset:10px;border:2px dashed rgba(255,255,255,.5);border-radius:10px;pointer-events:none"></span>
          }
          @if (shooting()) { <span style="position:absolute;inset:0;background:#fff;opacity:.85;"></span> }
        </div>
        @if (liveActive() && detectMsg()) {
          <p [style.color]="detectState() === 'ready' ? '#16A34A' : '#C8102E'"
             style="display:flex;gap:7px;align-items:center;font-size:12.5px;font-weight:700;text-align:center;line-height:1.4;max-width:280px;margin:0;">
            <dsp-ic [name]="detectState() === 'ready' ? 'check' : 'alert'" [size]="16" [sw]="2.5" style="flex:0 0 auto"></dsp-ic>
            <span>{{ detectMsg() }}</span>
          </p>
        }
        @if (liveActive() && manualOverrideAvailable() && detectState() !== 'ready') {
          <p style="font-size:11.5px;color:#6B7280;text-align:center;line-height:1.4;max-width:280px;margin:0;">
            La détection automatique ne trouve rien — vous pouvez prendre la photo manuellement.
          </p>
        }
        <p style="font-size:12px;color:#6B7280;text-align:center;line-height:1.45;max-width:260px;margin:0;">{{ guide || T['selfie_guide'] }}</p>
        @if (fileError()) {
          <p style="display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.4;max-width:280px;text-align:left;color:#C8102E;font-weight:600;background:rgba(200,16,46,0.06);border-radius:10px;padding:9px 11px;margin:0;">
            <dsp-ic name="alert" [size]="16" [sw]="2.4" style="flex:0 0 auto;margin-top:1px"></dsp-ic>
            <span>{{ fileError() }}</span>
          </p>
        }
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          @if (!streaming()) {
            <button type="button" (click)="start()" [disabled]="starting()" style="width:auto;padding:11px 18px;display:inline-flex;align-items:center;gap:8px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
              <dsp-ic name="camera" [size]="18"></dsp-ic> {{ starting() ? T['selfie_shooting'] : T['cam_open'] }}
            </button>
            @if (allowGallery) {
              <button type="button" (click)="pickFromGallery()" style="width:auto;padding:11px 14px;font-size:13px;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
                <dsp-ic name="image" [size]="16"></dsp-ic> {{ T['cam_gallery'] }}
              </button>
            }
          } @else {
            <button type="button" (click)="shoot()" [disabled]="shooting() || !canShoot()" style="width:auto;padding:11px 18px;display:inline-flex;align-items:center;gap:8px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
              <dsp-ic name="camera" [size]="18"></dsp-ic> {{ T['cam_take'] }}
            </button>
            @if (allowGallery) {
              <button type="button" (click)="pickFromGallery()" style="width:auto;padding:11px 14px;font-size:13px;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
                <dsp-ic name="image" [size]="16"></dsp-ic> {{ T['cam_gallery'] }}
              </button>
            }
            @if (allowFlip) {
              <button type="button" (click)="flip()" style="width:auto;padding:11px 14px;font-size:13px;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(20,20,30,0.12);background:#fff;color:#151821;cursor:pointer;border-radius:8px;">
                <dsp-ic name="refresh" [size]="16"></dsp-ic> {{ facing === 'user' ? T['cam_rear'] : T['cam_front'] }}
              </button>
            }
          }
        </div>
      </div>
    }
    <canvas #canvas style="display:none"></canvas>
    <input #file type="file" [attr.accept]="fileAccept()" (change)="onFileSelected($event)" style="display:none" />`,
})
export class DiasporaPhotoCapture implements AfterViewInit, OnDestroy {
  private faceMesh = inject(FaceMesh);
  readonly T = T;

  @Input() imageData: string | null = null;
  /** 'user' = avant/selfie, 'environment' = arrière. */
  @Input() facing: 'user' | 'environment' = 'user';
  @Input() allowFlip = false;
  @Input() round = false;
  @Input() guide = '';
  @Input() boxW = 200;
  @Input() boxH = 200;
  /** Quand true, les clichés capturés sont vérifiés (netteté, exposition, cadrage). */
  @Input() qualityCheck = false;
  /** Autoriser la galerie. false = force la caméra live (selfie / intégrité KYC). */
  @Input() allowGallery = true;
  @Input() detect: DetectMode = 'off';
  /** Déclenche automatiquement la capture une fois le sujet bien placé quelques images de suite. */
  @Input() autoCapture = true;
  @Output() captured = new EventEmitter<string>();
  @Output() retake = new EventEmitter<void>();

  @ViewChild('video') video?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('file') file?: ElementRef<HTMLInputElement>;
  @ViewChild('overlay') overlay?: ElementRef<HTMLCanvasElement>;

  streaming = signal(false);
  starting = signal(false);
  shooting = signal(false);
  qualityIssue = signal<DocIssue | null>(null);
  detectState = signal<DetectState>('idle');
  /** Nom du fichier importé quand ce n'est pas une image (ex. PDF) — pas d'aperçu recadré possible. */
  pickedDocName = signal<string | null>(null);
  fileError = signal<string | null>(null);
  /** Passé `MANUAL_OVERRIDE_DELAY_MS` après ouverture caméra sans détection concluante (mauvais
   *  éclairage, angle, appareil ancien…), débloque la capture manuelle pour ne pas bloquer
   *  l'utilisateur indéfiniment sur le selfie liveness. */
  manualOverrideAvailable = signal(false);
  private manualOverrideTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MANUAL_OVERRIDE_DELAY_MS = 8000;
  private stream: MediaStream | null = null;

  private rafId = 0;
  private lastDetectTs = 0;
  private readyStreak = 0;
  private lastFaceCenter: { x: number; y: number } | null = null;
  private static readonly READY_FRAMES = 6;
  private static readonly DETECT_INTERVAL_MS = 90;

  private static readonly FACE_FILL_MIN = 0.42;
  private static readonly FACE_FILL_MAX = 0.95;
  private static readonly FACE_CENTER_TOL = 0.18;
  private static readonly FACE_ROLL_MAX = 0.22;
  private static readonly FACE_YAW_MAX = 0.24;
  private static readonly FACE_MOVE_MAX = 0.03;
  private static readonly FACE_BLUR_MIN = 18;

  qualityMsg(): string {
    const issue = this.qualityIssue();
    return issue ? T['q_' + issue] : '';
  }

  liveActive(): boolean {
    return KYC_SMART_CAPTURE && this.detect !== 'off' && this.streaming();
  }

  canShoot(): boolean {
    if (!this.liveActive() || this.detect !== 'face') return true;
    const s = this.detectState();
    return s === 'ready' || s === 'idle' || this.manualOverrideAvailable();
  }

  detectMsg(): string {
    const s = this.detectState();
    if (s === 'idle') return '';
    if (s === 'ready') return T[this.autoCapture ? 'cap_hold_still' : 'cap_ready'];
    return T['cap_' + s];
  }

  ngAfterViewInit() { /* la caméra démarre sur action utilisateur */ }

  async start() {
    this.starting.set(true);
    await this.openCamera();
    this.starting.set(false);
  }

  private async openCamera() {
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing }, audio: false });
      this.streaming.set(true);
      setTimeout(() => { if (this.video) this.video.nativeElement.srcObject = this.stream; }, 0);
      this.startDetection();
      if (this.detect === 'face') {
        this.manualOverrideTimer = setTimeout(
          () => this.manualOverrideAvailable.set(true),
          DiasporaPhotoCapture.MANUAL_OVERRIDE_DELAY_MS,
        );
      }
    } catch {
      this.simulate();
    }
  }

  private async startDetection() {
    if (!this.liveActive()) return;
    this.readyStreak = 0;
    this.lastFaceCenter = null;
    this.detectState.set('searching');
    if (this.detect === 'face' && !(await this.faceMesh.ready())) {
      this.detectState.set('idle');
      return;
    }
    if (!this.streaming()) return;
    this.lastDetectTs = 0;
    const tick = (ts: number) => {
      if (!this.streaming()) return;
      this.rafId = requestAnimationFrame(tick);
      if (ts - this.lastDetectTs < DiasporaPhotoCapture.DETECT_INTERVAL_MS) return;
      this.lastDetectTs = ts;
      this.detectTick(ts);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private detectTick(ts: number) {
    const v = this.video?.nativeElement;
    if (!v || !v.videoWidth) return;
    const ready = this.detect === 'face' ? this.tickFace(v, ts) : this.tickDocument(v);
    if (!ready) { this.readyStreak = 0; return; }
    this.readyStreak++;
    if (this.autoCapture && this.readyStreak >= DiasporaPhotoCapture.READY_FRAMES) {
      this.stopDetection();
      this.shoot();
    }
  }

  private tickFace(v: HTMLVideoElement, ts: number): boolean {
    const C = DiasporaPhotoCapture;
    const { count, face } = this.faceMesh.detect(v, ts);
    this.drawFaceOverlay(v, face);
    if (count === 0 || !face || !face.frontal) { this.lastFaceCenter = null; this.detectState.set('none'); return false; }
    if (count > 1) { this.lastFaceCenter = null; this.detectState.set('multiple'); return false; }

    const cr = this.boxW / this.boxH, vr = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    const cx = ((face.cx * v.videoWidth) - sx) / sw;
    const cy = ((face.cy * v.videoHeight) - sy) / sh;
    const fill = (face.box.h * v.videoHeight) / sh;

    if (fill < C.FACE_FILL_MIN) { this.lastFaceCenter = null; this.detectState.set('too_small'); return false; }
    if (fill > C.FACE_FILL_MAX) { this.lastFaceCenter = null; this.detectState.set('too_close'); return false; }
    if (Math.abs(cx - 0.5) > C.FACE_CENTER_TOL || Math.abs(cy - 0.5) > C.FACE_CENTER_TOL) {
      this.lastFaceCenter = null; this.detectState.set('offcenter'); return false;
    }
    if (Math.abs(face.yaw) > C.FACE_YAW_MAX) { this.lastFaceCenter = null; this.detectState.set('look_straight'); return false; }
    if (Math.abs(face.roll) > C.FACE_ROLL_MAX) { this.lastFaceCenter = null; this.detectState.set('tilt'); return false; }

    const clarity = assessClarity(this.frameToCanvas(v, 320), C.FACE_BLUR_MIN);
    if (clarity === 'dark') { this.lastFaceCenter = null; this.detectState.set('dark'); return false; }
    if (clarity === 'blurry') { this.lastFaceCenter = null; this.detectState.set('blurry'); return false; }

    this.detectState.set('ready');
    const moved = this.lastFaceCenter
      ? Math.hypot(cx - this.lastFaceCenter.x, cy - this.lastFaceCenter.y)
      : Infinity;
    this.lastFaceCenter = { x: cx, y: cy };
    return moved <= C.FACE_MOVE_MAX;
  }

  private tickDocument(v: HTMLVideoElement): boolean {
    const probe = this.frameToCanvas(v, 320);
    const { issue, box } = assessDocument(probe);
    // `box` (calculé sur le même recadrage que l'aperçu) correspond déjà 1:1 au cadre affiché —
    // pas besoin de la conversion vidéo→boîte utilisée côté visage (frameToCanvas a déjà recadré).
    this.drawTrackedBoxOverlay(box, !issue);
    if (issue === 'too_far' || issue === 'no_card') { this.detectState.set('too_small'); return false; }
    if (issue) { this.detectState.set('searching'); return false; }
    this.detectState.set('ready');
    return true;
  }

  private drawFaceOverlay(v: HTMLVideoElement, face: FaceDetection | null) {
    if (!face) { this.drawTrackedBoxOverlay(undefined, false); return; }
    const cr = this.boxW / this.boxH, vr = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }

    // Boîte du visage détecté (coordonnées vidéo normalisées) reprojetée dans le repère du
    // cadre affiché (même recadrage que le flux vidéo visible) — le cadrage suit donc le visage.
    const box: TrackedBox = {
      x: ((face.box.x * v.videoWidth) - sx) / sw,
      y: ((face.box.y * v.videoHeight) - sy) / sh,
      w: (face.box.w * v.videoWidth) / sw,
      h: (face.box.h * v.videoHeight) / sh,
    };
    const ready = this.detectState() === 'ready';
    this.drawTrackedBoxOverlay(box, ready, (ctx, w, h) => {
      ctx.fillStyle = ready ? 'rgba(34,197,94,.9)' : 'rgba(255,255,255,.75)';
      for (const p of face.points) {
        ctx.fillRect((((p.x * v.videoWidth) - sx) / sw) * w - 0.6, (((p.y * v.videoHeight) - sy) / sh) * h - 0.6, 1.6, 1.6);
      }
    });
  }

  /** Dessine le cadrage live (rectangle arrondi, ou ellipse en mode rond) qui suit la boîte
   *  détectée — pièce d'identité ou visage — plus, optionnellement, un détail additionnel
   *  (le nuage de points du maillage facial) via `extra`. */
  private drawTrackedBoxOverlay(
    box: TrackedBox | undefined,
    ready: boolean,
    extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ) {
    const cv = this.overlay?.nativeElement;
    if (!cv) return;
    if (cv.width !== this.boxW || cv.height !== this.boxH) { cv.width = this.boxW; cv.height = this.boxH; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (box) {
      const bx = box.x * cv.width, by = box.y * cv.height, bw = box.w * cv.width, bh = box.h * cv.height;
      ctx.strokeStyle = ready ? '#16A34A' : 'rgba(255,255,255,.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (this.round) {
        ctx.ellipse(bx + bw / 2, by + bh / 2, Math.max(bw, 1) / 2, Math.max(bh, 1) / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.roundRect(bx, by, Math.max(bw, 1), Math.max(bh, 1), 14);
      }
      ctx.stroke();
    }
    extra?.(ctx, cv.width, cv.height);
  }

  private frameToCanvas(v: HTMLVideoElement, targetW: number): HTMLCanvasElement {
    const cr = this.boxW / this.boxH;
    const w = targetW, h = Math.max(1, Math.round(targetW / cr));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const vr = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    return c;
  }

  private stopDetection() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.readyStreak = 0;
    this.lastFaceCenter = null;
  }

  flip() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    if (this.streaming()) this.openCamera();
  }

  shoot() {
    const v = this.video?.nativeElement;
    const c = this.canvas?.nativeElement;
    if (!v || !c) return;
    this.stopDetection();
    this.shooting.set(true);
    const w = this.round ? 480 : 640, h = this.round ? 480 : 400;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const vr = v.videoWidth / v.videoHeight, cr = w / h;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    if (this.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    this.qualityIssue.set(this.qualityCheck ? (assessDocument(c).issue ?? null) : null);
    const data = c.toDataURL('image/jpeg', this.round ? 0.9 : 0.82);
    setTimeout(() => { this.shooting.set(false); this.stop(); this.imageData = data; this.captured.emit(data); }, 220);
  }

  pickFromGallery() {
    this.file?.nativeElement.click();
  }

  /** Les documents génériques (RIB, justificatifs…) sont souvent des PDF ; l'ID et le selfie restent image-only. */
  fileAccept(): string {
    return this.detect === 'off' ? 'image/*,application/pdf' : 'image/*';
  }

  isImagePreview(): boolean {
    return (this.imageData ?? '').startsWith('data:image');
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    this.fileError.set(null);

    // Fichier non-image (PDF…) : aucun recadrage possible, on transmet le fichier tel quel.
    if (!f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        input.value = '';
        this.stop();
        this.qualityIssue.set(null);
        this.pickedDocName.set(f.name);
        this.imageData = reader.result as string;
        this.captured.emit(this.imageData);
      };
      reader.onerror = () => { input.value = ''; this.fileError.set('Impossible de lire ce fichier — réessayez.'); };
      reader.readAsDataURL(f);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.stop();
        const data = this.drawCover(img);
        input.value = '';
        this.qualityIssue.set(null);
        this.pickedDocName.set(null);
        this.imageData = data;
        this.captured.emit(data);
      };
      img.onerror = () => { input.value = ''; this.fileError.set('Image illisible — choisissez un autre fichier.'); };
      img.src = reader.result as string;
    };
    reader.onerror = () => { input.value = ''; this.fileError.set('Impossible de lire ce fichier — réessayez.'); };
    reader.readAsDataURL(f);
  }

  private drawCover(img: HTMLImageElement): string {
    const c = this.canvas?.nativeElement ?? document.createElement('canvas');
    const w = this.round ? 480 : 640, h = this.round ? 480 : 400;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const ir = img.naturalWidth / img.naturalHeight, cr = w / h;
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (ir > cr) { sw = img.naturalHeight * cr; sx = (img.naturalWidth - sw) / 2; }
    else { sh = img.naturalWidth / cr; sy = (img.naturalHeight - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return c.toDataURL('image/jpeg', this.round ? 0.9 : 0.82);
  }

  /** Aperçu neutre pour que le KYC puisse continuer sans caméra disponible. */
  private simulate() {
    const c = this.canvas?.nativeElement ?? document.createElement('canvas');
    const w = this.round ? 480 : 640, h = this.round ? 480 : 400;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#F3E4D8'); g.addColorStop(1, '#D8B8A0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8f6a52';
    if (this.round) {
      ctx.beginPath(); ctx.arc(w / 2, h * 0.4, w * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w / 2, h, w * 0.3, h * 0.28, 0, Math.PI, 0, true); ctx.fill();
    } else {
      ctx.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.6);
    }
    this.imageData = c.toDataURL('image/jpeg', 0.8);
    this.captured.emit(this.imageData);
  }

  retakePhoto() {
    this.imageData = null;
    this.qualityIssue.set(null);
    this.detectState.set('idle');
    this.pickedDocName.set(null);
    this.fileError.set(null);
    this.retake.emit();
  }

  private stop() {
    this.stopDetection();
    this.detectState.set('idle');
    if (this.manualOverrideTimer) { clearTimeout(this.manualOverrideTimer); this.manualOverrideTimer = null; }
    this.manualOverrideAvailable.set(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.streaming.set(false);
  }
  ngOnDestroy() { this.stop(); }
}
