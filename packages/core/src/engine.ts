import { gaussianBlur } from './blur.js';
import {
  clamp01,
  gradeDirection,
  linearToOklab,
  oklabHueOf,
  oklabToLinear,
  smoothstep,
  toLinear,
  toSrgb,
} from './color.js';
import { TUNING } from './tuning.js';
import { composeLut, curveLut, lookup, parametricLut, toneLut } from './curves.js';
import { MIXER_COLORS, type ApplyOptions, type MixerColor, type RGBImage, type Settings } from './types.js';

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/**
 * Applies Lightroom-style develop settings to an image, in place.
 *
 * Order follows Lightroom's pipeline closely: noise reduction, white balance &
 * exposure (linear light), dehaze, Light panel tone curve, point curves,
 * texture & clarity, vibrance & saturation, colour mixer, colour grading,
 * sharpening, vignette, grain.
 */
export function applySettings(img: RGBImage, s: Settings, opt: ApplyOptions = {}): void {
  const strength = Math.min(1, Math.max(0, opt.strength ?? 1));
  if (strength === 0) return;
  const original = strength < 1 ? new Float32Array(img.data) : null;
  const px = opt.pixelScale && opt.pixelScale > 0 ? opt.pixelScale : 1;

  noiseReduction(img, s, px);

  // Per-pixel stages are baked into a 3D LUT on big images (much faster);
  // spatial stages (dehaze, clarity/texture) split the chain.
  const early: Stage[] = [];
  if (s.dehaze) linearStage(img, s);
  else if (s.exposure || s.temp || s.tint) early.push(linearStage);
  if (toneActive(s)) early.push(toneStage);
  const late: Stage[] = colorActive(s) ? [colorStage] : [];
  if (s.clarity || s.texture) {
    runPointwise(img, s, early);
    presence(img, s);
    runPointwise(img, s, late);
  } else {
    runPointwise(img, s, [...early, ...late]);
  }

  sharpen(img, s, px);
  vignette(img, s);
  grain(img, s, px, opt.seed ?? 1);

  const d = img.data;
  if (original) {
    for (let i = 0; i < d.length; i++) {
      const o = original[i];
      d[i] = clamp01(o + (d[i] - o) * strength);
    }
  } else {
    for (let i = 0; i < d.length; i++) d[i] = clamp01(d[i]);
  }
}

type Stage = (img: RGBImage, s: Settings) => void;

/** Images at least this big go through a 3D LUT instead of per-pixel maths. */
const LUT_MIN_PIXELS = 200_000;

function toneActive(s: Settings): boolean {
  return !!(toneLut(s) || parametricLut(s) || Object.values(s.curve ?? {}).some((c) => c && c.length >= 2));
}

function colorActive(s: Settings): boolean {
  if (s.vibrance || s.saturation || mixerTables(s)) return true;
  const g = s.grading;
  return !!g && [g.shadows, g.midtones, g.highlights, g.global].some((w) => (w?.sat ?? 0) > 0 || (w?.lum ?? 0) !== 0);
}

function runPointwise(img: RGBImage, s: Settings, stages: Stage[]): void {
  if (!stages.length) return;
  const n = img.width * img.height;
  if (n < LUT_MIN_PIXELS) {
    for (const f of stages) f(img, s);
    return;
  }
  const N = n > 3_000_000 ? 65 : 33;
  const lattice = new Float32Array(N * N * N * 3);
  const step = 1 / (N - 1);
  let k = 0;
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        lattice[k++] = r * step;
        lattice[k++] = g * step;
        lattice[k++] = b * step;
      }
    }
  }
  const lut: RGBImage = { width: N * N * N, height: 1, data: lattice };
  for (const f of stages) f(lut, s);
  applyLut3D(img.data, lattice, N);
}

/** Tetrahedral interpolation through an N×N×N RGB LUT (r fastest, then g, then b). */
function applyLut3D(d: Float32Array, lut: Float32Array, N: number): void {
  const m = N - 1;
  const dr = 3;
  const dg = N * 3;
  const db = N * N * 3;
  for (let i = 0; i < d.length; i += 3) {
    const r = clamp01(d[i]) * m;
    const g = clamp01(d[i + 1]) * m;
    const b = clamp01(d[i + 2]) * m;
    const r0 = r >= m ? m - 1 : r | 0;
    const g0 = g >= m ? m - 1 : g | 0;
    const b0 = b >= m ? m - 1 : b | 0;
    const fr = r - r0;
    const fg = g - g0;
    const fb = b - b0;
    const c000 = ((b0 * N + g0) * N + r0) * 3;
    const c111 = c000 + dr + dg + db;
    let cA: number;
    let cB: number;
    let w0: number;
    let wA: number;
    let wB: number;
    let w1: number;
    if (fr >= fg) {
      if (fg >= fb) {
        cA = c000 + dr; cB = cA + dg; w0 = 1 - fr; wA = fr - fg; wB = fg - fb; w1 = fb;
      } else if (fr >= fb) {
        cA = c000 + dr; cB = cA + db; w0 = 1 - fr; wA = fr - fb; wB = fb - fg; w1 = fg;
      } else {
        cA = c000 + db; cB = cA + dr; w0 = 1 - fb; wA = fb - fr; wB = fr - fg; w1 = fg;
      }
    } else if (fb >= fg) {
      cA = c000 + db; cB = cA + dg; w0 = 1 - fb; wA = fb - fg; wB = fg - fr; w1 = fr;
    } else if (fb >= fr) {
      cA = c000 + dg; cB = cA + db; w0 = 1 - fg; wA = fg - fb; wB = fb - fr; w1 = fr;
    } else {
      cA = c000 + dg; cB = cA + dr; w0 = 1 - fg; wA = fg - fr; wB = fr - fb; w1 = fb;
    }
    d[i] = w0 * lut[c000] + wA * lut[cA] + wB * lut[cB] + w1 * lut[c111];
    d[i + 1] = w0 * lut[c000 + 1] + wA * lut[cA + 1] + wB * lut[cB + 1] + w1 * lut[c111 + 1];
    d[i + 2] = w0 * lut[c000 + 2] + wA * lut[cA + 2] + wB * lut[cB + 2] + w1 * lut[c111 + 2];
  }
}

function luma(d: Float32Array, n: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) y[i] = LR * d[j] + LG * d[j + 1] + LB * d[j + 2];
  return y;
}

function addToChannels(d: Float32Array, delta: Float32Array): void {
  for (let i = 0, j = 0; i < delta.length; i++, j += 3) {
    const v = delta[i];
    d[j] += v;
    d[j + 1] += v;
    d[j + 2] += v;
  }
}

// ---------------------------------------------------------------- detail

function noiseReduction(img: RGBImage, s: Settings, px: number): void {
  const lum = Math.max(0, s.noiseReduction?.luminance ?? 0) / 100;
  const col = Math.max(0, s.noiseReduction?.color ?? 0) / 100;
  if (!lum && !col) return;
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const Y = new Float32Array(n);
  let Cb = new Float32Array(n);
  let Cr = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const y = LR * d[j] + LG * d[j + 1] + LB * d[j + 2];
    Y[i] = y;
    Cr[i] = d[j] - y;
    Cb[i] = d[j + 2] - y;
  }
  if (col > 0) {
    const sigma = (1 + col * 4) * px;
    if (sigma > 0.5) {
      const mix = Math.min(1, col * 2.5);
      const cbB = gaussianBlur(Cb, w, h, sigma);
      const crB = gaussianBlur(Cr, w, h, sigma);
      for (let i = 0; i < n; i++) {
        Cb[i] += (cbB[i] - Cb[i]) * mix;
        Cr[i] += (crB[i] - Cr[i]) * mix;
      }
    }
  }
  if (lum > 0) {
    const sigma = (0.6 + lum * 1.6) * px;
    if (sigma > 0.4) {
      const yB = gaussianBlur(Y, w, h, sigma);
      const strength = Math.pow(lum, 0.6);
      for (let i = 0; i < n; i++) {
        const diff = Math.abs(Y[i] - yB[i]);
        const wgt = strength * (1 - smoothstep(0.012, 0.06, diff));
        Y[i] += (yB[i] - Y[i]) * wgt;
      }
    }
  }
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const y = Y[i];
    const r = y + Cr[i];
    const b = y + Cb[i];
    d[j] = r;
    d[j + 1] = (y - LR * r - LB * b) / LG;
    d[j + 2] = b;
  }
  Cb = Cr = new Float32Array(0);
}

// ---------------------------------------------------------------- linear light

function linearStage(img: RGBImage, s: Settings): void {
  const ev = s.exposure ?? 0;
  const t = (s.temp ?? 0) / 100;
  const u = (s.tint ?? 0) / 100;
  const dz = (s.dehaze ?? 0) / 100;
  if (!ev && !t && !u && !dz) return;
  const { width: w, height: h, data: d } = img;
  const n = w * h;

  const k = Math.pow(2, ev);
  let gr = Math.exp(0.3 * t + 0.07 * u);
  let gg = Math.exp(-0.18 * u);
  let gb = Math.exp(-0.36 * t + 0.07 * u);
  const norm = LR * gr + LG * gg + LB * gb;
  gr = (gr / norm) * k;
  gg = (gg / norm) * k;
  gb = (gb / norm) * k;

  const haze = dz ? new Float32Array(n) : null;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = toLinear(d[j]) * gr;
    const g = toLinear(d[j + 1]) * gg;
    const b = toLinear(d[j + 2]) * gb;
    d[j] = r;
    d[j + 1] = g;
    d[j + 2] = b;
    if (haze) haze[i] = Math.min(r, g, b, 1);
  }

  if (haze) {
    const hz = gaussianBlur(haze, w, h, Math.max(2, 0.02 * Math.min(w, h)));
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      if (dz > 0) {
        const a = dz * 0.8 * Math.min(hz[i], 0.9);
        const inv = 1 / (1 - a);
        d[j] = (d[j] - a) * inv;
        d[j + 1] = (d[j + 1] - a) * inv;
        d[j + 2] = (d[j + 2] - a) * inv;
      } else {
        const a = -dz * 0.5;
        const veil = 0.55;
        d[j] += (veil - d[j]) * a;
        d[j + 1] += (veil - d[j + 1]) * a;
        d[j + 2] += (veil - d[j + 2]) * a;
      }
    }
  }

  for (let j = 0; j < d.length; j++) d[j] = toSrgb(d[j]);
}

// ---------------------------------------------------------------- tone

function toneStage(img: RGBImage, s: Settings): void {
  const d = img.data;
  const tone = toneLut(s);
  if (tone) rgbTone(d, tone);

  const master = composeLut(parametricLut(s), curveLut(s.curve?.rgb));
  const lr = composeLut(master, curveLut(s.curve?.red));
  const lg = composeLut(master, curveLut(s.curve?.green));
  const lb = composeLut(master, curveLut(s.curve?.blue));
  if (!lr && !lg && !lb) return;
  for (let j = 0; j < d.length; j += 3) {
    if (lr) d[j] = lookup(lr, d[j]);
    if (lg) d[j + 1] = lookup(lg, d[j + 1]);
    if (lb) d[j + 2] = lookup(lb, d[j + 2]);
  }
}

/**
 * Hue-preserving tone curve (the method from Adobe's DNG SDK): the curve is
 * applied to the largest and smallest channel and the middle channel is
 * interpolated, so hues stay put while contrast still adds some saturation.
 */
function rgbTone(d: Float32Array, lut: Float32Array): void {
  for (let i = 0; i < d.length; i += 3) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (r >= g) {
      if (g >= b) {
        const R = lookup(lut, r);
        const B = lookup(lut, b);
        d[i] = R;
        d[i + 2] = B;
        d[i + 1] = r === b ? R : B + ((R - B) * (g - b)) / (r - b);
      } else if (b >= r) {
        const B = lookup(lut, b);
        const G = lookup(lut, g);
        d[i + 2] = B;
        d[i + 1] = G;
        d[i] = b === g ? B : G + ((B - G) * (r - g)) / (b - g);
      } else {
        const R = lookup(lut, r);
        const G = lookup(lut, g);
        d[i] = R;
        d[i + 1] = G;
        d[i + 2] = G + ((R - G) * (b - g)) / (r - g);
      }
    } else if (r >= b) {
      const G = lookup(lut, g);
      const B = lookup(lut, b);
      d[i + 1] = G;
      d[i + 2] = B;
      d[i] = B + ((G - B) * (r - b)) / (g - b);
    } else if (b >= g) {
      const B = lookup(lut, b);
      const R = lookup(lut, r);
      d[i + 2] = B;
      d[i] = R;
      d[i + 1] = R + ((B - R) * (g - r)) / (b - r);
    } else {
      const G = lookup(lut, g);
      const R = lookup(lut, r);
      d[i + 1] = G;
      d[i] = R;
      d[i + 2] = R + ((G - R) * (b - r)) / (g - r);
    }
  }
}

// ---------------------------------------------------------------- presence

function presence(img: RGBImage, s: Settings): void {
  const clarity = (s.clarity ?? 0) / 100;
  const texture = (s.texture ?? 0) / 100;
  if (!clarity && !texture) return;
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const minDim = Math.min(w, h);
  const Y = luma(d, n);
  const delta = new Float32Array(n);
  if (clarity) {
    const base = gaussianBlur(Y, w, h, Math.max(1.5, 0.012 * minDim));
    for (let i = 0; i < n; i++) {
      const y = Y[i];
      const mid = Math.sqrt(clamp01(4 * y * (1 - y)));
      delta[i] += clarity * 0.85 * (y - base[i]) * mid;
    }
  }
  if (texture) {
    const base = gaussianBlur(Y, w, h, Math.max(0.8, 0.0025 * minDim));
    for (let i = 0; i < n; i++) {
      const y = Y[i];
      const mid = Math.sqrt(clamp01(4 * y * (1 - y)));
      delta[i] += texture * 0.9 * (y - base[i]) * mid;
    }
  }
  addToChannels(d, delta);
}

// ---------------------------------------------------------------- colour

const BAND_RGB: Record<MixerColor, [number, number, number]> = {
  red: [1, 0, 0],
  orange: [1, 0.5, 0],
  yellow: [1, 1, 0],
  green: [0, 1, 0],
  aqua: [0, 1, 1],
  blue: [0, 0, 1],
  purple: [0.5, 0, 1],
  magenta: [1, 0, 1],
};

/** OKLab hue (degrees) at the centre of each Color Mixer band, in mixer order. */
export const BAND_CENTERS: number[] = MIXER_COLORS.map((c) => oklabHueOf(BAND_RGB[c]));

interface MixerTables {
  shift: Float32Array;
  sat: Float32Array;
  lum: Float32Array;
}

function mixerTables(s: Settings): MixerTables | null {
  const m = s.mixer;
  if (!m) return null;
  const hue = MIXER_COLORS.map((c) => m[c]?.hue ?? 0);
  const sat = MIXER_COLORS.map((c) => m[c]?.sat ?? 0);
  const lum = MIXER_COLORS.map((c) => m[c]?.lum ?? 0);
  if ([...hue, ...sat, ...lum].every((v) => !v)) return null;

  const nb = BAND_CENTERS.length;
  const wrap = (x: number) => ((x % 360) + 360) % 360;
  const dist = (from: number, to: number) => wrap(to - from);
  const shiftOf = hue.map((v, k) => {
    if (!v) return 0;
    const next = BAND_CENTERS[(k + 1) % nb];
    const prev = BAND_CENTERS[(k + nb - 1) % nb];
    const span = v > 0 ? dist(BAND_CENTERS[k], next) : dist(prev, BAND_CENTERS[k]);
    return (v / 100) * TUNING.mixerHueSpan * span;
  });

  const tables: MixerTables = {
    shift: new Float32Array(362),
    sat: new Float32Array(362),
    lum: new Float32Array(362),
  };
  for (let deg = 0; deg <= 361; deg++) {
    const hDeg = wrap(deg);
    let k = nb - 1;
    for (let i = 0; i < nb; i++) {
      if (dist(BAND_CENTERS[i], hDeg) < dist(BAND_CENTERS[i], BAND_CENTERS[(i + 1) % nb])) {
        k = i;
        break;
      }
    }
    const k2 = (k + 1) % nb;
    const t = dist(BAND_CENTERS[k], hDeg) / dist(BAND_CENTERS[k], BAND_CENTERS[k2]);
    const w1 = 1 - t;
    const w2 = t;
    tables.shift[deg] = w1 * shiftOf[k] + w2 * shiftOf[k2];
    tables.sat[deg] = Math.max(0, 1 + ((w1 * sat[k] + w2 * sat[k2]) / 100) * TUNING.mixerSatK);
    tables.lum[deg] = ((w1 * lum[k] + w2 * lum[k2]) / 100) * TUNING.mixerLumK;
  }
  return tables;
}

interface Grade {
  a: number;
  b: number;
  l: number;
}

function gradeOf(wheel: { hue?: number; sat?: number; lum?: number } | undefined): Grade {
  const sat = Math.max(0, wheel?.sat ?? 0) / 100;
  const [da, db] = gradeDirection(wheel?.hue ?? 0);
  return { a: da * sat * TUNING.gradeSatK, b: db * sat * TUNING.gradeSatK, l: ((wheel?.lum ?? 0) / 100) * TUNING.gradeLumK };
}

function colorStage(img: RGBImage, s: Settings): void {
  const vib = (s.vibrance ?? 0) / 100;
  const sat = (s.saturation ?? 0) / 100;
  const mix = mixerTables(s);
  const g = s.grading;
  const gS = gradeOf(g?.shadows);
  const gM = gradeOf(g?.midtones);
  const gH = gradeOf(g?.highlights);
  const gG = gradeOf(g?.global);
  const grading = [gS, gM, gH, gG].some((x) => x.a || x.b || x.l);
  if (!vib && !sat && !mix && !grading) return;

  const balance = Math.max(-1, Math.min(1, (g?.balance ?? 0) / 100));
  const blending = Math.max(0, Math.min(1, (g?.blending ?? 50) / 100));
  const pivot = TUNING.gradePivot - balance * 0.3;
  const blendExp = Math.pow(2, (0.5 - blending) * 3);

  const d = img.data;
  const lab = new Float64Array(3);
  const rgb = new Float64Array(3);
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;

  for (let i = 0; i < d.length; i += 3) {
    let r = d[i];
    let gg = d[i + 1];
    let b = d[i + 2];

    if (vib || sat) {
      const y = clamp01(LR * r + LG * gg + LB * b);
      const mx = Math.max(r, gg, b);
      const mn = Math.min(r, gg, b);
      const S = mx > 1e-6 ? (mx - mn) / mx : 0;
      let f = 1 + sat;
      if (vib > 0) {
        // Vibrance favours muted colours and protects skin tones.
        let skin = 0;
        if (S > 0.05 && r >= gg && gg >= b) {
          const hue = (60 * (gg - b)) / (mx - mn);
          const dh = (hue - 25) / 18;
          skin = Math.exp(-dh * dh);
        }
        f *= 1 + vib * TUNING.vibranceK * (1 - S) * (1 - 0.6 * skin);
      } else if (vib < 0) {
        f *= 1 + vib * (0.6 + 0.4 * (1 - S));
      }
      if (f < 0) f = 0;
      r = y + (r - y) * f;
      gg = y + (gg - y) * f;
      b = y + (b - y) * f;
      let t = 1;
      if (r > 1) t = Math.min(t, (1 - y) / (r - y));
      else if (r < 0) t = Math.min(t, y / (y - r));
      if (gg > 1) t = Math.min(t, (1 - y) / (gg - y));
      else if (gg < 0) t = Math.min(t, y / (y - gg));
      if (b > 1) t = Math.min(t, (1 - y) / (b - y));
      else if (b < 0) t = Math.min(t, y / (y - b));
      if (t < 1) {
        r = y + (r - y) * t;
        gg = y + (gg - y) * t;
        b = y + (b - y) * t;
      }
    }

    if (mix || grading) {
      linearToOklab(toLinear(r), toLinear(gg), toLinear(b), lab);
      let L = lab[0];
      let A = lab[1];
      let B = lab[2];

      if (mix) {
        const C = Math.sqrt(A * A + B * B);
        if (C > 1e-5) {
          let H = Math.atan2(B, A) * DEG;
          if (H < 0) H += 360;
          const hi = H | 0;
          const hf = H - hi;
          const shift = mix.shift[hi] + (mix.shift[hi + 1] - mix.shift[hi]) * hf;
          const satM = mix.sat[hi] + (mix.sat[hi + 1] - mix.sat[hi]) * hf;
          const lumM = mix.lum[hi] + (mix.lum[hi + 1] - mix.lum[hi]) * hf;
          const cw = smoothstep(0.01, 0.08, C);
          const H2 = (H + shift) * RAD;
          const C2 = C * satM;
          A = C2 * Math.cos(H2);
          B = C2 * Math.sin(H2);
          L *= 1 + lumM * cw;
        }
      }

      if (grading) {
        const x0 = L < pivot ? (0.5 * Math.max(L, 0)) / pivot : 0.5 + (0.5 * Math.min(L - pivot, 1 - pivot)) / (1 - pivot);
        const x = x0 < 0.5 ? 0.5 * Math.pow(2 * x0, blendExp) : 1 - 0.5 * Math.pow(2 * (1 - x0), blendExp);
        const ws = (1 - x) * (1 - x);
        const wm = 2 * x * (1 - x);
        const wh = x * x;
        // Keep true black and white close to neutral, as Lightroom does.
        const protect = Math.min(1, Math.max(0, L) * 5) * Math.min(1, (1.02 - L) * 4 + 0.2);
        A += (ws * gS.a + wm * gM.a + wh * gH.a + gG.a) * protect;
        B += (ws * gS.b + wm * gM.b + wh * gH.b + gG.b) * protect;
        L += ws * gS.l + wm * gM.l + wh * gH.l + gG.l;
      }

      oklabToLinear(L, A, B, rgb);
      // Gamut-map by pulling chroma toward the neutral of the same lightness.
      const grey = Math.min(1, Math.max(0, L * L * L));
      let t = 1;
      for (let c = 0; c < 3; c++) {
        const v = rgb[c];
        if (v > 1) t = Math.min(t, (1 - grey) / (v - grey));
        else if (v < 0) t = Math.min(t, grey / (grey - v));
      }
      r = toSrgb(grey + (rgb[0] - grey) * t);
      gg = toSrgb(grey + (rgb[1] - grey) * t);
      b = toSrgb(grey + (rgb[2] - grey) * t);
    }

    d[i] = r;
    d[i + 1] = gg;
    d[i + 2] = b;
  }
}

// ---------------------------------------------------------------- sharpening

function sharpen(img: RGBImage, s: Settings, px: number): void {
  const amount = Math.max(0, s.sharpening?.amount ?? 0) / 100;
  if (!amount) return;
  const radius = s.sharpening?.radius ?? 1;
  const sigma = radius * px * 0.8;
  if (sigma < 0.3) return; // sub-pixel at this preview size
  const detail = (s.sharpening?.detail ?? 25) / 100;
  const masking = (s.sharpening?.masking ?? 0) / 100;
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const Y = luma(d, n);
  const blur = gaussianBlur(Y, w, h, sigma);
  const limit = 0.04 + detail * 0.3;

  let mask: Float32Array | null = null;
  if (masking > 0) {
    const sm = gaussianBlur(Y, w, h, Math.max(1, 1.2 * px));
    const thr = Math.pow(masking, 1.5) * 0.05;
    mask = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y;
      const yd = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : x;
        const xr = x < w - 1 ? x + 1 : x;
        const gx = sm[y * w + xr] - sm[y * w + xl];
        const gy = sm[yd * w + x] - sm[yu * w + x];
        const grad = Math.sqrt(gx * gx + gy * gy);
        mask[y * w + x] = smoothstep(thr * 0.4, thr * 1.4 + 0.004, grad);
      }
    }
  }

  const delta = new Float32Array(n);
  const k = amount * 1.4;
  for (let i = 0; i < n; i++) {
    let hp = Y[i] - blur[i];
    if (hp > limit) hp = limit;
    else if (hp < -limit) hp = -limit;
    delta[i] = k * hp * (mask ? mask[i] : 1);
  }
  addToChannels(d, delta);
}

// ---------------------------------------------------------------- effects

function vignette(img: RGBImage, s: Settings): void {
  const amount = (s.vignette?.amount ?? 0) / 100;
  if (!amount) return;
  const midpoint = (s.vignette?.midpoint ?? 50) / 100;
  const roundness = (s.vignette?.roundness ?? 0) / 100;
  const feather = (s.vignette?.feather ?? 50) / 100;
  const hiPrio = (s.vignette?.highlights ?? 0) / 100;
  const { width: w, height: h, data: d } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const R = Math.min(w, h) / 2;
  const m = 0.35 + midpoint * 0.9;
  const f = 0.05 + feather * 0.9;
  const p = roundness < 0 ? 2 + -roundness * 6 : 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = (x - cx) / cx;
      let ny = (y - cy) / cy;
      if (roundness > 0) {
        nx += ((x - cx) / R - nx) * roundness;
        ny += ((y - cy) / R - ny) * roundness;
      }
      const dd = p === 2 ? Math.sqrt(nx * nx + ny * ny) : Math.pow(Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p), 1 / p);
      const v = smoothstep(m - f / 2, m + f / 2, dd);
      if (v <= 0) continue;
      const j = (y * w + x) * 3;
      if (amount < 0) {
        const yy = clamp01(LR * d[j] + LG * d[j + 1] + LB * d[j + 2]);
        const k = 1 + amount * v * (1 - hiPrio * yy * yy);
        d[j] *= k;
        d[j + 1] *= k;
        d[j + 2] *= k;
      } else {
        const k = amount * v;
        d[j] += (1 - d[j]) * k;
        d[j + 1] += (1 - d[j + 1]) * k;
        d[j + 2] += (1 - d[j + 2]) * k;
      }
    }
  }
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function grain(img: RGBImage, s: Settings, px: number, seed: number): void {
  const amount = Math.max(0, s.grain?.amount ?? 0) / 100;
  if (!amount) return;
  const size = (s.grain?.size ?? 25) / 100;
  const rough = (s.grain?.roughness ?? 50) / 100;
  const { width: w, height: h, data: d } = img;
  const fullCell = 1 + size * 4;
  let cell = fullCell * px;
  let amp = amount * 0.11;
  if (cell < 1) {
    amp *= cell;
    cell = 1;
  }
  const inv = 1 / cell;
  for (let y = 0; y < h; y++) {
    const gy = y * inv;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = x * inv;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const n00 = hash(x0, y0, seed);
      const n10 = hash(x0 + 1, y0, seed);
      const n01 = hash(x0, y0 + 1, seed);
      const n11 = hash(x0 + 1, y0 + 1, seed);
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const smooth = n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
      const fine = hash(x, y, seed + 7);
      const nval = (smooth + (fine - smooth) * rough * 0.6 - 0.5) * 2;
      const j = (y * w + x) * 3;
      const yy = clamp01(LR * d[j] + LG * d[j + 1] + LB * d[j + 2]);
      const g = nval * amp * (0.35 + 0.65 * Math.sqrt(4 * yy * (1 - yy)));
      d[j] += g;
      d[j + 1] += g;
      d[j + 2] += g;
    }
  }
}
