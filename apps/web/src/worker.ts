/// <reference lib="webworker" />
import { applySettings, imageToRgba, rgbaToImage, type Settings } from '@looks/core';

export type WorkerRequest =
  | { type: 'load'; bitmap: ImageBitmap; previewW: number; previewH: number }
  | { type: 'render'; id: number; settings: Settings; strength: number }
  | { type: 'export'; id: number; settings: Settings; strength: number; mime: string; quality: number };

export type WorkerResponse =
  | { type: 'loaded'; before: ImageBitmap }
  | { type: 'frame'; id: number; rgba: Uint8ClampedArray; width: number; height: number; ms: number }
  | { type: 'exported'; id: number; blob: Blob; ms: number }
  | { type: 'error'; id?: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let full: ImageBitmap | null = null;
let preview: { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; scale: number } | null = null;

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
      full?.close();
      full = msg.bitmap;
      const rgba = pixels(full, msg.previewW, msg.previewH);
      preview = { rgba, width: msg.previewW, height: msg.previewH, scale: msg.previewW / full.width };
      const before = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), msg.previewW, msg.previewH));
      ctx.postMessage({ type: 'loaded', before } satisfies WorkerResponse, [before]);
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
    const id = 'id' in msg ? msg.id : undefined;
    ctx.postMessage({ type: 'error', id, message: (err as Error).message || String(err) } satisfies WorkerResponse);
  }
};
