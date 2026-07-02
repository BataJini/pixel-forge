/**
 * src/platform/projectFile.ts — export/open the native `.forge` project FILE via
 * the File System Access API with a blob/`<input>` fallback (`browser-fs-access`,
 * ADR-001). Complements IndexedDB persistence (persistence.ts) with an on-disk
 * interchange format (master-spec §3.8 "Export Project (.forge)"). Serialize /
 * deserialize stay in the pure core; this layer only moves the text to/from a
 * file. Expected failures (user cancels) return the result envelope, never throw.
 */
import { deserialize, FORGE_MIME, serialize } from '../core/project';
import type { Project, Result } from '../core/types';
import { err, ok } from '../core/types';
import { type SaveOutcome, sanitizeFileName, saveBlob, withExtension } from './exporters/save';

const FORGE_EXT = '.forge';

/** Save a project as a `.forge` file (JSON). Cancel → `'cancelled'`. */
export async function exportProjectFile(
  project: Project,
  fileName = project.name,
): Promise<Result<SaveOutcome>> {
  const blob = new Blob([serialize(project)], { type: `${FORGE_MIME};charset=utf-8` });
  const base = withExtension(sanitizeFileName(fileName, 'project'), FORGE_EXT);
  return saveBlob(blob, {
    fileName: base,
    extensions: [FORGE_EXT],
    mimeTypes: [FORGE_MIME],
    description: 'PixelForge project',
  });
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

/**
 * Open a `.forge` file from disk and validate it. Returns the parsed project,
 * `null` when the user cancels the picker, or a friendly error on a malformed
 * file (the current document is never touched by a failed open).
 */
export async function openProjectFile(): Promise<Result<Project | null>> {
  let file: File;
  try {
    // Lazy import so the platform barrel does not statically pull `fileOpen` into
    // every consumer's module graph (keeps unrelated mocks/tests unaffected).
    const { fileOpen } = await import('browser-fs-access');
    file = await fileOpen({
      extensions: [FORGE_EXT],
      mimeTypes: [FORGE_MIME],
      description: 'PixelForge project',
    });
  } catch (e) {
    if (isAbort(e)) {
      return ok(null);
    }
    return err('PROJECT_OPEN', 'Could not open that file.');
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return err('PROJECT_OPEN', 'Could not read that file.');
  }
  const parsed = deserialize(text);
  return parsed.ok ? ok(parsed.value) : { ok: false, error: parsed.error };
}
