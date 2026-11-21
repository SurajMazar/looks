import { TUNING } from './tuning.js';
import type { CurvePoints, Settings } from './types.js';

export const LUT_N = 4096;

/** Samples a LUT built on [0, 1] with linear interpolation. */
export function lookup(lut: Float32Array, v: number): number {
  if (v <= 0) return lut[0];
  if (v >= 1) return lut[LUT_N];
  const x = v * LUT_N;
  const i = x | 0;
  const a = lut[i];
  return a + (lut[i + 1] - a) * (x - i);
}

/** Monotone cubic (Fritsch–Carlson) curve through 0..255 points, as a LUT on [0, 1]. */
export function curveLut(points: CurvePoints | undefined): Float32Array | null {
  if (!points || points.length < 2) return null;
  const pts = points
    .map(([x, y]) => [Math.min(255, Math.max(0, x)) / 255, Math.min(255, Math.max(0, y)) / 255] as const)
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0]);
  const isIdentity = pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
  if (pts.length < 2 || isIdentity) return null;

  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  const lut = new Float32Array(LUT_N + 1);
  let seg = 0;
  for (let i = 0; i <= LUT_N; i++) {
    const x = i / LUT_N;
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const h = xs[seg + 1] - xs[seg];
      const t = (x - xs[seg]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y =
        (2 * t3 - 3 * t2 + 1) * ys[seg] +
        (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * ys[seg + 1] +
        (t3 - t2) * h * m[seg + 1];
    }
    lut[i] = Math.min(1, Math.max(0, y));
  }
  return lut;
}

const PIVOT = 0.45;
// Peak-normalised bumps for the shadows (peak at 0.25) and highlights (peak at 0.75) sliders.
const BUMP_NORM = 1 / (0.25 * 0.75 * 0.75 * 0.75);

/**
 * The Light panel (contrast, highlights, shadows, whites, blacks) as a single
 * tone curve on sRGB-encoded values. Applied hue-preservingly by the engine.
 */
export function toneLut(s: Settings): Float32Array | null {
  const c = (s.contrast ?? 0) / 100;
  const hl = (s.highlights ?? 0) / 100;
  const sh = (s.shadows ?? 0) / 100;
  const wh = (s.whites ?? 0) / 100;
  const bl = (s.blacks ?? 0) / 100;
  if (!c && !hl && !sh && !wh && !bl) return null;

  const lut = new Float32Array(LUT_N + 1);
  // Saturating so ±100 stays usable while small values match Lightroom.
  const k = 1 + (TUNING.contrastK * c) / (1 + 0.6 * Math.abs(c));
  for (let i = 0; i <= LUT_N; i++) {
    let x = i / LUT_N;
    if (c > 0) {
      x = x < PIVOT ? PIVOT * Math.pow(x / PIVOT, k) : 1 - (1 - PIVOT) * Math.pow((1 - x) / (1 - PIVOT), k);
    } else if (c < 0) {
      x = x + -c * 0.7 * (PIVOT - x);
    }
    const inv = 1 - x;
    x += sh * TUNING.shadowsK * x * inv * inv * inv * BUMP_NORM;
    x += hl * TUNING.highlightsK * x * x * x * inv * BUMP_NORM;
    const x2 = x * x;
    x += wh * TUNING.whitesK * x2 * x2;
    const i2 = (1 - x) * (1 - x);
    x += bl * TUNING.blacksK * i2 * i2;
    lut[i] = x;
  }
  return finishLut(lut);
}

/** Lightroom's parametric curve (highlights / lights / darks / shadows) as a LUT. */
export function parametricLut(s: Settings): Float32Array | null {
  const p = s.parametric;
  if (!p) return null;
  const amounts = [p.shadows ?? 0, p.darks ?? 0, p.lights ?? 0, p.highlights ?? 0].map((v) => v / 100);
  if (amounts.every((v) => !v)) return null;
  const s1 = (p.shadowSplit ?? 25) / 100;
  const s2 = (p.midtoneSplit ?? 50) / 100;
  const s3 = (p.highlightSplit ?? 75) / 100;
  const edges = [0, s1, s2, s3, 1];
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const v = i / LUT_N;
    let y = v;
    for (let r = 0; r < 4; r++) {
      if (!amounts[r]) continue;
      const c = (edges[r] + edges[r + 1]) / 2;
      const w = Math.max(0.08, edges[r + 1] - edges[r]);
      const t = (v - c) / w;
      if (t <= -1 || t >= 1) continue;
      const bump = (1 - t * t) * (1 - t * t);
      y += amounts[r] * 0.16 * bump;
    }
    // Pin the end points like Lightroom does.
    const pin = Math.min(1, v / 0.04) * Math.min(1, (1 - v) / 0.04);
    lut[i] = v + (y - v) * pin;
  }
  return finishLut(lut);
}

function finishLut(lut: Float32Array): Float32Array {
  let prev = 0;
  for (let i = 0; i <= LUT_N; i++) {
    let v = lut[i];
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    if (v < prev) v = prev;
    lut[i] = v;
    prev = v;
  }
  return lut;
}

/** Composes two LUTs: result(v) = outer(inner(v)). Either may be null (identity). */
export function composeLut(inner: Float32Array | null, outer: Float32Array | null): Float32Array | null {
  if (!inner) return outer;
  if (!outer) return inner;
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) lut[i] = lookup(outer, inner[i]);
  return lut;
}
