/**
 * src/core/palette.ts — the color-palette engine (master-spec §3.3, §4.4, §5).
 *
 * PURE and deterministic (no DOM). Covers:
 *   - `BUILTIN_PALETTES` — the authoritative built-in palettes (exact §4.4 hexes).
 *   - `parsePalette` — defensive import of newline-hex / GIMP `.gpl` / `.pal`,
 *     returning the client-only result envelope; malformed input is rejected, not
 *     thrown (constitution: no throwing across boundaries for expected failures).
 *   - `serializePalette` — export the current palette as `.hex` or `.gpl`.
 *   - Immutable swatch editors (add/remove/move/set/rename/duplicate).
 *   - Indexed / palette-lock helpers: `paletteSwap` recolors artwork by index (the
 *     killer retro feature), plus nearest-color snapping for lock mode.
 *
 * IDs are derived deterministically from content (no `Date`/random) so the module
 * stays pure and testable.
 */
import { cloneBuffer, createBuffer } from './buffer';
import { hexToRgba, rgbaToHex, tryHexToRgba } from './color';
import { BUILTIN_SPECS, type BuiltinPaletteId } from './palettes/builtins';
import type { Palette, PixelBuffer, Result, RGBA } from './types';
import { err, ok } from './types';

export type { BuiltinPaletteId } from './palettes/builtins';

/** Formats accepted on import. `hex` is the lowest-common-denominator. */
export type PaletteFormat = 'hex' | 'gpl' | 'pal';
/** Formats offered on export. */
export type PaletteExportFormat = 'hex' | 'gpl';

/** Hard cap on palette size (indexed color ceiling). Imports beyond this truncate. */
export const MAX_PALETTE_COLORS = 256;

/** Guard against pathological import payloads (defensive parsing). */
const MAX_INPUT_BYTES = 5_000_000;
const CHANNEL_MAX = 255;
const CHANNELS = 4;
const DEFAULT_PALETTE_NAME = 'Imported Palette';
const MAX_NAME_LENGTH = 64;

// ─────────────────────────────────────────────────────────────────────────────
// Construction & identity
// ─────────────────────────────────────────────────────────────────────────────

/** 32-bit FNV-1a hash → 8-char hex. Deterministic id source (pure). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A defensive copy of a color tuple. */
function cloneColor(c: RGBA): RGBA {
  return [c[0], c[1], c[2], c[3]];
}

/**
 * Sanitize an (untrusted) palette name: replace control chars/newlines with
 * spaces, collapse whitespace, trim, cap length, and fall back to a default.
 * Imported `.gpl` names are rendered in the UI, so scrub them at the boundary
 * (constitution: sanitize user-provided strings).
 */
function sanitizeName(name: string): string {
  if (typeof name !== 'string') {
    return DEFAULT_PALETTE_NAME;
  }
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  const cleaned = out.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || DEFAULT_PALETTE_NAME;
}

/** Deterministic content id for a palette (stable given name + colors). */
function paletteId(name: string, colors: readonly RGBA[]): string {
  const body = colors.map((c) => c.join(',')).join(';');
  return `pal-${fnv1a(`${name}|${body}`)}`;
}

/**
 * Build a `Palette` from a name and colors with a deterministic content id. The
 * name is sanitized; colors are copied and capped at `MAX_PALETTE_COLORS`.
 */
export function makePalette(name: string, colors: readonly RGBA[], source?: string): Palette {
  const cleanName = sanitizeName(name);
  const capped = colors.slice(0, MAX_PALETTE_COLORS).map(cloneColor);
  const palette: Palette = { id: paletteId(cleanName, capped), name: cleanName, colors: capped };
  return source === undefined ? palette : { ...palette, source };
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in palettes (exact §4.4 hexes)
// ─────────────────────────────────────────────────────────────────────────────

function paletteFromHexes(
  id: string,
  name: string,
  hexes: readonly string[],
  source: string,
): Palette {
  // hexToRgba throws only on programmer error; all built-in hexes are valid.
  return { id, name, colors: hexes.map((h) => hexToRgba(h)), source };
}

/**
 * Deep-freeze a shared built-in palette so it can never be mutated in place —
 * defense in depth beyond the outer `Object.freeze` (L-1). Every editor already
 * copies before editing, but a built-in is also handed out by reference as
 * `DEFAULT_ACTIVE_PALETTE` and by `loadPalette`, so we freeze each color tuple,
 * the colors array, and the palette object. Any accidental future in-place write
 * to a built-in then fails loudly (strict mode) instead of corrupting shared
 * state. Only built-ins are frozen; `makePalette` still returns mutable copies
 * for editable custom-palette state.
 */
function deepFreezePalette(palette: Palette): Palette {
  for (const color of palette.colors) {
    Object.freeze(color);
  }
  Object.freeze(palette.colors);
  return Object.freeze(palette);
}

/** All built-in palettes keyed by id (master-spec §4.4). Deep-frozen (L-1). */
export const BUILTIN_PALETTES: Readonly<Record<BuiltinPaletteId, Palette>> = Object.freeze(
  Object.fromEntries(
    BUILTIN_SPECS.map((spec) => [
      spec.id,
      deepFreezePalette(paletteFromHexes(spec.id, spec.name, spec.hexes, spec.source)),
    ]),
  ) as Record<BuiltinPaletteId, Palette>,
);

/** Built-in palette ids in menu order. */
export const BUILTIN_PALETTE_IDS: readonly BuiltinPaletteId[] = BUILTIN_SPECS.map((s) => s.id);

/** Type guard for an untrusted built-in palette id (settings/persisted values). */
export function isBuiltinPaletteId(value: unknown): value is BuiltinPaletteId {
  return typeof value === 'string' && value in BUILTIN_PALETTES;
}

// ─────────────────────────────────────────────────────────────────────────────
// Import parsing (hex / gpl / pal)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a strict decimal 0–255 byte, or `null` when the token is not one. */
function parseByte(token: string): number | null {
  if (!/^\d{1,3}$/.test(token)) {
    return null;
  }
  const n = Number.parseInt(token, 10);
  return n >= 0 && n <= CHANNEL_MAX ? n : null;
}

/** Read a `#RRGGBB`(A) or bare-hex token as a color, or `null` when invalid. */
function tokenToColor(token: string): RGBA | null {
  const withHash = token.startsWith('#') ? token : `#${token}`;
  const r = tryHexToRgba(withHash);
  return r.ok ? r.value : null;
}

/** Split into trimmed, non-empty lines with a leading BOM stripped. */
function toLines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function isHexComment(line: string): boolean {
  return line.startsWith(';') || line.startsWith('//');
}

/** Parse a newline-delimited hex list. Comments start with `;` or `//`. */
function parseHexList(text: string): Result<Palette> {
  const colors: RGBA[] = [];
  for (const line of toLines(text)) {
    if (isHexComment(line)) {
      continue;
    }
    const token = line.split(/\s+/)[0];
    const color = tokenToColor(token);
    if (color === null) {
      return err('PALETTE_PARSE', `Not a valid hex color: "${line}".`);
    }
    colors.push(color);
    if (colors.length >= MAX_PALETTE_COLORS) {
      break;
    }
  }
  if (colors.length === 0) {
    return err('PALETTE_EMPTY', 'No colors found in the hex palette.');
  }
  return ok(makePalette(DEFAULT_PALETTE_NAME, colors, 'hex'));
}

/** Parse a GIMP `.gpl` palette (`R G B name` rows; `#`/headers ignored). */
function parseGpl(text: string): Result<Palette> {
  const colors: RGBA[] = [];
  let name = DEFAULT_PALETTE_NAME;
  for (const line of toLines(text)) {
    if (line.startsWith('#') || /^GIMP Palette$/i.test(line) || /^Columns:/i.test(line)) {
      continue;
    }
    const nameMatch = /^Name:\s*(.+)$/i.exec(line);
    if (nameMatch) {
      name = nameMatch[1];
      continue;
    }
    const parts = line.split(/\s+/);
    const r = parseByte(parts[0]);
    const g = parseByte(parts[1]);
    const b = parseByte(parts[2]);
    if (r === null || g === null || b === null) {
      continue; // not a color row (stray header/label) — skip defensively
    }
    colors.push([r, g, b, CHANNEL_MAX]);
    if (colors.length >= MAX_PALETTE_COLORS) {
      break;
    }
  }
  if (colors.length === 0) {
    return err('PALETTE_EMPTY', 'No colors found in the GIMP palette.');
  }
  return ok(makePalette(name, colors, 'gpl'));
}

/**
 * Parse a `.pal` file. Handles JASC-PAL (`R G B` rows after a 3-line header),
 * plain `R G B` lists, and hex-in-`.pal`; header/count lines fall through
 * harmlessly. A line is a color when it starts with ≥3 decimal bytes, else when
 * it is a lone hex token.
 */
function parsePal(text: string): Result<Palette> {
  const colors: RGBA[] = [];
  for (const line of toLines(text)) {
    if (isHexComment(line) || /^JASC-PAL$/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    const r = parseByte(parts[0]);
    const g = parseByte(parts[1]);
    const b = parseByte(parts[2]);
    if (r !== null && g !== null && b !== null) {
      colors.push([r, g, b, CHANNEL_MAX]);
    } else if (parts.length === 1) {
      const color = tokenToColor(parts[0]);
      if (color !== null) {
        colors.push(color);
      }
    }
    if (colors.length >= MAX_PALETTE_COLORS) {
      break;
    }
  }
  if (colors.length === 0) {
    return err('PALETTE_EMPTY', 'No colors found in the .pal palette.');
  }
  return ok(makePalette(DEFAULT_PALETTE_NAME, colors, 'pal'));
}

/**
 * Parse palette text in the given format into a `Palette`, or a coded error
 * result on malformed/empty/oversized input (never throws). Colors are capped at
 * `MAX_PALETTE_COLORS`.
 */
export function parsePalette(text: string, format: PaletteFormat): Result<Palette> {
  if (typeof text !== 'string') {
    return err('PALETTE_PARSE', 'Palette input must be text.');
  }
  if (text.length > MAX_INPUT_BYTES) {
    return err('PALETTE_TOO_LARGE', 'Palette file is too large to import.');
  }
  switch (format) {
    case 'hex':
      return parseHexList(text);
    case 'gpl':
      return parseGpl(text);
    case 'pal':
      return parsePal(text);
    default:
      return err('PALETTE_FORMAT', `Unsupported palette format: "${String(format)}".`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/** Serialize a palette to `.hex` (newline hex) or `.gpl` (GIMP) text. */
export function serializePalette(palette: Palette, format: PaletteExportFormat): string {
  if (format === 'gpl') {
    const header = ['GIMP Palette', `Name: ${palette.name}`, 'Columns: 0', '#'];
    const rows = palette.colors.map((c) => `${c[0]} ${c[1]} ${c[2]}\t${rgbaToHex(c)}`);
    return `${[...header, ...rows].join('\n')}\n`;
  }
  const comment = `; ${palette.name} — exported from PixelForge`;
  const rows = palette.colors.map((c) => rgbaToHex(c));
  return `${[comment, ...rows].join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Immutable swatch editors
// ─────────────────────────────────────────────────────────────────────────────

function withColors(palette: Palette, colors: RGBA[]): Palette {
  // Editing a built-in yields a distinct, content-derived palette (F-4): its id
  // leaves the BUILTIN_PALETTES namespace so the Load menu stops showing the
  // pristine built-in as "selected" and re-picking it restores the original.
  // Custom palettes keep their id across edits (stable identity, like rename).
  const id = isBuiltinPaletteId(palette.id) ? paletteId(palette.name, colors) : palette.id;
  const next: Palette = { id, name: palette.name, colors };
  return palette.source === undefined ? next : { ...next, source: palette.source };
}

/** Insert `color` at `index` (default: end). Out-of-range clamps to the ends. */
export function addSwatch(palette: Palette, color: RGBA, index?: number): Palette {
  if (palette.colors.length >= MAX_PALETTE_COLORS) {
    return palette;
  }
  const colors = palette.colors.map(cloneColor);
  const at = index === undefined ? colors.length : Math.max(0, Math.min(colors.length, index));
  colors.splice(at, 0, cloneColor(color));
  return withColors(palette, colors);
}

/** Remove the swatch at `index`. Out-of-range is a no-op returning the input. */
export function removeSwatchAt(palette: Palette, index: number): Palette {
  if (index < 0 || index >= palette.colors.length) {
    return palette;
  }
  const colors = palette.colors.map(cloneColor);
  colors.splice(index, 1);
  return withColors(palette, colors);
}

/** Replace the swatch at `index`. Out-of-range is a no-op returning the input. */
export function setSwatchAt(palette: Palette, index: number, color: RGBA): Palette {
  if (index < 0 || index >= palette.colors.length) {
    return palette;
  }
  const colors = palette.colors.map(cloneColor);
  colors[index] = cloneColor(color);
  return withColors(palette, colors);
}

/** Move a swatch from `from` to `to` (reorder). Out-of-range is a no-op. */
export function moveSwatch(palette: Palette, from: number, to: number): Palette {
  const n = palette.colors.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
    return palette;
  }
  const colors = palette.colors.map(cloneColor);
  const [moved] = colors.splice(from, 1);
  colors.splice(to, 0, moved);
  return withColors(palette, colors);
}

/** Rename a palette (identity/colors unchanged); the new name is sanitized. */
export function renamePalette(palette: Palette, name: string): Palette {
  return { ...palette, name: sanitizeName(name) };
}

/** Copy a palette under a fresh content id (e.g. before editing a built-in). */
export function duplicatePalette(palette: Palette, name?: string): Palette {
  const nextName = name ?? `${palette.name} copy`;
  return makePalette(nextName, palette.colors, palette.source);
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexed mode / palette-lock / palette-swap
// ─────────────────────────────────────────────────────────────────────────────

/** Pack an RGBA tuple into one unsigned 32-bit key. */
function packRgba(r: number, g: number, b: number, a: number): number {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

/** Exact index of `color` in the palette (all four channels), or -1. */
export function paletteIndexOf(palette: Palette, color: RGBA): number {
  for (let i = 0; i < palette.colors.length; i++) {
    const c = palette.colors[i];
    if (c[0] === color[0] && c[1] === color[1] && c[2] === color[2] && c[3] === color[3]) {
      return i;
    }
  }
  return -1;
}

/** Index of the nearest palette color by squared RGB distance (ties → lower). */
export function nearestPaletteIndex(palette: Palette, color: RGBA): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.colors.length; i++) {
    const c = palette.colors[i];
    const dr = c[0] - color[0];
    const dg = c[1] - color[1];
    const db = c[2] - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Snap a color to the nearest palette entry (indexed / lock mode). A fully
 * transparent input stays transparent (eraser); an empty palette returns a copy.
 */
export function snapColorToPalette(palette: Palette, color: RGBA): RGBA {
  if (color[3] === 0) {
    return [0, 0, 0, 0];
  }
  const i = nearestPaletteIndex(palette, color);
  return i < 0 ? cloneColor(color) : cloneColor(palette.colors[i]);
}

/**
 * Palette-swap: recolor a buffer by index. Each opaque pixel that exactly matches
 * a color in `from` (index i) becomes `to.colors[i]`. Transparent pixels and
 * pixels not present in `from` are left unchanged; indices absent from `to` are
 * left unchanged. Returns a NEW buffer (immutable). This is the indexed-mode
 * "palette swap recolors the artwork by index" feature.
 */
export function paletteSwap(buffer: PixelBuffer, from: Palette, to: Palette): PixelBuffer {
  const indexByColor = new Map<number, number>();
  for (let i = 0; i < from.colors.length; i++) {
    const c = from.colors[i];
    const key = packRgba(c[0], c[1], c[2], c[3]);
    if (!indexByColor.has(key)) {
      indexByColor.set(key, i);
    }
  }
  const out = cloneBuffer(buffer);
  const d = out.data;
  for (let i = 0; i < d.length; i += CHANNELS) {
    if (d[i + 3] === 0) {
      continue;
    }
    const idx = indexByColor.get(packRgba(d[i], d[i + 1], d[i + 2], d[i + 3]));
    if (idx === undefined || idx >= to.colors.length) {
      continue;
    }
    const tc = to.colors[idx];
    d[i] = tc[0];
    d[i + 1] = tc[1];
    d[i + 2] = tc[2];
    d[i + 3] = tc[3];
  }
  return out;
}

/**
 * Quantize every opaque pixel of a buffer to its nearest palette color (used when
 * entering indexed mode). Returns a NEW buffer; transparent pixels are preserved.
 * Results are cached per distinct source color for speed at 512×512.
 */
export function snapBufferToPalette(buffer: PixelBuffer, palette: Palette): PixelBuffer {
  if (palette.colors.length === 0) {
    return cloneBuffer(buffer);
  }
  const out = cloneBuffer(buffer);
  const d = out.data;
  const cache = new Map<number, RGBA>();
  for (let i = 0; i < d.length; i += CHANNELS) {
    if (d[i + 3] === 0) {
      continue;
    }
    const key = packRgba(d[i], d[i + 1], d[i + 2], d[i + 3]);
    let snapped = cache.get(key);
    if (snapped === undefined) {
      snapped = snapColorToPalette(palette, [d[i], d[i + 1], d[i + 2], d[i + 3]]);
      cache.set(key, snapped);
    }
    d[i] = snapped[0];
    d[i + 1] = snapped[1];
    d[i + 2] = snapped[2];
    d[i + 3] = snapped[3];
  }
  return out;
}

/** Convenience: a `w × h` buffer filled with the palette's color at `index`. */
export function filledFromPalette(w: number, h: number, palette: Palette, index = 0): PixelBuffer {
  const buf = createBuffer(w, h);
  const color = palette.colors[index];
  if (color === undefined) {
    return buf;
  }
  const d = buf.data;
  for (let i = 0; i < d.length; i += CHANNELS) {
    d[i] = color[0];
    d[i + 1] = color[1];
    d[i + 2] = color[2];
    d[i + 3] = color[3];
  }
  return buf;
}
