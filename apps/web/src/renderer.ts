import type { Settings } from '@looks/core';
import type { WorkerRequest, WorkerResponse } from './worker';

export const PREVIEW_MAX = 1600;

interface Frame {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  ms: number;
}

export interface Loaded {
  before: ImageBitmap;
  width: number;
  height: number;
  previewW: number;
  previewH: number;
  /** Colour profile converted to sRGB while decoding (HEIC only). */
  profile?: string;
}

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

/**
 * Talks to the image worker. Preview renders are "latest wins": while one is
 * running, only the newest request is kept, so dragging a slider stays smooth.
 */
export class Renderer {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private busy = false;
  private queued: { settings: Settings; strength: number } | null = null;
  private exports = new Map<number, Pending<Blob>>();
  private loads = new Map<number, Pending<Loaded>>();

  constructor(private onFrame: (f: Frame) => void, private onError: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.onError(e.message || 'The image worker crashed.');
  }

  private handle(msg: WorkerResponse): void {
    if (msg.type === 'loaded') {
      const { id, type, ...loaded } = msg;
      void type;
      this.loads.get(id)?.resolve(loaded);
      this.loads.delete(id);
    } else if (msg.type === 'frame') {
      this.busy = false;
      this.onFrame(msg);
      this.flush();
    } else if (msg.type === 'exported') {
      this.exports.get(msg.id)?.resolve(msg.blob);
      this.exports.delete(msg.id);
    } else if (msg.type === 'error') {
      const pending = msg.id !== undefined ? (this.exports.get(msg.id) ?? this.loads.get(msg.id)) : undefined;
      if (pending) {
        pending.reject(new Error(msg.message));
        this.exports.delete(msg.id!);
        this.loads.delete(msg.id!);
      } else {
        this.busy = false;
        this.onError(msg.message);
        this.flush();
      }
    }
  }

  /** Hands a decoded bitmap, or raw HEIC/HEIF bytes, to the worker. */
  load(source: ImageBitmap | ArrayBuffer): Promise<Loaded> {
    const id = this.nextId++;
    this.busy = false;
    this.queued = null;
    return new Promise<Loaded>((resolve, reject) => {
      this.loads.set(id, { resolve, reject });
      const msg: WorkerRequest = { type: 'load', id, source, maxPreview: PREVIEW_MAX };
      this.worker.postMessage(msg, [source]);
    });
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
