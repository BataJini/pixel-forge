/**
 * src/core/rect.ts — pure integer-rectangle geometry.
 *
 * Shared by dirty-rect tracking (render pipeline), history patch bounds (U-006),
 * and selection math (U-004). No DOM. A rect is "empty" when `w <= 0 || h <= 0`.
 */
import type { Rect } from './types';

/** Construct a rect. */
export function makeRect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** True when the rect covers no pixels. */
export function isEmptyRect(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0;
}

/** Exclusive right edge (`x + w`). */
export function rectRight(r: Rect): number {
  return r.x + r.w;
}

/** Exclusive bottom edge (`y + h`). */
export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

/** Whether integer point (x, y) lies inside the rect (right/bottom exclusive). */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Structural equality of two rects. */
export function rectEquals(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Smallest rect covering both inputs. An empty input is ignored; two empties
 * yield an empty rect at the origin.
 */
export function unionRect(a: Rect, b: Rect): Rect {
  if (isEmptyRect(a)) {
    return isEmptyRect(b) ? makeRect(0, 0, 0, 0) : { ...b };
  }
  if (isEmptyRect(b)) {
    return { ...a };
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(rectRight(a), rectRight(b));
  const bottom = Math.max(rectBottom(a), rectBottom(b));
  return makeRect(x, y, right - x, bottom - y);
}

/** Overlap of two rects, or `null` when they do not intersect. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  if (right <= x || bottom <= y) {
    return null;
  }
  return makeRect(x, y, right - x, bottom - y);
}

/**
 * Clamp a rect to the bounds `[0, 0, w, h]`. Returns an empty rect (w/h 0) when
 * the input lies fully outside the bounds.
 */
export function clampRect(r: Rect, w: number, h: number): Rect {
  const clamped = intersectRect(r, makeRect(0, 0, w, h));
  return clamped ?? makeRect(0, 0, 0, 0);
}

/** Tight integer rect covering both endpoints (inclusive of each). */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0) + 1;
  const h = Math.abs(y1 - y0) + 1;
  return makeRect(x, y, w, h);
}

/** Grow (or shrink, when `pad < 0`) a rect by `pad` on all four sides. */
export function expandRect(r: Rect, pad: number): Rect {
  return makeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
}
