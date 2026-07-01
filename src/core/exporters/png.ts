/**
 * src/core/exporters/png.ts — nearest-neighbor PNG scaling (master-spec §5, §3.8).
 *
 * The pixel math is PURE and deterministic (`scaleBufferNearest`,
 * `flattenOnColor`) so it is unit-testable in Node with no DOM. `scaleToCanvas`
 * is the single, spec-mandated DOM boundary (§5 names its `OffscreenCanvas`
 * return type at this exact path): it defers all pixel work to the pure scaler
 * and only wraps the result in a canvas for `toBlob`/download.
 *
 * Every scale path is integer nearest-neighbor — a source pixel becomes an exact
 * `scale × scale` block, so NO intermediate colors are ever introduced
 * (constitution: pixel-correctness). The input is a composited buffer, never the
 * screen, so output is effect-free (no checkerboard / CRT leak).
 */
import { createBuffer } from '../buffer';
import type { PixelBuffer, RGBA } from '../types';

const CHANNELS = 4;
const OPAQUE = 255;

/** Assert `scale` is usable as an integer upscale factor (programmer error). */
function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`scale must be a positive integer, received ${scale}.`);
  }
}

/**
 * Integer nearest-neighbor upscale: every source pixel becomes a solid
 * `scale × scale` block. Returns a NEW `w*scale × h*scale` buffer; the input is
 * never mutated. Introduces no new colors (pure block replication).
 */
export function scaleBufferNearest(buf: PixelBuffer, scale: number): PixelBuffer {
  assertScale(scale);
  if (scale === 1) {
    return { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
  }
  const outW = buf.w * scale;
  const outH = buf.h * scale;
  const out = createBuffer(outW, outH);
  const src = buf.data;
  const dst = out.data;
  for (let sy = 0; sy < buf.h; sy++) {
    for (let sx = 0; sx < buf.w; sx++) {
      const si = (sy * buf.w + sx) * CHANNELS;
      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const a = src[si + 3];
      for (let by = 0; by < scale; by++) {
        let di = ((sy * scale + by) * outW + sx * scale) * CHANNELS;
        for (let bx = 0; bx < scale; bx++) {
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = a;
          di += CHANNELS;
        }
      }
    }
  }
  return out;
}

/**
 * Flatten a buffer onto an opaque matte color (source-over). The matte's alpha
 * is ignored (the background is always fully opaque), so every output pixel is
 * opaque — used for "matte background" PNG export. Returns a NEW buffer.
 */
export function flattenOnColor(buf: PixelBuffer, matte: RGBA): PixelBuffer {
  const out = createBuffer(buf.w, buf.h);
  const src = buf.data;
  const dst = out.data;
  const [mr, mg, mb] = matte;
  for (let i = 0; i < src.length; i += CHANNELS) {
    const a = src[i + 3] / OPAQUE;
    const inv = 1 - a;
    dst[i] = Math.round(src[i] * a + mr * inv);
    dst[i + 1] = Math.round(src[i + 1] * a + mg * inv);
    dst[i + 2] = Math.round(src[i + 2] * a + mb * inv);
    dst[i + 3] = OPAQUE;
  }
  return out;
}

/**
 * Scale a buffer nearest-neighbor and return it as an `OffscreenCanvas` of
 * `w*scale × h*scale` px, ready for `convertToBlob`/`toBlob`. This is the one
 * DOM-touching export helper (spec §5); the pixels come from the pure
 * {@link scaleBufferNearest}. Throws a clear error where the canvas APIs are
 * unavailable (e.g. plain Node) or the buffer is empty.
 */
export function scaleToCanvas(buf: PixelBuffer, scale: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined' || typeof ImageData === 'undefined') {
    throw new Error('OffscreenCanvas/ImageData are unavailable in this environment.');
  }
  const scaled = scaleBufferNearest(buf, scale);
  if (scaled.w <= 0 || scaled.h <= 0) {
    throw new RangeError('Cannot rasterize an empty buffer to a canvas.');
  }
  const canvas = new OffscreenCanvas(scaled.w, scaled.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire a 2D context for PNG export.');
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(scaled.data), scaled.w, scaled.h), 0, 0);
  return canvas;
}
