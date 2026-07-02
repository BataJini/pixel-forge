/**
 * src/platform/imageImport.ts — defensive PNG/image import (master-spec §3.8).
 *
 * Decodes an image file into a raw {@link PixelBuffer} for "new canvas" or "new
 * layer" import. Parsing is DEFENSIVE (constitution: validate imports at the
 * boundary with size/dimension caps): the 512×512 cap is enforced BEFORE any
 * pixel allocation, oversize/garbage input is rejected with a friendly error and
 * NO change to the caller's state, and nothing throws across the boundary — every
 * fallible path returns the client-only result envelope. Decoding uses
 * nearest-neighbor semantics only (no smoothing) so imported pixel art stays
 * crisp. The pure `validateImageDimensions` is unit-testable in Node; the DOM
 * decode is covered by a browser test.
 */
import { bufferFrom } from '../core/buffer';
import type { PixelBuffer, Result } from '../core/types';
import { err, ok } from '../core/types';

/** Hard canvas cap (constitution). Imports larger than this are rejected. */
export const MAX_IMPORT_DIM = 512;
/** Guard against pathological files before we even decode (defensive). */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Extensions/MIME accepted by the import picker. */
export const IMPORT_EXTENSIONS = ['.png', '.gif', '.jpg', '.jpeg', '.webp', '.bmp'] as const;
export const IMPORT_MIME_TYPES = [
  'image/png',
  'image/gif',
  'image/jpeg',
  'image/webp',
  'image/bmp',
];

/** Validate decoded dimensions against the 1..512 cap. Pure. */
export function validateImageDimensions(w: number, h: number): Result<{ w: number; h: number }> {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    return err('IMAGE_EMPTY', 'That image has no pixels to import.');
  }
  if (w > MAX_IMPORT_DIM || h > MAX_IMPORT_DIM) {
    return err(
      'IMAGE_TOO_LARGE',
      `That image is ${w}×${h}. PixelForge canvases are capped at ${MAX_IMPORT_DIM}×${MAX_IMPORT_DIM} — scale it down first.`,
    );
  }
  return ok({ w, h });
}

/** Read the intrinsic pixel size of an image bitmap/element. */
interface Sized {
  readonly width: number;
  readonly height: number;
}

/** Draw a decoded bitmap into a fresh, un-smoothed 2D context and read it back. */
function readBitmapPixels(bitmap: CanvasImageSource & Sized): Result<PixelBuffer> {
  const { width, height } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return err('IMAGE_DECODE', 'Could not read the image (no 2D canvas context).');
  }
  ctx.imageSmoothingEnabled = false; // pixel-correct: never interpolate (constitution)
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return ok(bufferFrom(width, height, new Uint8ClampedArray(data)));
}

/** Decode via the Image element (fallback where createImageBitmap is absent). */
function decodeViaImage(file: Blob): Promise<Result<PixelBuffer>> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      const dims = validateImageDimensions(w, h);
      if (!dims.ok) {
        resolve(dims);
        return;
      }
      resolve(readBitmapPixels(Object.assign(image, { width: w, height: h })));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(err('IMAGE_DECODE', 'That file could not be read as an image.'));
    };
    image.src = url;
  });
}

/**
 * Decode an image `Blob`/`File` into a {@link PixelBuffer}. Enforces the file
 * size + dimension caps, rejects unreadable input with a friendly message, and
 * never throws. The caller decides whether to open it as a new canvas or a new
 * layer; on any error the caller's current work is untouched.
 */
export async function decodeImageFile(file: Blob): Promise<Result<PixelBuffer>> {
  if (!(file instanceof Blob)) {
    return err('IMAGE_DECODE', 'No image file was provided.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return err('IMAGE_TOO_LARGE', 'That image file is too large to import.');
  }
  if (file.size === 0) {
    return err('IMAGE_EMPTY', 'That image file is empty.');
  }
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try {
        const dims = validateImageDimensions(bitmap.width, bitmap.height);
        if (!dims.ok) {
          return dims;
        }
        return readBitmapPixels(bitmap);
      } finally {
        bitmap.close();
      }
    }
    if (typeof Image !== 'undefined') {
      return await decodeViaImage(file);
    }
    return err('IMAGE_DECODE', 'Image import is not supported in this environment.');
  } catch {
    return err('IMAGE_DECODE', 'That file could not be read as an image.');
  }
}
