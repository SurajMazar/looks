import type { Settings } from '@looks/core';
import type { WorkerRequest, WorkerResponse } from './worker';

export const PREVIEW_MAX = 1600;

interface Frame {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  ms: number;
}

/**
 * Talks to the image worker. Preview renders are "latest wins": while one is
 * running, only the newest request is kept, so dragging a slider stays smooth.
 */
export class Renderer {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private busy = false;
  private queued: { settings: Settings; strength: number } | null = null;
  private exports = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
  private onLoaded: ((before: ImageBitmap) => void) | null = null;

  constructor(private onFrame: (f: Frame) => void, private onError: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.onError(e.message || 'The image worker crashed.');
  }

  private handle(msg: WorkerResponse): void {
    if (msg.type === 'loaded') {
      this.onLoaded?.(msg.before);
      this.onLoaded = null;
    } else if (msg.type === 'frame') {
      this.busy = false;
      this.onFrame(msg);
      this.flush();
    } else if (msg.type === 'exported') {
      this.exports.get(msg.id)?.resolve(msg.blob);
      this.exports.delete(msg.id);
    } else if (msg.type === 'error') {
      const pending = msg.id !== undefined ? this.exports.get(msg.id) : undefined;
      if (pending) {
        pending.reject(new Error(msg.message));
        this.exports.delete(msg.id!);
      } else {
        this.busy = false;
        this.onError(msg.message);
        this.flush();
      }
    }
  }

  /** Hands the photo to the worker. Resolves with the unedited preview bitmap. */
  async load(source: ImageBitmap): Promise<{ before: ImageBitmap; width: number; height: number; scale: number }> {
    const scale = Math.min(1, PREVIEW_MAX / Math.max(source.width, source.height));
    const previewW = Math.max(1, Math.round(source.width * scale));
    const previewH = Math.max(1, Math.round(source.height * scale));
    const before = await new Promise<ImageBitmap>((resolve) => {
      this.onLoaded = resolve;
      const msg: WorkerRequest = { type: 'load', bitmap: source, previewW, previewH };
      this.worker.postMessage(msg, [source]);
    });
    this.busy = false;
    this.queued = null;
    return { before, width: previewW, height: previewH, scale };
  }

  render(settings: Settings, strength: number): void {
    this.queued = { settings, strength };
    this.flush();
  }

  private flush(): void {
    if (this.busy || !this.queued) return;
    const { settings, strength } = this.queued;
    this.queued = null;
    this.busy = true;
    const msg: WorkerRequest = { type: 'render', id: this.nextId++, settings, strength };
    this.worker.postMessage(msg);
  }

  exportFull(settings: Settings, strength: number, mime = 'image/jpeg', quality = 0.92): Promise<Blob> {
    const id = this.nextId++;
    return new Promise<Blob>((resolve, reject) => {
      this.exports.set(id, { resolve, reject });
      const msg: WorkerRequest = { type: 'export', id, settings, strength, mime, quality };
      this.worker.postMessage(msg);
    });
  }
}
