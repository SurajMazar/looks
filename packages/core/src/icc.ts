/**
 * Just enough colour management to bring wide-gamut photos (iPhone Display P3,
 * Adobe RGB, BT.2020…) into sRGB: matrix/TRC ICC profiles and HEIF `nclx` boxes.
 */
import { toSrgb } from './color.js';
import type { RGBImage } from './types.js';

type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface RgbProfile {
  name: string;
  /** Linear RGB -> XYZ (D50 PCS), row-major. */
  toXYZ: Mat3;
  /** Per-channel transfer: encoded value (0..1) -> linear. */
  trc: [(v: number) => number, (v: number) => number, (v: number) => number];
}

const D50: [number, number, number] = [0.9642, 1, 0.8249];

function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** RGB -> XYZ(D50) matrix from xy chromaticities, Bradford-adapted like an ICC profile. */
function primariesToD50(xr: number, yr: number, xg: number, yg: number, xb: number, yb: number, xw: number, yw: number): Mat3 {
  const col = (x: number, y: number) => [x / y, 1, (1 - x - y) / y];
  const [R, G, B] = [col(xr, yr), col(xg, yg), col(xb, yb)];
  const P: Mat3 = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
  const W = col(xw, yw);
  const Pi = inv(P);
  const S = [Pi[0] * W[0] + Pi[1] * W[1] + Pi[2] * W[2], Pi[3] * W[0] + Pi[4] * W[1] + Pi[5] * W[2], Pi[6] * W[0] + Pi[7] * W[1] + Pi[8] * W[2]];
  const M: Mat3 = [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
  const coneW = [0, 1, 2].map((i) => BRADFORD[i * 3] * W[0] + BRADFORD[i * 3 + 1] * W[1] + BRADFORD[i * 3 + 2] * W[2]);
  const coneD = [0, 1, 2].map((i) => BRADFORD[i * 3] * D50[0] + BRADFORD[i * 3 + 1] * D50[1] + BRADFORD[i * 3 + 2] * D50[2]);
  const scale: Mat3 = [coneD[0] / coneW[0], 0, 0, 0, coneD[1] / coneW[1], 0, 0, 0, coneD[2] / coneW[2]];
  const adapt = mul(inv(BRADFORD), mul(scale, BRADFORD));
  return mul(adapt, M);
}

const srgbTrc = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const SRGB_TO_XYZ = primariesToD50(0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329);
const XYZ_TO_SRGB = inv(SRGB_TO_XYZ);

/** Known primaries for HEIF/AVIF `nclx` colour_primaries codes (ITU-T H.273). */
const NCLX_PRIMARIES: Record<number, { name: string; m: Mat3 }> = {
  1: { name: 'sRGB / BT.709', m: SRGB_TO_XYZ },
  9: { name: 'BT.2020', m: primariesToD50(0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329) },
  11: { name: 'DCI-P3', m: primariesToD50(0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.314, 0.351) },
  12: { name: 'Display P3', m: primariesToD50(0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329) },
};

/** Profile from a HEIF `nclx` colour box. HDR transfers (PQ/HLG) fall back to the sRGB curve. */
export function nclxProfile(primaries: number, transfer: number): RgbProfile | null {
  const p = NCLX_PRIMARIES[primaries];
  if (!p) return null;
  const gamma22 = (v: number) => Math.pow(Math.max(0, v), 2.2);
  const linear = (v: number) => v;
  const t = transfer === 8 ? linear : transfer === 4 ? gamma22 : srgbTrc;
  return { name: p.name, toXYZ: p.m, trc: [t, t, t] };
}

function s15(v: DataView, o: number): number {
  return v.getInt32(o) / 65536;
}

function parseTrc(v: DataView, o: number, size: number): ((x: number) => number) | null {
  const type = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (type === 'curv') {
    const n = v.getUint32(o + 8);
    if (n === 0) return (x) => x;
    if (n === 1) {
      const g = v.getUint16(o + 12) / 256;
      return (x) => Math.pow(Math.max(0, x), g);
    }
    if (12 + n * 2 > size) return null;
    const table = new Float32Array(n);
    for (let i = 0; i < n; i++) table[i] = v.getUint16(o + 12 + i * 2) / 65535;
    return (x) => {
      const p = Math.min(1, Math.max(0, x)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(p));
      return table[i] + (table[i + 1] - table[i]) * (p - i);
    };
  }
  if (type === 'para') {
    const fn = v.getUint16(o + 8);
    const counts = [1, 3, 4, 5, 7][fn];
    if (counts === undefined) return null;
    const p = Array.from({ length: counts }, (_, i) => s15(v, o + 12 + i * 4));
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
    switch (fn) {
      case 0:
        return (x) => Math.pow(Math.max(0, x), g);
      case 1:
        return (x) => (x >= -b / a ? Math.pow(Math.max(0, a * x + b), g) : 0);
      case 2:
        return (x) => (x >= -b / a ? Math.pow(Math.max(0, a * x + b), g) + c : c);
      case 3:
        return (x) => (x >= d ? Math.pow(Math.max(0, a * x + b), g) : c * x);
      default:
        return (x) => (x >= d ? Math.pow(Math.max(0, a * x + b), g) + e : c * x + f);
    }
  }
  return null;
}

/** Parses a matrix/TRC RGB ICC profile. Returns null for anything else (LUT-based, CMYK, grey…). */
export function parseIccProfile(icc: Uint8Array): RgbProfile | null {
  if (icc.length < 132) return null;
  const v = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const sig = (o: number) => String.fromCharCode(icc[o], icc[o + 1], icc[o + 2], icc[o + 3]);
  if (sig(16) !== 'RGB ' || sig(20) !== 'XYZ ') return null;
  const count = v.getUint32(128);
  const tags = new Map<string, { off: number; size: number }>();
  for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i++) {
    const base = 132 + i * 12;
    const off = v.getUint32(base + 4);
    const size = v.getUint32(base + 8);
    if (off + size <= icc.length) tags.set(sig(base), { off, size });
  }
  const xyz = (tag: string) => {
    const t = tags.get(tag);
    if (!t || sig(t.off) !== 'XYZ ') return null;
    return [s15(v, t.off + 8), s15(v, t.off + 12), s15(v, t.off + 16)];
  };
  const r = xyz('rXYZ');
  const g = xyz('gXYZ');
  const b = xyz('bXYZ');
  if (!r || !g || !b) return null;
  const trcs = ['rTRC', 'gTRC', 'bTRC'].map((k) => {
    const t = tags.get(k);
    return t ? parseTrc(v, t.off, t.size) : null;
  });
  if (trcs.some((t) => !t)) return null;

  let name = 'ICC profile';
  const desc = tags.get('desc');
  if (desc) {
    const type = sig(desc.off);
    if (type === 'desc') {
      const n = v.getUint32(desc.off + 8);
      name = String.fromCharCode(...icc.subarray(desc.off + 12, desc.off + 12 + Math.min(n, 64))).replace(/\0.*$/, '');
    } else if (type === 'mluc' && v.getUint32(desc.off + 8) > 0) {
      const len = v.getUint32(desc.off + 20);
      const off = desc.off + v.getUint32(desc.off + 24);
      const chars: number[] = [];
      for (let i = 0; i < Math.min(len, 128); i += 2) chars.push(v.getUint16(off + i));
      name = String.fromCharCode(...chars);
    }
  }
  return {
    name,
    toXYZ: [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]],
    trc: trcs as RgbProfile['trc'],
  };
}

/** True when converting would change nothing visible (already sRGB). */
export function isSrgbLike(p: RgbProfile): boolean {
  const close = p.toXYZ.every((x, i) => Math.abs(x - SRGB_TO_XYZ[i]) < 0.01);
  if (!close) return false;
  return p.trc.every((t) => [0.05, 0.2, 0.5, 0.8].every((x) => Math.abs(t(x) - srgbTrc(x)) < 0.01));
}

/** Converts an image tagged with `p` to sRGB, in place. */
export function convertToSrgb(img: RGBImage, p: RgbProfile): void {
  if (isSrgbLike(p)) return;
  const M = mul(XYZ_TO_SRGB, p.toXYZ);
  const N = 1024;
  const luts = p.trc.map((t) => {
    const l = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) l[i] = t(i / N);
    return l;
  });
  const look = (l: Float32Array, x: number) => {
    const q = (x <= 0 ? 0 : x >= 1 ? 1 : x) * N;
    const i = q >= N ? N - 1 : q | 0;
    return l[i] + (l[i + 1] - l[i]) * (q - i);
  };
  const d = img.data;
  for (let i = 0; i < d.length; i += 3) {
    const r = look(luts[0], d[i]);
    const g = look(luts[1], d[i + 1]);
    const b = look(luts[2], d[i + 2]);
    d[i] = toSrgb(Math.min(1, Math.max(0, M[0] * r + M[1] * g + M[2] * b)));
    d[i + 1] = toSrgb(Math.min(1, Math.max(0, M[3] * r + M[4] * g + M[5] * b)));
    d[i + 2] = toSrgb(Math.min(1, Math.max(0, M[6] * r + M[7] * g + M[8] * b)));
  }
}
