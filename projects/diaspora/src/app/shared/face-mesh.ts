import { Injectable } from '@angular/core';

/** One detected face, in normalised video coordinates (0..1, NOT mirrored). */
export interface FaceDetection {
  /** All face landmarks (≈478 points) as normalised {x,y}. */
  points: { x: number; y: number }[];
  /** Bounding box of the face, normalised. */
  box: { x: number; y: number; w: number; h: number };
  /** Centre of the box, normalised. */
  cx: number;
  cy: number;
  /** Face height as a fraction of the frame height (how big the head is). */
  fill: number;
  /** Head tilt: angle (radians) of the eye line from horizontal. ~0 = upright. */
  roll: number;
  /** Head turn: nose offset from the eye midpoint, normalised by eye spacing. ~0 = facing front. */
  yaw: number;
  /** True only when the key facial landmarks (both eyes + nose) were located — a real frontal face. */
  frontal: boolean;
}

// Canonical MediaPipe Face Mesh indices: outer eye corners and the nose tip.
const EYE_L = 33;
const EYE_R = 263;
const NOSE = 1;

/**
 * Thin wrapper around MediaPipe FaceLandmarker (Tasks Vision), used to (a) prove a real human
 * head is in frame before a selfie is accepted and (b) drive auto-capture once the face is well
 * placed. The model + WASM runtime are self-hosted under `/mediapipe` (no external CDN).
 *
 * Everything is best-effort: if the model/WASM/WebGL can't load (old device, offline first run),
 * {@link ready} resolves to false and the caller falls back to plain manual capture.
 */
@Injectable({ providedIn: 'root' })
export class FaceMesh {
  private landmarker: any | null = null;
  private initPromise: Promise<boolean> | null = null;

  /** Lazily load the model once. Resolves true when detection is usable, false on any failure. */
  ready(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<boolean> {
    let vision: any;
    let fileset: any;
    try {
      // Dynamic import: the ~heavy MediaPipe bundle is only fetched when smart capture is actually used.
      vision = await import('@mediapipe/tasks-vision');
      fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    } catch (e) {
      console.warn('[face-mesh] disabled — could not load MediaPipe runtime/WASM', e);
      this.landmarker = null;
      return false;
    }

    // Le delegate GPU (WebGL) échoue sur pas mal de navigateurs mobiles / configs sans WebGL2 :
    // dans ce cas la détection ne s'initialisait pas du tout (selfie sans cadre ni capture auto).
    // On tente donc le GPU puis on retombe sur le CPU, qui marche partout (un peu plus lent).
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
        console.info(`[face-mesh] FaceLandmarker prêt (delegate ${delegate})`);
        return true;
      } catch (e) {
        console.warn(`[face-mesh] échec init delegate ${delegate}`, e);
      }
    }
    this.landmarker = null;
    return false;
  }

  /**
   * Detect faces in the current video frame. `tsMs` must be a monotonically increasing timestamp
   * (e.g. performance.now()); MediaPipe rejects a repeated timestamp, so call this at most once per
   * frame. Returns the number of faces and the primary (first) one with its geometry, or null.
   */
  detect(video: HTMLVideoElement, tsMs: number): { count: number; face: FaceDetection | null } {
    if (!this.landmarker || !video.videoWidth) return { count: 0, face: null };
    let res: any;
    try {
      res = this.landmarker.detectForVideo(video, tsMs);
    } catch {
      return { count: 0, face: null };
    }
    const faces = res?.faceLandmarks;
    if (!faces || faces.length === 0) return { count: 0, face: null };

    const lm = faces[0] as { x: number; y: number }[];
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    const points = new Array(lm.length);
    for (let i = 0; i < lm.length; i++) {
      const x = lm[i].x, y = lm[i].y;
      points[i] = { x, y };
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const w = Math.max(0, maxX - minX), h = Math.max(0, maxY - minY);

    // Head pose from a few stable landmarks: roll = tilt of the eye line, yaw = how far the nose
    // sits from the midpoint between the eyes (turned heads push the nose to one side).
    const le = lm[EYE_L], re = lm[EYE_R], nose = lm[NOSE];
    const frontal = !!(le && re && nose);
    let roll = 0, yaw = 0;
    if (frontal) {
      const dx = re.x - le.x, dy = re.y - le.y;
      roll = Math.atan2(dy, dx);
      const eyeMidX = (le.x + re.x) / 2;
      const interocular = Math.hypot(dx, dy) || 1e-6;
      yaw = (nose.x - eyeMidX) / interocular;
    }

    return {
      count: faces.length,
      face: { points, box: { x: minX, y: minY, w, h }, cx: minX + w / 2, cy: minY + h / 2, fill: h, roll, yaw, frontal },
    };
  }
}
