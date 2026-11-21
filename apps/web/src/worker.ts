/// <reference lib="webworker" />
import { applySettings, decodeHeif, imageToRgba, rgbaToImage, type LibHeif, type Settings } from '@looks/core';

export type WorkerRequest =
  /** `source` is a decoded bitmap, or the raw bytes of a HEIC/HEIF file the browser can't decode. */
  | { type: 'load'; id: number; source: ImageBitmap | ArrayBuffer; maxPreview: number }
  | { type: 'render'; id: number; settings: Settings; strength: number }
  | { type: 'export'; id: number; settings: Settings; strength: number; mime: string; quality: number };

export type WorkerResponse =
  | { type: 'loaded'; id: number; before: ImageBitmap; width: number; height: number; previewW: number; previewH: number; profile?: string }
  | { type: 'frame'; id: number; rgba: Uint8ClampedArray; width: number; height: number; ms: number }
  | { type: 'exported'; id: number; blob: Blob; ms: number }
  | { type: 'error'; id?: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let full: ImageBitmap | null = null;
let preview: { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; scale: number } | null = null;
let libheif: Promise<LibHeif> | null = null;

/** libheif (~2 MB of WebAssembly) is only fetched the first time someone opens a HEIC. */
function loadLibheif(): Promise<LibHeif> {
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => Promise.resolve(m.default()) as Promise<LibHeif>);
  return libheif;
}

function pixels(bitmap: ImageBitmap, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const canvas = new OffscreenCanvas(w, h);
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(bitmap, 0, 0, w, h);
  return c.getImageData(0, 0, w, h).data;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      let bitmap: ImageBitmap;
      let profile: string | undefined;
      if (msg.source instanceof ArrayBuffer) {
        const decoded = await decodeHeif(await loadLibheif(), new Uint8Array(msg.source));
        profile = decoded.profile;
        const rgba = imageToRgba(decoded.img);
        bitmap = await createImageBitmap(new ImageData(rgba, decoded.img.width, decoded.img.height));
      } else {
        bitmap = msg.source;
      }
      full?.close();
      full = bitmap;
      const scale = Math.min(1, msg.maxPreview / Math.max(bitmap.width, bitmap.height));
      const previewW = Math.max(1, Math.round(bitmap.width * scale));
      const previewH = Math.max(1, Math.round(bitmap.height * scale));
      const rgba = pixels(bitmap, previewW, previewH);
      preview = { rgba, width: previewW, height: previewH, scale: previewW / bitmap.width };
      const before = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), previewW, previewH));
      const res: WorkerResponse = { type: 'loaded', id: msg.id, before, width: bitmap.width, height: bitmap.height, previewW, previewH, profile };
      ctx.postMessage(res, [before]);
      return;
    }
    if (msg.type === 'render') {
      if (!preview) return;
      const t0 = performance.now();
      const img = rgbaToImage(preview.rgba, preview.width, preview.height);
      applySettings(img, msg.settings, { strength: msg.strength, pixelScale: preview.scale, seed: 7 });
      const rgba = imageToRgba(img, undefined, preview.rgba);
      const res: WorkerResponse = { type: 'frame', id: msg.id, rgba, width: img.width, height: img.height, ms: performance.now() - t0 };
      ctx.postMessage(res, [rgba.buffer]);
      return;
    }
    if (msg.type === 'export') {
      if (!full) throw new Error('No photo loaded.');
      const t0 = performance.now();
      const { width, height } = full;
      const src = pixels(full, width, height);
      const img = rgbaToImage(src, width, height);
      applySettings(img, msg.settings, { strength: msg.strength, pixelScale: 1, seed: 7 });
      const out = imageToRgba(img, src, src);
      const canvas = new OffscreenCanvas(width, height);
      const c = canvas.getContext('2d')!;
      c.putImageData(new ImageData(out, width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: msg.mime, quality: msg.quality });
      ctx.postMessage({ type: 'exported', id: msg.id, blob, ms: performance.now() - t0 } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: (err as Error).message || String(err) } satisfies WorkerResponse);
  }
};
