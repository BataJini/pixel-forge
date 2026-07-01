/**
 * src/platform/exporters/save.ts — download a blob via the File System Access
 * API with an automatic blob-download fallback (ADR-001, master-spec §3.8).
 *
 * `browser-fs-access` shows a native "Save As" picker where supported and falls
 * back to an `<a download>` blob URL elsewhere, so exports work on every target
 * browser. Expected failures (user cancels the picker) return the client-only
 * result envelope rather than throwing (constitution).
 */
import { fileSave, supported } from 'browser-fs-access';
import { err, ok, type Result } from '../../core/types';

/** Whether the native File System Access "Save As" picker is available. */
export const fileSaveSupported: boolean = supported;

export type SaveOutcome = 'saved' | 'cancelled';

export interface SaveOptions {
  /** Suggested file name including extension, e.g. `sprite.png`. */
  readonly fileName: string;
  /** Acceptable extensions, dot-prefixed (e.g. `['.png']`). */
  readonly extensions: string[];
  /** Acceptable MIME types (e.g. `['image/png']`). */
  readonly mimeTypes?: string[];
  /** Human description shown in the picker. */
  readonly description?: string;
}

/** Path-unsafe characters and whitespace collapsed to a single separator. */
const INVALID_FILENAME_CHARS = /[\s\\/:*?"<>|-]+/g;
const TRIM_DOTS_SPACES = /^[.\s]+|[.\s]+$/g;

/** Turn an arbitrary title into a safe file base name (no extension). */
export function sanitizeFileName(name: string, fallback = 'sprite'): string {
  const cleaned = name
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(TRIM_DOTS_SPACES, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Ensure `base` ends with exactly one `.ext` (case-insensitive). */
export function withExtension(base: string, ext: string): string {
  const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
  return base.toLowerCase().endsWith(dotExt.toLowerCase()) ? base : `${base}${dotExt}`;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

/**
 * Save `blob` to disk. Returns `'saved'` on success, `'cancelled'` when the user
 * dismisses the picker, or a friendly error result on genuine failure.
 */
export async function saveBlob(blob: Blob, opts: SaveOptions): Promise<Result<SaveOutcome>> {
  try {
    await fileSave(blob, {
      fileName: opts.fileName,
      extensions: opts.extensions,
      mimeTypes: opts.mimeTypes,
      description: opts.description,
    });
    return ok('saved');
  } catch (e) {
    if (isAbort(e)) {
      return ok('cancelled');
    }
    return err('EXPORT_SAVE_FAILED', 'Could not save the file. Please try again.');
  }
}
