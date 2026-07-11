import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject, signal } from '@angular/core';
import { I18n } from '../core/i18n';
import { IconComponent } from './icon';
import { assessClarity, assessDocument, DocIssue } from './image-quality';
import { FaceMesh } from './face-mesh';
import { KYC_SMART_CAPTURE } from './constants';

/** Live detection mode on the camera preview. 'face' = selfie head check, 'document' = ID auto-frame. */
export type DetectMode = 'off' | 'face' | 'document';
/** State surfaced by the live detector, drives the on-screen hint + the ready ring. */
export type DetectState =
  | 'idle' | 'searching' | 'none' | 'multiple'
  | 'too_small' | 'too_close' | 'offcenter' | 'look_straight' | 'tilt'
  | 'dark' | 'blurry' | 'ready';

/**
 * KYC photo capture via the device camera (getUserMedia). Supports the front
 * (selfie) and rear (environment) cameras with a flip toggle, round or rectangular
 * framing, and emits the captured frame as a JPEG data URL. Falls back to a neutral
 * placeholder when no camera is available (insecure origin, denied, no device).
 * Requires HTTPS in production; works on http://localhost.
 */
@Component({
  selector: 'photo-capture',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (imageData) {
      <div class="card" style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px">
        <div [style.width.px]="boxW" [style.height.px]="boxH" [style.border-radius.px]="round ? boxW : 16"
             style="position:relative;overflow:hidden;box-shadow:var(--shadow)">
          <img [src]="imageData" alt="capture" style="width:100%;height:100%;object-fit:cover" />
          <span style="position:absolute;right:8px;bottom:8px;width:28px;height:28px;border-radius:50%;background:var(--success);color:#fff;display:flex;align-items:center;justify-content:center">
            <ic name="check" [size]="16" [sw]="2.6"></ic>
          </span>
        </div>
        <!-- Non-blocking quality warning: the shot is kept, the user decides to retake or continue. -->
        @if (qualityIssue()) {
          <p style="display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.4;max-width:280px;text-align:left;color:var(--accent);font-weight:600;background:var(--accent-soft);border-radius:10px;padding:9px 11px">
            <ic name="alert" [size]="16" [sw]="2.4" style="flex:0 0 auto;margin-top:1px"></ic>
            <span>{{ i18n.t('q_' + qualityIssue()) }}<br><span style="font-weight:500;color:var(--muted)">{{ i18n.t('q_keep_or_retake') }}</span></span>
          </p>
        }
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn-ghost" (click)="retakePhoto()" style="padding:10px 14px;font-size:13px;width:auto">
            <ic name="refresh" [size]="16"></ic> {{ i18n.t('selfie_retake') }}
          </button>
          @if (allowGallery) {
            <button class="btn btn-outline" (click)="pickFromGallery()" style="padding:10px 14px;font-size:13px;width:auto">
              <ic name="image" [size]="16"></ic> {{ i18n.t('cam_gallery') }}
            </button>
          }
        </div>
      </div>
    } @else {
      <div class="card" style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px">
        <div [style.width.px]="boxW" [style.height.px]="boxH" [style.border-radius.px]="round ? boxW : 16"
             style="position:relative;overflow:hidden;background:#0e1f1b;display:flex;align-items:center;justify-content:center">
          <video #video autoplay playsinline muted
                 [style.display]="streaming() ? 'block' : 'none'"
                 [style.transform]="facing === 'user' ? 'scaleX(-1)' : 'none'"
                 style="width:100%;height:100%;object-fit:cover"></video>
          <!-- Live detection overlay (face landmarks). Mirrored together with the video so points align. -->
          @if (liveActive()) {
            <canvas #overlay
                    [style.transform]="facing === 'user' ? 'scaleX(-1)' : 'none'"
                    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
          }
          @if (!streaming()) {
            <ic [name]="round ? 'user' : 'idcard'" [size]="46" style="color:rgba(255,255,255,.35)"></ic>
          }
          <!-- Framing ring: dashed white while searching, solid green once the subject is well placed. -->
          @if (liveActive()) {
            <span [style.border-radius.px]="round ? boxW : 12"
                  [style.border-color]="detectState() === 'ready' ? 'var(--success)' : 'rgba(255,255,255,.55)'"
                  [style.border-style]="detectState() === 'ready' ? 'solid' : 'dashed'"
                  style="position:absolute;inset:10px;border-width:3px;pointer-events:none;transition:border-color .2s"></span>
          } @else if (!round && streaming()) {
            <span style="position:absolute;inset:10px;border:2px dashed rgba(255,255,255,.5);border-radius:10px;pointer-events:none"></span>
          }
          @if (shooting()) { <span style="position:absolute;inset:0;background:#fff;animation:pulse .9s ease"></span> }
        </div>
        <!-- Live hint: what the detector wants the user to fix (or "hold still / auto-capturing"). -->
        @if (liveActive() && detectMsg()) {
          <p [style.color]="detectState() === 'ready' ? 'var(--success)' : 'var(--accent)'"
             style="display:flex;gap:7px;align-items:center;font-size:12.5px;font-weight:700;text-align:center;line-height:1.4;max-width:280px;margin:0">
            <ic [name]="detectState() === 'ready' ? 'check' : 'alert'" [size]="16" [sw]="2.5" style="flex:0 0 auto"></ic>
            <span>{{ detectMsg() }}</span>
          </p>
        }
        <p class="muted" style="font-size:12px;text-align:center;line-height:1.45;max-width:260px">{{ guide || i18n.t('selfie_guide') }}</p>
        <!-- Progressive guidance: a short checklist of what makes a good shot. -->
        @if (tips.length) {
          <div style="width:100%;max-width:300px;display:flex;flex-direction:column;gap:6px;background:var(--surface-2);border-radius:12px;padding:11px 13px">
            @if (tipsTitle) { <div style="font-size:11.5px;font-weight:800;color:var(--text)">{{ i18n.t(tipsTitle) }}</div> }
            @for (tip of tips; track tip) {
              <div style="display:flex;gap:7px;align-items:flex-start;font-size:11.5px;line-height:1.4;color:var(--muted)">
                <ic name="check" [size]="14" [sw]="2.6" style="color:var(--success);flex:0 0 auto;margin-top:1px"></ic>
                <span>{{ i18n.t(tip) }}</span>
              </div>
            }
          </div>
        }
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          @if (!streaming()) {
            <button class="btn btn-primary" (click)="start()" [disabled]="starting()" style="width:auto;padding:11px 18px">
              <ic name="camera" [size]="18"></ic> {{ starting() ? i18n.t('selfie_shooting') : i18n.t('cam_open') }}
            </button>
            @if (allowGallery) {
              <button class="btn btn-outline" (click)="pickFromGallery()" style="width:auto;padding:11px 14px;font-size:13px">
                <ic name="image" [size]="16"></ic> {{ i18n.t('cam_gallery') }}
              </button>
            }
          } @else {
            <button class="btn btn-primary" (click)="shoot()" [disabled]="shooting() || !canShoot()" style="width:auto;padding:11px 18px">
              <ic name="camera" [size]="18"></ic> {{ i18n.t('cam_take') }}
            </button>
            @if (allowGallery) {
              <button class="btn btn-outline" (click)="pickFromGallery()" style="width:auto;padding:11px 14px;font-size:13px">
                <ic name="image" [size]="16"></ic> {{ i18n.t('cam_gallery') }}
              </button>
            }
            @if (allowFlip) {
              <button class="btn btn-outline" (click)="flip()" style="width:auto;padding:11px 14px;font-size:13px">
                <ic name="refresh" [size]="16"></ic> {{ facing === 'user' ? i18n.t('cam_rear') : i18n.t('cam_front') }}
              </button>
            }
          }
        </div>
      </div>
    }
    <canvas #canvas style="display:none"></canvas>
    <input #file type="file" accept="image/*" (change)="onFileSelected($event)" style="display:none" />`,
})
export class PhotoCaptureComponent implements AfterViewInit, OnDestroy {
  i18n = inject(I18n);
  private faceMesh = inject(FaceMesh);

  @Input() imageData: string | null = null;
  /** 'user' = front/selfie, 'environment' = rear. */
  @Input() facing: 'user' | 'environment' = 'user';
  @Input() allowFlip = false;
  @Input() round = false;
  @Input() guide = '';
  /** Optional progressive guidance: i18n keys rendered as a checklist of tips. */
  @Input() tips: string[] = [];
  @Input() tipsTitle = '';
  @Input() boxW = 200;
  @Input() boxH = 200;
  /** When true, captured frames are checked for document quality (sharp, exposed, fully framed). */
  @Input() qualityCheck = false;
  /** Allow picking from the gallery. Set false to FORCE the live camera (selfie / KYC integrity). */
  @Input() allowGallery = true;
  /** Live detection on the preview: 'face' (selfie head check), 'document' (ID auto-frame), or off. */
  @Input() detect: DetectMode = 'off';
  /** Auto-fire the shutter once the subject is well placed for a few frames (manual button stays usable). */
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
  /** Last blocking quality issue (null = none); drives the on-screen guidance message. */
  qualityIssue = signal<DocIssue | null>(null);
  /** Current live-detector state (face/document), drives the ring colour + hint. */
  detectState = signal<DetectState>('idle');
  private stream: MediaStream | null = null;

  // --- live detection loop state ---
  private rafId = 0;
  private lastDetectTs = 0;
  /** Consecutive "ready" frames; auto-capture fires once this crosses the threshold. */
  private readyStreak = 0;
  /** Centre of the face on the previous ready frame (box space), to measure stillness. */
  private lastFaceCenter: { x: number; y: number } | null = null;
  /** Frames needed in a row before auto-firing (anti-jitter: ~0.7s at the throttled rate). */
  private static readonly READY_FRAMES = 6;
  /** Detector cadence — ~10 fps is plenty for framing and keeps the model cheap on mobile. */
  private static readonly DETECT_INTERVAL_MS = 90;

  // --- face (selfie) tunables: judged in the VISIBLE circle's coordinate space ---
  private static readonly FACE_FILL_MIN = 0.42;   // head height vs box: smaller → too far
  private static readonly FACE_FILL_MAX = 0.95;   // larger → too close (head clipped)
  private static readonly FACE_CENTER_TOL = 0.18; // |centre−0.5| allowed on each axis
  private static readonly FACE_ROLL_MAX = 0.22;   // ~12.5° head tilt
  private static readonly FACE_YAW_MAX = 0.24;    // nose-vs-eyes offset → head turned
  private static readonly FACE_MOVE_MAX = 0.03;   // max centre drift between frames → "still"
  private static readonly FACE_BLUR_MIN = 18;     // Laplacian variance floor for a face (< → blurry)

  /** True when the live detector should run for this capture (mode set, flag on, camera live). */
  liveActive(): boolean {
    return KYC_SMART_CAPTURE && this.detect !== 'off' && this.streaming();
  }

  /** Manual shutter availability: blocked in face mode until a valid head is in frame (anti-spoof).
   *  'idle' means the detector isn't running (model failed to load) → fall back to manual capture. */
  canShoot(): boolean {
    if (!this.liveActive() || this.detect !== 'face') return true;
    const s = this.detectState();
    return s === 'ready' || s === 'idle';
  }

  /** Localised hint for the current detector state (empty while idle/searching with nothing to say). */
  detectMsg(): string {
    const s = this.detectState();
    if (s === 'idle') return '';
    if (s === 'ready') return this.i18n.t(this.autoCapture ? 'cap_hold_still' : 'cap_ready');
    return this.i18n.t('cap_' + s);
  }

  ngAfterViewInit() { /* camera starts on user action */ }

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
    } catch {
      this.simulate(); // no camera / denied / insecure origin
    }
  }

  /** Spin up the live detector loop (face landmarks / document framing) once the camera is live. */
  private async startDetection() {
    if (!this.liveActive()) return;
    this.readyStreak = 0;
    this.lastFaceCenter = null;
    this.detectState.set('searching');
    // The face model loads lazily; if it fails we silently drop face detection (manual capture stays).
    if (this.detect === 'face' && !(await this.faceMesh.ready())) {
      this.detectState.set('idle');   // model unavailable → no gating, no overlay hints
      return;
    }
    if (!this.streaming()) return;     // camera was closed while the model loaded
    this.lastDetectTs = 0;
    const tick = (ts: number) => {
      if (!this.streaming()) return;
      this.rafId = requestAnimationFrame(tick);
      if (ts - this.lastDetectTs < PhotoCaptureComponent.DETECT_INTERVAL_MS) return;
      this.lastDetectTs = ts;
      this.detectTick(ts);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** One detection step: assess the frame, update the ready state, and auto-fire when stable. */
  private detectTick(ts: number) {
    const v = this.video?.nativeElement;
    if (!v || !v.videoWidth) return;
    const ready = this.detect === 'face' ? this.tickFace(v, ts) : this.tickDocument(v);
    if (!ready) { this.readyStreak = 0; return; }
    this.readyStreak++;
    if (this.autoCapture && this.readyStreak >= PhotoCaptureComponent.READY_FRAMES) {
      this.stopDetection();
      this.shoot();
    }
  }

  /**
   * Face mode: run FaceLandmarker, draw the points, and decide whether a single, well-placed,
   * frontal, upright, sharp and STILL head is in frame. Geometry is judged in the visible circle's
   * coordinate space (cover-crop applied) so it matches what the user sees. Returns true only when
   * the selfie is genuinely good to take — i.e. the kept image will be net & exploitable.
   */
  private tickFace(v: HTMLVideoElement, ts: number): boolean {
    const C = PhotoCaptureComponent;
    const { count, face } = this.faceMesh.detect(v, ts);
    this.drawFaceOverlay(v, face);
    if (count === 0 || !face || !face.frontal) { this.lastFaceCenter = null; this.detectState.set('none'); return false; }
    if (count > 1) { this.lastFaceCenter = null; this.detectState.set('multiple'); return false; }

    // Map the face from full-video coords into the visible (cover-cropped) box.
    const cr = this.boxW / this.boxH, vr = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    const cx = ((face.cx * v.videoWidth) - sx) / sw;       // face centre in box space (0..1)
    const cy = ((face.cy * v.videoHeight) - sy) / sh;
    const fill = (face.box.h * v.videoHeight) / sh;        // head height vs visible box height

    if (fill < C.FACE_FILL_MIN) { this.lastFaceCenter = null; this.detectState.set('too_small'); return false; }
    if (fill > C.FACE_FILL_MAX) { this.lastFaceCenter = null; this.detectState.set('too_close'); return false; }
    if (Math.abs(cx - 0.5) > C.FACE_CENTER_TOL || Math.abs(cy - 0.5) > C.FACE_CENTER_TOL) {
      this.lastFaceCenter = null; this.detectState.set('offcenter'); return false;
    }
    if (Math.abs(face.yaw) > C.FACE_YAW_MAX) { this.lastFaceCenter = null; this.detectState.set('look_straight'); return false; }
    if (Math.abs(face.roll) > C.FACE_ROLL_MAX) { this.lastFaceCenter = null; this.detectState.set('tilt'); return false; }

    // Clarity — only once the face is well placed. Reject dark/blurry so the captured shot is usable.
    const clarity = assessClarity(this.frameToCanvas(v, 320), C.FACE_BLUR_MIN);
    if (clarity === 'dark') { this.lastFaceCenter = null; this.detectState.set('dark'); return false; }
    if (clarity === 'blurry') { this.lastFaceCenter = null; this.detectState.set('blurry'); return false; }
    // 'glare' on skin is usually harmless — don't block the selfie on it.

    // Stillness: the head must hold position between frames, otherwise the auto shot is motion-blurred.
    this.detectState.set('ready');
    const moved = this.lastFaceCenter
      ? Math.hypot(cx - this.lastFaceCenter.x, cy - this.lastFaceCenter.y)
      : Infinity;
    this.lastFaceCenter = { x: cx, y: cy };
    return moved <= C.FACE_MOVE_MAX;   // "ready", but capture only fires once steady
  }

  /** Document mode: reuse the post-capture quality gate live; ready when the card is well framed. */
  private tickDocument(v: HTMLVideoElement): boolean {
    const probe = this.frameToCanvas(v, 320);
    const issue = assessDocument(probe).issue;
    if (issue === 'too_far' || issue === 'no_card') { this.detectState.set('too_small'); return false; }
    if (issue) { this.detectState.set('searching'); return false; }
    this.detectState.set('ready');
    return true;
  }

  /** Draw the face landmarks onto the overlay canvas, mapping video coords through the cover-crop. */
  private drawFaceOverlay(v: HTMLVideoElement, face: { points: { x: number; y: number }[] } | null) {
    const cv = this.overlay?.nativeElement;
    if (!cv) return;
    if (cv.width !== this.boxW || cv.height !== this.boxH) { cv.width = this.boxW; cv.height = this.boxH; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!face) return;
    // Same cover-crop maths as shoot(): map a normalised video point into the displayed box.
    const cr = cv.width / cv.height, vr = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    ctx.fillStyle = this.detectState() === 'ready' ? 'rgba(34,197,94,.9)' : 'rgba(255,255,255,.75)';
    for (const p of face.points) {
      const bx = ((p.x * v.videoWidth) - sx) / sw * cv.width;
      const by = ((p.y * v.videoHeight) - sy) / sh * cv.height;
      ctx.fillRect(bx - 0.6, by - 0.6, 1.6, 1.6);
    }
  }

  /** Cover-fit the current video frame into a small square-ish canvas for live document analysis. */
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

  /** Stop the detection loop (camera closed, shot taken). */
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
    this.stopDetection();   // freeze the live loop the instant we commit to a frame (manual or auto)
    this.shooting.set(true);
    const w = this.round ? 480 : 640, h = this.round ? 480 : 400;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    // cover-fit the video frame into the canvas
    const vr = v.videoWidth / v.videoHeight, cr = w / h;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = v.videoHeight * cr; sx = (v.videoWidth - sw) / 2; }
    else { sh = v.videoWidth / cr; sy = (v.videoHeight - sh) / 2; }
    if (this.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    // Quality check is now advisory (flexible): flag blurry / dark / glare / mis-framed shots as a
    // warning shown on the preview, but keep the photo — the user retakes or continues as they wish.
    this.qualityIssue.set(this.qualityCheck ? (assessDocument(c).issue ?? null) : null);
    const data = c.toDataURL('image/jpeg', this.round ? 0.9 : 0.82);
    setTimeout(() => { this.shooting.set(false); this.stop(); this.imageData = data; this.captured.emit(data); }, 220);
  }

  /** Open the device gallery / file picker (no `capture` attr → lets the user pick an existing image). */
  pickFromGallery() {
    this.file?.nativeElement.click();
  }

  /** Load a picked image file, normalise it (cover-fit, JPEG) like a camera shot, and emit it. */
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.stop(); // release the camera if it was open
        const data = this.drawCover(img);
        input.value = ''; // allow re-picking the same file later
        // No quality gate on gallery picks — the sharpness/framing check applies only to photos
        // captured live by the in-app camera (the user can't reframe a file they already have).
        this.qualityIssue.set(null);
        this.imageData = data;
        this.captured.emit(data);
      };
      img.onerror = () => { input.value = ''; };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(f);
  }

  /** Cover-fit an image source into the capture canvas at the same dimensions as shoot(). */
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

  /** Neutral placeholder so KYC can proceed when no camera is available. */
  private simulate() {
    const c = this.canvas?.nativeElement ?? document.createElement('canvas');
    const w = this.round ? 480 : 640, h = this.round ? 480 : 400;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#cfe6da'); g.addColorStop(1, '#9cc3b3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5b7d6f';
    if (this.round) {
      ctx.beginPath(); ctx.arc(w / 2, h * 0.4, w * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w / 2, h, w * 0.3, h * 0.28, 0, Math.PI, 0, true); ctx.fill();
    } else {
      ctx.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.6);
    }
    this.imageData = c.toDataURL('image/jpeg', 0.8);
    this.captured.emit(this.imageData);
  }

  retakePhoto() { this.imageData = null; this.qualityIssue.set(null); this.detectState.set('idle'); this.retake.emit(); }

  private stop() {
    this.stopDetection();
    this.detectState.set('idle');
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.streaming.set(false);
  }
  ngOnDestroy() { this.stop(); }
}
