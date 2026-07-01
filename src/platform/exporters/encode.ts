/**
 * src/platform/exporters/encode.ts — browser glue that turns a composited pixel
 * buffer into a downloadable PNG/SVG blob (master-spec §3.8).
 *
 * All pixel logic is delegated to the PURE core exporters (`src/core/exporters`):
 * this layer only touches the DOM/canvas to produce a `Blob`. Because the input
 * is a composited buffer — never the on-screen canvas — the output is
 * structurally effect-free: no transparency checkerboard, no CRT scanlines/glow
 * can leak in (constitution: clean-export invariant).
 */
import { bufferToSvg, flattenOnColor, type SvgOptions, scaleToCanvas } from '../../core/exporters';
import type { PixelBuffer, RGBA } from '../../core/types';

const PNG_MIME = 'image/png';
const SVG_MIME = 'image/svg+xml';

export interface PngEncodeOptions {
  /** Integer nearest-neighbor scale factor (1–32). */
  readonly scale: number;
  /** Opaque matte to flatten onto, or `null`/omitted for a transparent PNG. */
  readonly matte?: RGBA | null;
}

/**
 * Encode a composited buffer to a nearest-neighbor PNG blob. With a `matte` the
 * art is flattened onto that opaque color; otherwise transparency is preserved.
 */
export async function bufferToPngBlob(
  buf: PixelBuffer,
  { scale, matte }: PngEncodeOptions,
): Promise<Blob> {
  const flattened = matte ? flattenOnColor(buf, matte) : buf;
  const canvas = scaleToCanvas(flattened, scale);
  return await canvas.convertToBlob({ type: PNG_MIME });
}

/** Encode a composited buffer to a crisp, rect-merged SVG blob. */
export function bufferToSvgBlob(buf: PixelBuffer, opts?: SvgOptions): Blob {
  return new Blob([bufferToSvg(buf, opts)], { type: SVG_MIME });
}
