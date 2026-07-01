/**
 * src/platform/files.ts — minimal browser file glue for palette import/export.
 *
 * Kept tiny and defensive; richer File System Access / browser-fs-access flows
 * for images and `.forge` projects arrive with U-009/U-011. All DOM access is
 * guarded so nothing throws in a non-DOM (unit-test) context.
 */
import type { PaletteFormat } from '../core/palette';

/** Trigger a client-side download of `text` as `filename` (best-effort). */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a `File`/`Blob` as UTF-8 text. Rejects on read error. */
export function readTextFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'));
    reader.readAsText(file);
  });
}

/** Infer a palette import format from a filename extension (defaults to hex). */
export function paletteFormatFromFilename(name: string): PaletteFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gpl')) {
    return 'gpl';
  }
  if (lower.endsWith('.pal')) {
    return 'pal';
  }
  return 'hex';
}
