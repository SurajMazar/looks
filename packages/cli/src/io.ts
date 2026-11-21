import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import type { RGBImage } from '@looks/core';

export interface LoadedImage {
  img: RGBImage;
  /** Alpha channel (one value per pixel, 0..1), when the image has one. */
  alpha: Float32Array | null;
  sixteenBit: boolean;
}

/** Formats sharp can write. Anything else (HEIC, RAW, ...) is saved as JPEG by default. */
export const WRITABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif']);

async function decode(input: string, maxSize?: number): Promise<LoadedImage> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const sixteenBit = meta.depth === 'ushort';
  let pipe = sharp(input, { failOn: 'none' }).rotate();
  if (maxSize && Math.max(meta.width ?? 0, meta.height ?? 0) > maxSize) {
    pipe = pipe.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
  }
  pipe = pipe.toColourspace(sixteenBit ? 'rgb16' : 'srgb');
  const { data, info } = await pipe.raw({ depth: sixteenBit ? 'ushort' : 'uchar' }).toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const n = width * height;
  const src: ArrayLike<number> = sixteenBit ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : data;
  const scale = sixteenBit ? 1 / 65535 : 1 / 255;
  const rgb = new Float32Array(n * 3);
  const hasAlpha = channels === 4 || channels === 2;
  const alpha = hasAlpha ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    const k = i * channels;
    if (channels >= 3) {
      rgb[i * 3] = src[k] * scale;
      rgb[i * 3 + 1] = src[k + 1] * scale;
      rgb[i * 3 + 2] = src[k + 2] * scale;
    } else {
      const v = src[k] * scale;
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
    }
    if (alpha) alpha[i] = src[k + channels - 1] * scale;
  }
  return { img: { width, height, data: rgb }, alpha, sixteenBit };
}

/** Decodes any image sharp can read; on macOS, falls back to `sips` for HEIC and friends. */
export async function readImage(input: string, maxSize?: number): Promise<LoadedImage> {
  try {
    return await decode(input, maxSize);
  } catch (err) {
    if (process.platform !== 'darwin') throw err;
    const dir = mkdtempSync(join(tmpdir(), 'looks-'));
    const tmp = join(dir, 'decoded.tiff');
    try {
      execFileSync('sips', ['-s', 'format', 'tiff', input, '--out', tmp], { stdio: 'ignore' });
      return await decode(tmp, maxSize);
    } catch {
      throw err;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export interface WriteOptions {
  quality: number;
  sixteenBit: boolean;
}

export async function writeImage(path: string, loaded: LoadedImage, opts: WriteOptions): Promise<void> {
  const { img, alpha } = loaded;
  const ext = extname(path).toLowerCase();
  if (!WRITABLE.has(ext)) throw new Error(`Can't write "${ext}" files; use .jpg, .png, .webp, .tif or .avif.`);
  const n = img.width * img.height;
  const keepAlpha = alpha && ext !== '.jpg' && ext !== '.jpeg';
  const channels = keepAlpha ? 4 : 3;
  const deep = opts.sixteenBit && (ext === '.png' || ext === '.tif' || ext === '.tiff');
  const max = deep ? 65535 : 255;
  const buf = deep ? new Uint16Array(n * channels) : new Uint8Array(n * channels);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const k = i * channels;
    let r = d[i * 3];
    let g = d[i * 3 + 1];
    let b = d[i * 3 + 2];
    if (alpha && !keepAlpha) {
      // Flatten onto white for formats without transparency.
      const a = alpha[i];
      r = r * a + (1 - a);
      g = g * a + (1 - a);
      b = b * a + (1 - a);
    }
    buf[k] = Math.round(r * max);
    buf[k + 1] = Math.round(g * max);
    buf[k + 2] = Math.round(b * max);
    if (keepAlpha) buf[k + 3] = Math.round(alpha[i] * max);
  }
  let pipe = sharp(buf, { raw: { width: img.width, height: img.height, channels } });
  if (deep) pipe = pipe.toColourspace('rgb16');
  pipe = pipe.withIccProfile('srgb');
  const q = Math.round(Math.min(100, Math.max(1, opts.quality)));
  if (ext === '.jpg' || ext === '.jpeg') pipe = pipe.jpeg({ quality: q, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0', mozjpeg: true });
  else if (ext === '.png') pipe = pipe.png({ compressionLevel: 9 });
  else if (ext === '.webp') pipe = pipe.webp({ quality: q });
  else if (ext === '.avif') pipe = pipe.avif({ quality: q });
  else pipe = pipe.tiff({ compression: 'lzw' });
  await pipe.toFile(path);
}
