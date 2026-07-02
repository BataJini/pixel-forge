/**
 * src/platform/thumbnail.ts — a small PNG data-URL thumbnail of a composited
 * buffer, for the gallery list and `.forge` `thumbnailDataUrl` (master-spec
 * §4.3). Reads the COMPOSITED pixels — never the on-screen canvas — so the CRT
 * layer and transparency checker never leak in (constitution: clean-export). DOM
 * only; returns `null` in a non-DOM context so callers stay side-effect free.
 */
import type { PixelBuffer } from '../core/types';

const DEFAULT_MAX = 96;

/**
 * Render `buffer` to a nearest-neighbor PNG data URL fitting within
 * `maxSize × maxSize` (aspect preserved). Returns `null` when there is no DOM
 * canvas or the buffer is empty.
 */
export function renderThumbnail(buffer: PixelBuffer, maxSize = DEFAULT_MAX): string | null {
  if (typeof document === 'undefined' || buffer.w <= 0 || buffer.h <= 0) {
    return null;
  }
  const src = document.createElement('canvas');
  src.width = buffer.w;
  src.height = buffer.h;
  const sctx = src.getContext('2d');
  if (!sctx) {
    return null;
  }
  sctx.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.w, buffer.h), 0, 0);

  const scale = Math.min(maxSize / buffer.w, maxSize / buffer.h);
  const outW = Math.max(1, Math.round(buffer.w * scale));
  const outH = Math.max(1, Math.round(buffer.h * scale));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) {
    return null;
  }
  octx.imageSmoothingEnabled = false; // crisp pixels, never interpolated
  octx.drawImage(src, 0, 0, outW, outH);
  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}
