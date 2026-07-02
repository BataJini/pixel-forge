/**
 * src/platform/exporters — high-level "encode + save" export actions for the UI
 * (master-spec §3.8). Each action takes a COMPOSITED pixel buffer (the caller
 * flattens layers via `core.composite`), encodes it with the pure core
 * exporters, and streams it to disk via `browser-fs-access`.
 *
 * Every fallible step returns the client-only result envelope so the UI can show
 * a friendly, actionable message and never loses the user's work.
 */
import type { SvgOptions } from '../../core/exporters';
import type { PixelBuffer } from '../../core/types';
import { err, type Result, type RGBA } from '../../core/types';
import { bufferToPngBlob, bufferToSvgBlob } from './encode';
import { type SaveOutcome, sanitizeFileName, saveBlob, withExtension } from './save';

export { bufferToPngBlob, bufferToSvgBlob, type PngEncodeOptions } from './encode';
export {
  type EncodeGifOptions,
  type ExportGifRequest,
  encodeGifInWorker,
  exportGifFile,
  type GifProgress,
} from './gif';
export {
  fileSaveSupported,
  type SaveOptions,
  type SaveOutcome,
  sanitizeFileName,
  saveBlob,
  withExtension,
} from './save';
export {
  buildSpritesheet,
  type ExportSpritesheetRequest,
  exportSpritesheetFile,
} from './spritesheet';

/** PNG export scales offered by the dialog (master-spec §3.8). */
export const PNG_SCALES = [1, 2, 4, 8, 16, 32] as const;
export type PngScale = (typeof PNG_SCALES)[number];

export interface ExportPngRequest {
  readonly scale: number;
  /** Opaque matte to flatten onto, or `null` for a transparent PNG. */
  readonly matte?: RGBA | null;
  /** Base name (with or without extension); sanitized before use. */
  readonly fileName: string;
}

export interface ExportSvgRequest {
  readonly merge?: boolean;
  readonly fileName: string;
}

/** Render a composited buffer to a nearest-neighbor PNG and prompt to save it. */
export async function exportPngFile(
  buf: PixelBuffer,
  req: ExportPngRequest,
): Promise<Result<SaveOutcome>> {
  let blob: Blob;
  try {
    blob = await bufferToPngBlob(buf, { scale: req.scale, matte: req.matte ?? null });
  } catch {
    return err('EXPORT_ENCODE_FAILED', 'Could not render the PNG. Try a smaller scale.');
  }
  const fileName = withExtension(sanitizeFileName(req.fileName), 'png');
  return await saveBlob(blob, { fileName, extensions: ['.png'], mimeTypes: ['image/png'] });
}

/** Encode a composited buffer to a crisp rect-merged SVG and prompt to save it. */
export async function exportSvgFile(
  buf: PixelBuffer,
  req: ExportSvgRequest,
): Promise<Result<SaveOutcome>> {
  const opts: SvgOptions = { merge: req.merge ?? true };
  let blob: Blob;
  try {
    blob = bufferToSvgBlob(buf, opts);
  } catch {
    return err('EXPORT_ENCODE_FAILED', 'Could not build the SVG.');
  }
  const fileName = withExtension(sanitizeFileName(req.fileName), 'svg');
  return await saveBlob(blob, { fileName, extensions: ['.svg'], mimeTypes: ['image/svg+xml'] });
}
