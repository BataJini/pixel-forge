/**
 * src/platform/exporters/gifWorker.ts — the GIF-encoding Web Worker (master-spec
 * §3.8, §6). It runs the PURE core encoder (`src/core/exporters/gif`) off the main
 * thread so a 512×512 × many-frame encode never freezes the UI. Frame buffers are
 * transferred in (zero-copy) and the finished GIF bytes are transferred back out;
 * progress is streamed as each frame is written.
 *
 * Because the encoder only ever sees composited pixel buffers, the GIF is
 * structurally effect-free — no checkerboard, no CRT (constitution: clean-export).
 */
import { encodeGif, type GifCel } from '../../core/exporters/gif';

/** A frame as it crosses the worker boundary (raw RGBA bytes + geometry + delay). */
export interface GifWorkerFrame {
  readonly buffer: ArrayBuffer;
  readonly w: number;
  readonly h: number;
  readonly delayMs: number;
}

/** Encode options that survive structured-clone (no functions). */
export interface GifWorkerOptions {
  readonly scale?: number;
  readonly loop?: number;
  readonly fps?: number;
  readonly maxColors?: number;
  readonly alphaThreshold?: number;
}

/** Request posted to the worker. */
export interface GifWorkerRequest {
  readonly type: 'encode';
  readonly frames: GifWorkerFrame[];
  readonly options: GifWorkerOptions;
}

/** Responses posted back from the worker. */
export type GifWorkerResponse =
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'done'; readonly bytes: ArrayBuffer }
  | { readonly type: 'error'; readonly message: string };

/** Minimal dedicated-worker surface (avoids DOM/WebWorker lib conflicts). */
interface WorkerScope {
  postMessage(message: GifWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<GifWorkerRequest>) => void): void;
}

/** Run one encode request and post progress + result (or an error) back. */
export function handleGifRequest(scope: WorkerScope, req: GifWorkerRequest): void {
  try {
    const cels: GifCel[] = req.frames.map((f) => ({
      buffer: { w: f.w, h: f.h, data: new Uint8ClampedArray(f.buffer) },
      delayMs: f.delayMs,
    }));
    const bytes = encodeGif(cels, {
      ...req.options,
      onProgress: (done, total) => scope.postMessage({ type: 'progress', done, total }),
    });
    // Copy into a standalone ArrayBuffer we can safely transfer.
    const out = bytes.slice();
    scope.postMessage({ type: 'done', bytes: out.buffer }, [out.buffer]);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'GIF encoding failed.';
    scope.postMessage({ type: 'error', message });
  }
}

const scope = self as unknown as WorkerScope;
scope.addEventListener('message', (ev) => handleGifRequest(scope, ev.data));
