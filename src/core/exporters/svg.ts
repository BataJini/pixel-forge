/**
 * src/core/exporters/svg.ts — pure buffer → SVG encoder (master-spec §5, §3.8).
 *
 * PURE and deterministic (no DOM). Emits a crisp, rect-merged SVG that
 * re-rasterizes to the exact source image:
 *   - `viewBox="0 0 w h"` so one user unit == one art pixel.
 *   - `shape-rendering="crispEdges"` so renderers never anti-alias the pixels
 *     (constitution: pixel-correctness — never interpolate pixel art).
 *   - fully-transparent pixels are omitted (they contribute nothing).
 *   - `merge` (default true) greedily coalesces same-color pixels into the
 *     fewest rectangles (row runs, then vertically-adjacent identical runs), so
 *     a solid region is a single `<rect>` instead of one rect per pixel.
 *
 * The input is a COMPOSITED pixel buffer; this module never sees the display
 * checkerboard or CRT layer, so exports are structurally effect-free
 * (constitution: clean-export invariant).
 */
import { getPixel } from '../buffer';
import { rgbaToHex } from '../color';
import type { PixelBuffer, RGBA } from '../types';

const OPAQUE = 255;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Decimals kept for a partial-alpha `fill-opacity` (a/255). */
const OPACITY_PRECISION = 4;

export interface SvgOptions {
  /** Greedily merge same-color pixels into rectangles (default true). */
  readonly merge?: boolean;
}

interface MergedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A horizontal run of one color within a single row. */
interface Run {
  readonly x: number;
  readonly w: number;
  readonly key: number;
  used: boolean;
}

/** Pack an opaque/semi color into a single positive integer (r,g,b,a bytes). */
function packColor(c: RGBA): number {
  return ((c[0] * 256 + c[1]) * 256 + c[2]) * 256 + c[3];
}

/** Inverse of {@link packColor}. */
function unpackColor(key: number): RGBA {
  return [(key >>> 24) & 0xff, (key >>> 16) & 0xff, (key >>> 8) & 0xff, key & 0xff];
}

/** Horizontal same-color runs for each row (transparent pixels break runs). */
function rowRuns(buf: PixelBuffer): Run[][] {
  const rows: Run[][] = [];
  for (let y = 0; y < buf.h; y++) {
    const runs: Run[] = [];
    let start = -1;
    let key = -1;
    for (let x = 0; x < buf.w; x++) {
      const c = getPixel(buf, x, y);
      const k = c[3] === 0 ? -1 : packColor(c);
      if (k !== key) {
        if (key >= 0) runs.push({ x: start, w: x - start, key, used: false });
        start = x;
        key = k;
      }
    }
    if (key >= 0) runs.push({ x: start, w: buf.w - start, key, used: false });
    rows.push(runs);
  }
  return rows;
}

/** Find an unused run at exactly (x, w, key) in `runs`, or null. */
function matchRun(runs: Run[] | undefined, x: number, w: number, key: number): Run | null {
  if (!runs) return null;
  for (const run of runs) {
    if (!run.used && run.x === x && run.w === w && run.key === key) return run;
  }
  return null;
}

/** Greedy rect merge: extend each row run downward over identical runs. */
function mergeRects(buf: PixelBuffer): Map<number, MergedRect[]> {
  const rows = rowRuns(buf);
  const byColor = new Map<number, MergedRect[]>();
  for (let y = 0; y < rows.length; y++) {
    for (const run of rows[y]) {
      if (run.used) continue;
      run.used = true;
      let h = 1;
      for (let ny = y + 1; ny < rows.length; ny++) {
        const below = matchRun(rows[ny], run.x, run.w, run.key);
        if (!below) break;
        below.used = true;
        h++;
      }
      const list = byColor.get(run.key) ?? [];
      list.push({ x: run.x, y, w: run.w, h });
      byColor.set(run.key, list);
    }
  }
  return byColor;
}

/** Unmerged fallback: one 1×1 rect per opaque pixel, grouped by color. */
function perPixelRects(buf: PixelBuffer): Map<number, MergedRect[]> {
  const byColor = new Map<number, MergedRect[]>();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const c = getPixel(buf, x, y);
      if (c[3] === 0) continue;
      const key = packColor(c);
      const list = byColor.get(key) ?? [];
      list.push({ x, y, w: 1, h: 1 });
      byColor.set(key, list);
    }
  }
  return byColor;
}

/** Deterministic order: colors ascending by packed value, rects by y then x. */
function sortRects(rects: MergedRect[]): MergedRect[] {
  return [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
}

function colorGroup(key: number, rects: MergedRect[]): string {
  const [r, g, b, a] = unpackColor(key);
  const fill = rgbaToHex([r, g, b, a]);
  const opacity =
    a < OPAQUE ? ` fill-opacity="${Number((a / OPAQUE).toFixed(OPACITY_PRECISION))}"` : '';
  const body = sortRects(rects)
    .map((rc) => `<rect x="${rc.x}" y="${rc.y}" width="${rc.w}" height="${rc.h}"/>`)
    .join('');
  return `<g fill="${fill}"${opacity}>${body}</g>`;
}

/**
 * Encode a composited pixel buffer as a crisp, rect-merged SVG string. Output is
 * deterministic and re-rasterizes to the exact source image. Transparent pixels
 * are omitted; partial-alpha pixels carry a `fill-opacity`.
 */
export function bufferToSvg(buf: PixelBuffer, opts: SvgOptions = {}): string {
  const merge = opts.merge ?? true;
  const open =
    `<svg xmlns="${SVG_NS}" width="${buf.w}" height="${buf.h}" ` +
    `viewBox="0 0 ${buf.w} ${buf.h}" shape-rendering="crispEdges">`;
  if (buf.w <= 0 || buf.h <= 0) {
    return `${open}</svg>`;
  }
  const byColor = merge ? mergeRects(buf) : perPixelRects(buf);
  const groups = [...byColor.keys()]
    .sort((a, b) => a - b)
    .map((key) => colorGroup(key, byColor.get(key) as MergedRect[]))
    .join('');
  return `${open}${groups}</svg>`;
}
