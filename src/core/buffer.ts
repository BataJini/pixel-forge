/**
 * src/core/buffer.ts — pure pixel-buffer engine (master-spec §5).
 *
 * PURE and deterministic (no DOM). Two contracts coexist:
 *   - Immutable ops (`setPixel`) return a NEW buffer and never touch the input —
 *     these are the tested public contract.
 *   - A bounded in-place mutation API (`setPixelMut`, `fillRectMut`) exists for
 *     the render/tool hot path; the constitution permits mutating the per-layer
 *     working `Uint8ClampedArray` ONLY through this module, always tracking the
 *     dirty rect so history can capture an immutable before/after patch.
 *
 * Coordinate system: integer pixels, origin top-left, x right, y down.
 * Out-of-bounds reads return transparent; OOB writes are no-ops (never errors).
 */
import { clampRect, isEmptyRect, makeRect } from './rect';
import type { Layer, PixelBuffer, Rect, RGBA } from './types';

const CHANNELS = 4;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

function index(buf: PixelBuffer, x: number, y: number): number {
  return (y * buf.w + x) * CHANNELS;
}

function inBounds(buf: PixelBuffer, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < buf.w && y < buf.h;
}

/** A fully transparent `w × h` buffer (`[0,0,0,0]` per pixel). */
export function createBuffer(w: number, h: number): PixelBuffer {
  const width = Math.max(0, Math.trunc(w));
  const height = Math.max(0, Math.trunc(h));
  return { w: width, h: height, data: new Uint8ClampedArray(width * height * CHANNELS) };
}

/** Deep copy of a buffer (independent backing array). */
export function cloneBuffer(buf: PixelBuffer): PixelBuffer {
  return { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
}

/** Wrap an existing byte array as a buffer without copying (caller owns it). */
export function bufferFrom(w: number, h: number, data: Uint8ClampedArray): PixelBuffer {
  return { w, h, data };
}

/** Read a pixel. Out-of-bounds returns transparent `[0,0,0,0]`. */
export function getPixel(buf: PixelBuffer, x: number, y: number): RGBA {
  if (!inBounds(buf, x, y)) {
    return [...TRANSPARENT];
  }
  const i = index(buf, x, y);
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

/**
 * Immutable set: returns a NEW buffer with pixel (x, y) = c. The input is never
 * modified. An out-of-bounds write is a no-op that returns the input unchanged.
 */
export function setPixel(buf: PixelBuffer, x: number, y: number, c: RGBA): PixelBuffer {
  if (!inBounds(buf, x, y)) {
    return buf;
  }
  const next = cloneBuffer(buf);
  const i = index(next, x, y);
  next.data[i] = c[0];
  next.data[i + 1] = c[1];
  next.data[i + 2] = c[2];
  next.data[i + 3] = c[3];
  return next;
}

/**
 * In-place set for the working-buffer hot path. Mutates `buf.data` and returns
 * `true` iff the pixel actually changed. OOB is a no-op returning `false`.
 */
export function setPixelMut(buf: PixelBuffer, x: number, y: number, c: RGBA): boolean {
  if (!inBounds(buf, x, y)) {
    return false;
  }
  const i = index(buf, x, y);
  const d = buf.data;
  if (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2] && d[i + 3] === c[3]) {
    return false;
  }
  d[i] = c[0];
  d[i + 1] = c[1];
  d[i + 2] = c[2];
  d[i + 3] = c[3];
  return true;
}

/**
 * In-place fill of `rect` with color `c`, clamped to the buffer. Returns the
 * clamped dirty rect actually written, or `null` when nothing was in bounds.
 */
export function fillRectMut(buf: PixelBuffer, rect: Rect, c: RGBA): Rect | null {
  const area = clampRect(rect, buf.w, buf.h);
  if (isEmptyRect(area)) {
    return null;
  }
  const d = buf.data;
  for (let y = area.y; y < area.y + area.h; y++) {
    let i = (y * buf.w + area.x) * CHANNELS;
    for (let x = 0; x < area.w; x++) {
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c[3];
      i += CHANNELS;
    }
  }
  return area;
}

/** Source-over compositing of one source pixel (with effective alpha) onto dst. */
function overPixel(
  dst: Uint8ClampedArray,
  di: number,
  src: Uint8ClampedArray,
  si: number,
  srcA: number,
): void {
  const dstA = dst[di + 3];
  const inv = 1 - srcA / 255;
  const outA = srcA + dstA * inv;
  if (outA <= 0) {
    dst[di] = 0;
    dst[di + 1] = 0;
    dst[di + 2] = 0;
    dst[di + 3] = 0;
    return;
  }
  for (let ch = 0; ch < 3; ch++) {
    const blended = (src[si + ch] * srcA + dst[di + ch] * dstA * inv) / outA;
    dst[di + ch] = Math.round(blended);
  }
  dst[di + 3] = Math.round(outA);
}

/**
 * Flatten layers bottom-to-top into a new buffer via source-over compositing.
 * Hidden layers and zero-opacity layers are skipped; `opacity` (0–100) scales
 * each layer's source alpha. All layers are assumed to share the canvas size;
 * a layer smaller/larger than the base is composited over its overlapping area.
 */
export function composite(layers: Layer[]): PixelBuffer {
  if (layers.length === 0) {
    return createBuffer(0, 0);
  }
  const { w, h } = layers[0].buffer;
  const out = createBuffer(w, h);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) {
      continue;
    }
    const src = layer.buffer;
    if (src.w !== w || src.h !== h) {
      continue;
    }
    const opacity = Math.min(100, layer.opacity) / 100;
    const sd = src.data;
    const od = out.data;
    for (let p = 0; p < w * h; p++) {
      const i = p * CHANNELS;
      const srcA = sd[i + 3] * opacity;
      if (srcA <= 0) {
        continue;
      }
      overPixel(od, i, sd, i, srcA);
    }
  }
  return out;
}

/** A view of a buffer's pixels as 32-bit words when 4-byte aligned, else null. */
function asWords(buf: PixelBuffer, count: number): Uint32Array | null {
  if (buf.data.byteOffset % CHANNELS !== 0) {
    return null;
  }
  return new Uint32Array(buf.data.buffer, buf.data.byteOffset, count);
}

/** Whether pixel `p` differs between two byte arrays (word view preferred). */
function pixelDiffers(
  aWords: Uint32Array | null,
  bWords: Uint32Array | null,
  ad: Uint8ClampedArray,
  bd: Uint8ClampedArray,
  p: number,
): boolean {
  if (aWords && bWords) {
    return aWords[p] !== bWords[p];
  }
  const i = p * CHANNELS;
  return (
    ad[i] !== bd[i] || ad[i + 1] !== bd[i + 1] || ad[i + 2] !== bd[i + 2] || ad[i + 3] !== bd[i + 3]
  );
}

/**
 * Bounding box of pixels that differ between two same-size buffers, or `null`
 * when identical. Buffers of different size report the whole `after` as dirty.
 * Compares all four channels (32 bits at a time when the backing is aligned).
 */
export function dirtyRect(before: PixelBuffer, after: PixelBuffer): Rect | null {
  if (before.w !== after.w || before.h !== after.h) {
    return after.w > 0 && after.h > 0 ? makeRect(0, 0, after.w, after.h) : null;
  }
  const w = after.w;
  const h = after.h;
  const count = w * h;
  const aWords = asWords(before, count);
  const bWords = asWords(after, count);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (pixelDiffers(aWords, bWords, before.data, after.data, row + x)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return makeRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** True when two buffers have equal size and identical bytes. */
export function buffersEqual(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) {
      return false;
    }
  }
  return true;
}
