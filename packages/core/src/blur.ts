/** Fast Gaussian blur for single-channel float images (three box-blur passes). */

function boxSizes(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    const last = src[row + w - 1];
    let acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      const addIdx = x + r;
      const subIdx = x - r - 1;
      acc += addIdx < w ? src[row + addIdx] : last;
      acc -= subIdx >= 0 ? src[row + subIdx] : first;
      dst[row + x] = acc * inv;
    }
  }
}

// Row-by-row with one running sum per column, so memory is read in order.
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (r + r + 1);
  const acc = new Float64Array(w);
  for (let x = 0; x < w; x++) acc[x] = (r + 1) * src[x];
  for (let j = 0; j < r; j++) {
    const row = Math.min(j, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = Math.min(y + r, h - 1) * w;
    const sub = Math.max(y - r - 1, 0) * w;
    const out = y * w;
    for (let x = 0; x < w; x++) {
      const a = acc[x] + src[add + x] - src[sub + x];
      acc[x] = a;
      dst[out + x] = a * inv;
    }
  }
}

/** Returns a blurred copy of `src`. Sigma is in pixels. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(src);
  if (!(sigma > 0.25) || w < 2 || h < 2) return out;
  const tmp = new Float32Array(src.length);
  for (const size of boxSizes(sigma, 3)) {
    const r = Math.max(0, (size - 1) >> 1);
    if (r === 0) continue;
    boxH(out, tmp, w, h, r);
    boxV(tmp, out, w, h, r);
  }
  return out;
}
