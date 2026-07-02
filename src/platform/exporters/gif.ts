/**
 * src/platform/exporters/gif.ts — "encode + save" GIF export for the UI (master-spec
 * §3.8, §6). Encoding runs in a Web Worker (`gifWorker.ts`) so the UI stays
 * responsive even for a 512×512 × many-frame animation; if a Worker is unavailable
 * (Node/tests/SSR) or fails, it transparently falls back to a main-thread encode so
 * the download still succeeds.
 *
 * Frame buffers are COPIED before they are transferred to the worker, so the app's
 * live/cached composited buffers are never detached. The bytes come from composited
 * pixels, so the GIF is effect-free (constitution: clean-export invariant).
 */
import { encodeGif, type GifCel } from '../../core/exporters/gif';
import { err, type Result } from '../../core/types';
import type { GifWorkerFrame, GifWorkerOptions, GifWorkerResponse } from './gifWorker';
import { type SaveOutcome, sanitizeFileName, saveBlob, withExtension } from './save';

const GIF_MIME = 'image/gif';

/** Progress reporter fired as frames are encoded. */
export type GifProgress = (done: number, total: number) => void;

export interface EncodeGifOptions extends GifWorkerOptions {
  /** Optional per-frame progress callback (stripped before crossing the worker). */
  readonly onProgress?: GifProgress;
}

function toWorkerOptions(opts: EncodeGifOptions): GifWorkerOptions {
  return {
    scale: opts.scale,
    loop: opts.loop,
    fps: opts.fps,
    maxColors: opts.maxColors,
    alphaThreshold: opts.alphaThreshold,
  };
}

/** Construct the encoding worker, or `null` where Workers are unavailable. */
function createGifWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    return new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Copy each cel into a transfer-safe frame (own ArrayBuffer; originals untouched). */
function toTransferFrames(cels: readonly GifCel[]): GifWorkerFrame[] {
  return cels.map((cel) => {
    const copy = cel.buffer.data.slice();
    return { buffer: copy.buffer, w: cel.buffer.w, h: cel.buffer.h, delayMs: cel.delayMs };
  });
}

function encodeOnMainThread(cels: readonly GifCel[], opts: EncodeGifOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      resolve(encodeGif(cels, { ...toWorkerOptions(opts), onProgress: opts.onProgress }));
    } catch (e) {
      reject(e instanceof Error ? e : new Error('GIF encoding failed.'));
    }
  });
}

function runWorker(
  worker: Worker,
  cels: readonly GifCel[],
  opts: EncodeGifOptions,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const frames = toTransferFrames(cels);
    worker.onmessage = (ev: MessageEvent<GifWorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        opts.onProgress?.(msg.done, msg.total);
      } else if (msg.type === 'done') {
        resolve(new Uint8Array(msg.bytes));
      } else {
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'GIF worker failed.'));
    worker.postMessage(
      { type: 'encode', frames, options: toWorkerOptions(opts) },
      frames.map((f) => f.buffer),
    );
  });
}

/**
 * Encode cels to GIF bytes, preferring a Web Worker and falling back to a
 * main-thread encode on any failure (buffers are copied, never detached, so the
 * fallback can re-read them).
 */
export async function encodeGifInWorker(
  cels: readonly GifCel[],
  opts: EncodeGifOptions = {},
): Promise<Uint8Array> {
  const worker = createGifWorker();
  if (!worker) {
    return encodeOnMainThread(cels, opts);
  }
  try {
    return await runWorker(worker, cels, opts);
  } catch {
    return encodeOnMainThread(cels, opts);
  } finally {
    worker.terminate();
  }
}

export interface ExportGifRequest {
  /** Integer nearest-neighbor scale (default 1). */
  readonly scale?: number;
  /** Loop count: `0` = forever (default), `-1` = once, `n` = n repeats. */
  readonly loop?: number;
  /** Fallback FPS when a cel has no positive delay. */
  readonly fps?: number;
  /** Base name (with or without extension); sanitized before use. */
  readonly fileName: string;
  /** Progress callback for the export toast. */
  readonly onProgress?: GifProgress;
}

/** Encode composited cels to an animated GIF (in a worker) and prompt to save it. */
export async function exportGifFile(
  cels: readonly GifCel[],
  req: ExportGifRequest,
): Promise<Result<SaveOutcome>> {
  if (cels.length === 0) {
    return err('EXPORT_NO_FRAMES', 'Nothing to export yet — draw something first.');
  }
  let bytes: Uint8Array;
  try {
    bytes = await encodeGifInWorker(cels, {
      scale: req.scale,
      loop: req.loop,
      fps: req.fps,
      onProgress: req.onProgress,
    });
  } catch {
    return err(
      'EXPORT_ENCODE_FAILED',
      'Could not encode the GIF. Try fewer frames or a smaller scale.',
    );
  }
  // Copy into a standalone ArrayBuffer so the Blob part is a concrete `ArrayBuffer`
  // (a `Uint8Array` may be backed by a `SharedArrayBuffer`, which `BlobPart` rejects).
  const bin = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bin).set(bytes);
  const blob = new Blob([bin], { type: GIF_MIME });
  const fileName = withExtension(sanitizeFileName(req.fileName), 'gif');
  return await saveBlob(blob, { fileName, extensions: ['.gif'], mimeTypes: [GIF_MIME] });
}
