/**
 * src/platform/exporters/spritesheet.ts — "pack + save" spritesheet export for the
 * UI (master-spec §3.8). Packs composited cels into an atlas (`core/exporters/
 * spritesheet`), renders the atlas to a nearest-neighbor PNG, and saves the PNG
 * plus a companion JSON atlas whose frame rects stay consistent with the PNG (rects
 * are scaled to match when the atlas is exported above 1×).
 *
 * All pixels come from composited buffers, so the sheet is effect-free — no
 * checkerboard, no CRT (constitution: clean-export invariant).
 */
import {
  atlasToJson,
  type PackResult,
  packCels,
  type SheetCel,
  type SpritesheetLayout,
  scaleMeta,
} from '../../core/exporters/spritesheet';
import { err, type Result, type RGBA } from '../../core/types';
import { bufferToPngBlob } from './encode';
import { type SaveOutcome, sanitizeFileName, saveBlob, withExtension } from './save';

const PNG_MIME = 'image/png';
const JSON_MIME = 'application/json';

export interface ExportSpritesheetRequest {
  readonly layout?: SpritesheetLayout;
  readonly padding?: number;
  readonly margin?: number;
  readonly columns?: number;
  readonly powerOfTwo?: boolean;
  readonly background?: RGBA | null;
  /** Integer nearest-neighbor scale for the atlas PNG (default 1). */
  readonly scale?: number;
  /** Animation FPS recorded in the JSON meta. */
  readonly fps?: number;
  /** Base name (with or without extension); sanitized before use. */
  readonly fileName: string;
}

/** Pack cels and produce the atlas PNG blob + companion JSON string (no saving). */
export async function buildSpritesheet(
  cels: readonly SheetCel[],
  req: ExportSpritesheetRequest,
): Promise<{ png: Blob; json: string; pngName: string; jsonName: string; pack: PackResult }> {
  const pack = packCels(cels, {
    layout: req.layout,
    padding: req.padding,
    margin: req.margin,
    columns: req.columns,
    powerOfTwo: req.powerOfTwo,
    background: req.background ?? null,
  });
  const scale = req.scale ?? 1;
  const png = await bufferToPngBlob(pack.atlas, { scale });
  const base = sanitizeFileName(req.fileName);
  const pngName = withExtension(base, 'png');
  const jsonName = withExtension(base, 'json');
  const json = atlasToJson(scaleMeta(pack.meta, scale), { image: pngName, fps: req.fps, scale });
  return { png, json, pngName, jsonName, pack };
}

/**
 * Pack composited cels into a spritesheet and save the PNG + JSON atlas. Saves the
 * PNG first; if the user cancels the PNG picker the JSON is skipped. Returns the
 * final save outcome (or a friendly error) via the client-only envelope.
 */
export async function exportSpritesheetFile(
  cels: readonly SheetCel[],
  req: ExportSpritesheetRequest,
): Promise<Result<SaveOutcome>> {
  if (cels.length === 0) {
    return err('EXPORT_NO_FRAMES', 'Nothing to export yet — draw something first.');
  }
  let built: Awaited<ReturnType<typeof buildSpritesheet>>;
  try {
    built = await buildSpritesheet(cels, req);
  } catch {
    return err('EXPORT_ENCODE_FAILED', 'Could not render the spritesheet PNG.');
  }
  const pngRes = await saveBlob(built.png, {
    fileName: built.pngName,
    extensions: ['.png'],
    mimeTypes: [PNG_MIME],
    description: 'Spritesheet PNG',
  });
  if (!pngRes.ok || pngRes.value === 'cancelled') {
    return pngRes;
  }
  const jsonBlob = new Blob([built.json], { type: JSON_MIME });
  return await saveBlob(jsonBlob, {
    fileName: built.jsonName,
    extensions: ['.json'],
    mimeTypes: [JSON_MIME],
    description: 'Spritesheet atlas JSON',
  });
}
