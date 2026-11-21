/**
 * HEIC/HEIF decoding on top of libheif-js (passed in, so this package stays
 * dependency-free), with the colour profile from the file applied so iPhone
 * Display P3 photos keep their colours.
 */
import { convertToSrgb, nclxProfile, parseIccProfile, type RgbProfile } from './icc.js';
import type { RGBImage } from './types.js';

/** The slice of libheif-js that we use. */
export interface LibHeif {
  HeifDecoder: new () => { decode(data: ArrayBuffer | Uint8Array): HeifImage[] };
}
interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary?(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: { data: Uint8ClampedArray } | null) => void): void;
  free?(): void;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2', 'mif3']);

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/** Sniffs the ISO-BMFF `ftyp` box for a HEIF brand. */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || fourcc(bytes, 4) !== 'ftyp') return false;
  const size = Math.min(bytes.length, (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
  if (HEIF_BRANDS.has(fourcc(bytes, 8))) return true;
  for (let o = 16; o + 4 <= size; o += 4) if (HEIF_BRANDS.has(fourcc(bytes, o))) return true;
  return false;
}

/** Finds the colour profile stored in the HEIF `colr` box (ICC first, then nclx). */
export function heifColourProfile(bytes: Uint8Array): RgbProfile | null {
  let nclx: RgbProfile | null = null;
  const limit = Math.min(bytes.length - 12, 1 << 20); // metadata sits at the front
  for (let i = 4; i < limit; i++) {
    if (bytes[i] !== 0x63 || bytes[i + 1] !== 0x6f || bytes[i + 2] !== 0x6c || bytes[i + 3] !== 0x72) continue; // "colr"
    const size = ((bytes[i - 4] << 24) | (bytes[i - 3] << 16) | (bytes[i - 2] << 8) | bytes[i - 1]) >>> 0;
    if (size < 12 || i - 4 + size > bytes.length) continue;
    const kind = fourcc(bytes, i + 4);
    if (kind === 'prof' || kind === 'rICC') {
      const p = parseIccProfile(bytes.subarray(i + 8, i - 4 + size));
      if (p) return p;
    } else if (kind === 'nclx' && !nclx) {
      const primaries = (bytes[i + 8] << 8) | bytes[i + 9];
      const transfer = (bytes[i + 10] << 8) | bytes[i + 11];
      nclx = nclxProfile(primaries, transfer);
    }
  }
  return nclx;
}

export interface DecodedHeif {
  img: RGBImage;
  /** Name of the colour profile that was converted to sRGB, if any. */
  profile?: string;
}

export async function decodeHeif(lib: LibHeif, bytes: Uint8Array): Promise<DecodedHeif> {
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images.length) throw new Error('No image found in this HEIC/HEIF file.');
  const image = images.find((i) => i.is_primary?.()) ?? images[0];
  const width = image.get_width();
  const height = image.get_height();
  const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d) =>
      d ? resolve(d.data) : reject(new Error('Could not decode this HEIC/HEIF image.')),
    );
  });
  for (const i of images) i.free?.();

  const n = width * height;
  const data = new Float32Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
    data[j] = rgba[k] / 255;
    data[j + 1] = rgba[k + 1] / 255;
    data[j + 2] = rgba[k + 2] / 255;
  }
  const img: RGBImage = { width, height, data };
  const profile = heifColourProfile(bytes);
  if (profile) convertToSrgb(img, profile);
  return { img, profile: profile?.name };
}
