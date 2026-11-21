/** Colour-space helpers: sRGB transfer curve, OKLab, HSL. */

const N = 4096;
const TO_LIN = new Float32Array(N + 2);
const TO_SRGB = new Float32Array(N + 2);

function decodeExact(v: number): number {
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}
function encodeExact(v: number): number {
  if (v <= 0.0031308) return v * 12.92;
  return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

for (let i = 0; i <= N + 1; i++) {
  const v = Math.min(i / N, 1);
  TO_LIN[i] = decodeExact(v);
  TO_SRGB[i] = encodeExact(v);
}

/** sRGB-encoded value -> linear light. */
export function toLinear(v: number): number {
  if (v <= 0) return v / 12.92;
  if (v >= 1) return decodeExact(v);
  const x = v * N;
  const i = x | 0;
  const a = TO_LIN[i];
  return a + (TO_LIN[i + 1] - a) * (x - i);
}

/** Linear light -> sRGB-encoded value. */
export function toSrgb(v: number): number {
  if (v <= 0) return v * 12.92;
  if (v >= 1) return encodeExact(v);
  if (v < 0.0031308) return v * 12.92;
  const x = v * N;
  const i = x | 0;
  const a = TO_SRGB[i];
  return a + (TO_SRGB[i + 1] - a) * (x - i);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Linear sRGB -> OKLab, written into `out` as [L, a, b]. */
export function linearToOklab(r: number, g: number, b: number, out: Float64Array | number[]): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab -> linear sRGB, written into `out` as [r, g, b] (may be out of gamut). */
export function oklabToLinear(L: number, a: number, b: number, out: Float64Array | number[]): void {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}

/** HSL (h in degrees, s and l 0..1) -> sRGB-encoded [r, g, b]. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Hue angle (degrees, 0..360) of an sRGB-encoded colour in OKLab. */
export function oklabHueOf(rgb: [number, number, number]): number {
  const out = [0, 0, 0];
  linearToOklab(toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2]), out);
  const h = (Math.atan2(out[2], out[1]) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/** Unit OKLab (a, b) direction for a Lightroom colour-wheel hue (HSL degrees). */
export function gradeDirection(hue: number): [number, number] {
  const [r, g, b] = hslToRgb(hue, 1, 0.5);
  const out = [0, 0, 0];
  linearToOklab(toLinear(r), toLinear(g), toLinear(b), out);
  const len = Math.hypot(out[1], out[2]) || 1;
  return [out[1] / len, out[2] / len];
}
