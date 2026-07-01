/**
 * src/core/tools.ts — pure tool-modifier composition (master-spec §3.2).
 *
 * Ties the raster primitives (buffer.ts) to the interactive tool modifiers:
 * square brush, mirror X/Y, pixel-perfect, dither, selection-mask constraint,
 * whole-pixel move, and eyedropper sampling. Every function is pure/deterministic
 * and DOM-free; the platform layer wires pointer events to these. Working buffers
 * are mutated ONLY through buffer.ts's tracked in-place API (constitution).
 */
import { brushRect, createBuffer, getPixel, setPixelMut } from './buffer';
import { bresenhamLine, type Point2, pixelPerfectFilter } from './path';
import { makeRect, unionRect } from './rect';
import { selectionContains } from './selection';
import type { PixelBuffer, Rect, RGBA, Selection } from './types';

/** Mirror-axis configuration for symmetric drawing. */
export interface MirrorConfig {
  x: boolean;
  y: boolean;
}

/** No mirroring. */
export const NO_MIRROR: MirrorConfig = { x: false, y: false };

function accumulate(dirty: Rect | null, area: Rect | null): Rect | null {
  if (!area) {
    return dirty;
  }
  return dirty ? unionRect(dirty, area) : area;
}

/**
 * The distinct set of points produced by reflecting (x,y) across the enabled
 * mirror axes of a `w × h` canvas. Mirror-X reflects across the vertical center
 * line (`w-1-x`); mirror-Y across the horizontal center line (`h-1-y`). Returns
 * 1, 2, or 4 deduplicated points.
 */
export function mirrorPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  m: MirrorConfig,
): Point2[] {
  const mx = w - 1 - x;
  const my = h - 1 - y;
  const pts: Point2[] = [{ x, y }];
  const push = (px: number, py: number): void => {
    if (!pts.some((p) => p.x === px && p.y === py)) {
      pts.push({ x: px, y: py });
    }
  };
  if (m.x) {
    push(mx, y);
  }
  if (m.y) {
    push(x, my);
  }
  if (m.x && m.y) {
    push(mx, my);
  }
  return pts;
}

/**
 * Stamp a square brush of side `size` centered on (cx,cy) into `buf`, writing
 * only pixels inside `selection` when one is active (`null` = unconstrained).
 * Returns the dirty rect actually written, or `null`.
 */
export function stampBrush(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  size: number,
  c: RGBA,
  selection: Selection | null = null,
): Rect | null {
  const box = brushRect(cx, cy, size);
  let dirty: Rect | null = null;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (selection && !selectionContains(selection, x, y)) {
        continue;
      }
      if (setPixelMut(buf, x, y, c)) {
        dirty = accumulate(dirty, makeRect(x, y, 1, 1));
      }
    }
  }
  return dirty;
}

/**
 * Stamp `color` at every mirror image of (cx,cy) with a square brush, honoring an
 * optional selection mask. The unit of a pencil/eraser dab. Returns the dirty rect.
 */
export function stampMirrored(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  size: number,
  color: RGBA,
  mirror: MirrorConfig = NO_MIRROR,
  selection: Selection | null = null,
): Rect | null {
  let dirty: Rect | null = null;
  for (const p of mirrorPoints(cx, cy, buf.w, buf.h, mirror)) {
    dirty = accumulate(dirty, stampBrush(buf, p.x, p.y, size, color, selection));
  }
  return dirty;
}

/** How a pencil colors a pixel: solid `fg`, or a 1×1 checkerboard of fg/bg. */
export interface PaintStyle {
  fg: RGBA;
  bg?: RGBA;
  dither?: boolean;
}

/** 4×4 Bayer ordered-dither threshold matrix (values 0–15). */
export const BAYER_4X4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Distinct threshold levels in {@link BAYER_4X4} (0–15). */
export const BAYER_LEVELS = 16;

/** The Bayer threshold (0–15) for art pixel (x,y). */
export function bayerThreshold(x: number, y: number): number {
  const row = ((y % 4) + 4) % 4;
  const col = ((x % 4) + 4) % 4;
  return BAYER_4X4[row][col];
}

/**
 * The color a dither-enabled dab lays down at (x,y): an ordered dither driven by
 * the {@link BAYER_4X4} matrix. `ratio` (0..1, default 0.5) is the fraction of the
 * cell that takes `fg`; at 0.5 the 4×4 Bayer field resolves to the fg/bg
 * checkerboard the tool modifier specifies ("checkerboard between fg/bg while
 * drawing", §3.2), while a future shade brush can pass other ratios for 16-bit
 * ordered shading. With dither off or no bg, returns `fg`.
 */
export function ditherColor(x: number, y: number, style: PaintStyle, ratio = 0.5): RGBA {
  if (!style.dither || !style.bg) {
    return style.fg;
  }
  const cut = Math.round(ratio * BAYER_LEVELS);
  return bayerThreshold(x, y) < cut ? style.fg : style.bg;
}

/**
 * Paint a freehand stroke through `points` (already in art space) with the brush,
 * mirror, pixel-perfect, dither, and selection modifiers applied. Consecutive
 * samples are joined with Bresenham so fast drags stay gap-free. Mutates `buf`
 * in place and returns the combined dirty rect (one gesture → one dirty region).
 */
export function paintStroke(
  buf: PixelBuffer,
  points: readonly Point2[],
  size: number,
  style: PaintStyle,
  mirror: MirrorConfig = NO_MIRROR,
  selection: Selection | null = null,
  pixelPerfect = false,
): Rect | null {
  if (points.length === 0) {
    return null;
  }
  const joined: Point2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const seg = bresenhamLine(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    for (let j = 1; j < seg.length; j++) {
      joined.push(seg[j]);
    }
  }
  const path = pixelPerfect ? pixelPerfectFilter(joined) : joined;
  let dirty: Rect | null = null;
  for (const p of path) {
    const color = ditherColor(p.x, p.y, style);
    dirty = accumulate(dirty, stampMirrored(buf, p.x, p.y, size, color, mirror, selection));
  }
  return dirty;
}

/** Sample the color at (x,y) for the eyedropper (OOB → transparent). */
export function sampleColor(buf: PixelBuffer, x: number, y: number): RGBA {
  return getPixel(buf, x, y);
}

/**
 * A NEW buffer with all pixels translated by whole-pixel (dx,dy). Content moved
 * out of bounds is clipped; the exposed area is transparent. This is the Move
 * tool's per-nudge transform (arrow keys) and layer/selection drag commit.
 */
export function translateBuffer(buf: PixelBuffer, dx: number, dy: number): PixelBuffer {
  const out = createBuffer(buf.w, buf.h);
  const sx = Math.trunc(dx);
  const sy = Math.trunc(dy);
  for (let y = 0; y < buf.h; y++) {
    const srcY = y - sy;
    if (srcY < 0 || srcY >= buf.h) {
      continue;
    }
    for (let x = 0; x < buf.w; x++) {
      const srcX = x - sx;
      if (srcX < 0 || srcX >= buf.w) {
        continue;
      }
      const src = (srcY * buf.w + srcX) * 4;
      const dst = (y * buf.w + x) * 4;
      out.data[dst] = buf.data[src];
      out.data[dst + 1] = buf.data[src + 1];
      out.data[dst + 2] = buf.data[src + 2];
      out.data[dst + 3] = buf.data[src + 3];
    }
  }
  return out;
}
