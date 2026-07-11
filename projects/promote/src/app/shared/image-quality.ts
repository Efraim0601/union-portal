/**
 * Lightweight, dependency-free quality gate for ID-document captures (CNI recto/verso).
 *
 * Runs on the captured canvas frame (before upload) and decides whether the image is
 * good enough to be exploitable: sharp, well-exposed, and the whole card framed inside
 * the picture. Pure Canvas 2D maths — no OpenCV/ML, a few milliseconds on a downscaled copy.
 *
 * The single most relevant issue is returned so the UI can show one actionable message.
 * Thresholds are deliberately grouped as named constants — tune them here if the gate
 * proves too strict or too lax on real-world devices.
 */

export type DocIssue =
  | 'no_card'   // nothing card-like detected (blank, plain wall, very busy background)
  | 'dark'      // under-exposed
  | 'glare'     // over-exposed / strong reflection (laminated card under flash)
  | 'blurry'    // out of focus / motion blur
  | 'too_far'   // card present but too small in frame → text unreadable
  | 'cut_off';  // card edges run out of the frame → not all contours captured

export interface DocQuality {
  ok: boolean;
  issue: DocIssue | null;
}

// --- tunables --------------------------------------------------------------
const ANALYSIS_WIDTH = 320;        // downscale target; keeps the maths fast and noise-robust
const MIN_BRIGHTNESS = 55;         // mean luminance below this → too dark
const GLARE_FRACTION = 0.10;       // >10% near-white pixels → reflection / over-exposure
const NEAR_WHITE = 248;            // luminance considered "blown out"
const BLUR_VARIANCE = 70;          // Laplacian variance below this → blurry (lower = blurrier)
const EDGE_STD_K = 1.4;            // edge threshold = mean + k·std of the gradient magnitude
const SIGNIFICANT_FRAC = 0.10;     // a row/col is a "card border" when this fraction of it is edge
const MIN_FILL = 0.40;             // card bounding box must cover ≥40% of the frame, else too far
const BORDER_BAND = 0.03;          // outer 3% band: a card edge here means it is cut off

/** Assess a captured document frame. Returns the first blocking issue, or ok. */
export function assessDocument(canvas: HTMLCanvasElement): DocQuality {
  const gray = toGrayscale(canvas);
  if (!gray) return { ok: true, issue: null }; // can't read pixels → don't block the user

  const { data, w, h } = gray;

  // 1. Exposure -----------------------------------------------------------
  let sum = 0, nearWhite = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (data[i] >= NEAR_WHITE) nearWhite++;
  }
  const mean = sum / data.length;
  if (mean < MIN_BRIGHTNESS) return { ok: false, issue: 'dark' };
  if (nearWhite / data.length > GLARE_FRACTION) return { ok: false, issue: 'glare' };

  // 2. Sharpness (variance of the Laplacian response) ---------------------
  if (laplacianVariance(data, w, h) < BLUR_VARIANCE) return { ok: false, issue: 'blurry' };

  // 3. Framing — find the card via its edges, check it is whole & large enough
  return assessFraming(data, w, h);
}

/**
 * Exposure + sharpness only (no card/framing logic) — used to gate the live selfie so the shot
 * kept is actually exploitable (not dark, not blown out, not blurry). Faces carry less high-frequency
 * detail than a text-heavy ID card, so callers pass a lower `blurMin` than the document gate.
 * Returns the first issue, or null when the frame is clear enough.
 */
export function assessClarity(canvas: HTMLCanvasElement, blurMin = BLUR_VARIANCE): 'dark' | 'glare' | 'blurry' | null {
  const gray = toGrayscale(canvas);
  if (!gray) return null; // can't read pixels → don't block
  const { data, w, h } = gray;
  let sum = 0, nearWhite = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (data[i] >= NEAR_WHITE) nearWhite++;
  }
  const mean = sum / data.length;
  if (mean < MIN_BRIGHTNESS) return 'dark';
  if (nearWhite / data.length > GLARE_FRACTION) return 'glare';
  if (laplacianVariance(data, w, h) < blurMin) return 'blurry';
  return null;
}

/** Downscale to a small grayscale buffer for fast, noise-tolerant analysis. */
function toGrayscale(src: HTMLCanvasElement): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = Math.min(ANALYSIS_WIDTH, src.width);
  const h = Math.round((src.height / src.width) * w) || 1;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  let rgba: ImageData;
  try { rgba = ctx.getImageData(0, 0, w, h); } catch { return null; }
  const gray = new Uint8ClampedArray(w * h);
  for (let p = 0, q = 0; p < rgba.data.length; p += 4, q++) {
    // Rec. 601 luma
    gray[q] = (rgba.data[p] * 0.299 + rgba.data[p + 1] * 0.587 + rgba.data[p + 2] * 0.114) | 0;
  }
  return { data: gray, w, h };
}

/** Variance of a 3×3 Laplacian — a classic, cheap focus measure (higher = sharper). */
function laplacianVariance(g: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n === 0) return 0;
  const meanLap = sum / n;
  return sumSq / n - meanLap * meanLap;
}

/**
 * Detect the document by its edges (Sobel) and verify it is fully framed:
 *  - enough strong edges exist (else no_card),
 *  - its bounding box fills enough of the frame (else too_far),
 *  - no card border sits in the outer band (else cut_off → contours run off-frame).
 */
function assessFraming(g: Uint8ClampedArray, w: number, h: number): DocQuality {
  const mag = new Float32Array(w * h);
  let sum = 0, sumSq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m; sum += m; sumSq += m * m;
    }
  }
  const n = w * h;
  const meanMag = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - meanMag * meanMag));
  const thresh = meanMag + EDGE_STD_K * std;

  // Edge density per row / per column.
  const colEdges = new Int32Array(w);
  const rowEdges = new Int32Array(h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mag[y * w + x] > thresh) { colEdges[x]++; rowEdges[y]++; total++; }
    }
  }
  if (total < 0.01 * n) return { ok: false, issue: 'no_card' };

  // A row/col belongs to the card when a good fraction of it is edges (i.e. a long border).
  const colMin = SIGNIFICANT_FRAC * h, rowMin = SIGNIFICANT_FRAC * w;
  let minX = -1, maxX = -1, minY = -1, maxY = -1;
  for (let x = 0; x < w; x++) if (colEdges[x] > colMin) { if (minX < 0) minX = x; maxX = x; }
  for (let y = 0; y < h; y++) if (rowEdges[y] > rowMin) { if (minY < 0) minY = y; maxY = y; }
  if (minX < 0 || minY < 0) return { ok: false, issue: 'no_card' };

  const fill = ((maxX - minX) * (maxY - minY)) / n;
  if (fill < MIN_FILL) return { ok: false, issue: 'too_far' };

  const bandX = Math.max(2, Math.round(BORDER_BAND * w));
  const bandY = Math.max(2, Math.round(BORDER_BAND * h));
  if (minX < bandX || maxX > w - 1 - bandX || minY < bandY || maxY > h - 1 - bandY) {
    return { ok: false, issue: 'cut_off' };
  }
  return { ok: true, issue: null };
}
