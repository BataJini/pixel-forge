/**
 * src/core/types.ts — shared engine data model (master-spec §4.1).
 *
 * PURE types only: no runtime code, no DOM. Every other engine module and the
 * held-out acceptance tests import these by exact path. Colors are RGBA tuples
 * `[r,g,b,a]` (0–255) inside the engine; hex strings only at the UI/import
 * boundary (see color.ts).
 */

/** A single color: red, green, blue, alpha — each an integer 0–255. */
export type RGBA = [number, number, number, number];

/**
 * A raw pixel buffer at native art resolution. `data` is row-major RGBA with
 * length `w * h * 4`. This is the source of truth for artwork; display-only
 * effects (checkerboard/CRT) never live here (constitution: clean-export).
 */
export interface PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

/** Layer blend mode. `'normal'` is source-over; others are reserved for later. */
export type BlendMode = 'normal' | (string & {});

/** A single layer within a frame. `opacity` is a percentage, 0–100. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  buffer: PixelBuffer;
}

/** One animation frame: a full layer stack plus its on-screen duration (ms). */
export interface Frame {
  id: string;
  durationMs: number;
  layers: Layer[];
}

/** A named palette of colors, optionally tagged with its import source. */
export interface Palette {
  id: string;
  name: string;
  colors: RGBA[];
  source?: string;
}

/** An integer-space rectangle: origin top-left, width/height ≥ 0 when non-empty. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A selection mask: `mask[y*w + x]` is `1` inside the selection, `0` outside.
 * `bounds` is the tight integer bounding box of the selected region.
 */
export interface Selection {
  mask: Uint8Array;
  w: number;
  h: number;
  bounds: Rect;
}

/** The persisted project document (see project.ts for (de)serialize, U-011). */
export interface Project {
  schema: 1;
  id: string;
  name: string;
  w: number;
  h: number;
  frames: Frame[];
  palette: Palette | null;
  indexed: boolean;
  fps: number;
  createdAt: string;
  updatedAt: string;
  thumbnailDataUrl?: string;
}

/** Structured error for the client-only result envelope. */
export interface ResultError {
  code: string;
  message: string;
}

/**
 * Result envelope for fallible operations (constitution: client-only envelope).
 * Expected failures return `{ ok: false, error }`; programmer errors throw.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ResultError };

/** Convenience constructor for a success result. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Convenience constructor for a failure result. */
export function err<T = never>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
