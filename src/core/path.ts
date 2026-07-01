/**
 * src/core/path.ts — pure integer path math for the drawing tools (master-spec §3.2).
 *
 * Leaf engine module: no DOM, imports nothing but the shared point type. Provides
 * the point-level primitives the raster ops and the interactive stroke handling
 * both need — Bresenham point generation, the pixel-perfect corner filter, and
 * the Shift-snap that constrains a line to 0/45/90°. Everything here is pure and
 * deterministic given its integer inputs.
 */

/** An integer point in art space (origin top-left, x right, y down). */
export interface Point2 {
  x: number;
  y: number;
}

/** tan(22.5°): the half-angle boundary between the 0/45/90° snap sectors. */
const TAN_22_5 = Math.tan(Math.PI / 8);

/**
 * Integer Bresenham line from (x0,y0) to (x1,y1), INCLUSIVE of both endpoints.
 * Returns a gap-free 8-connected staircase; a zero-length line yields the single
 * shared point. Inputs are truncated to integers first.
 */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Point2[] {
  let cx = Math.trunc(x0);
  let cy = Math.trunc(y0);
  const ex = Math.trunc(x1);
  const ey = Math.trunc(y1);
  const dx = Math.abs(ex - cx);
  const dy = -Math.abs(ey - cy);
  const sx = cx < ex ? 1 : -1;
  const sy = cy < ey ? 1 : -1;
  let err = dx + dy;
  const points: Point2[] = [];
  for (;;) {
    points.push({ x: cx, y: cy });
    if (cx === ex && cy === ey) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

/**
 * Remove doubled corner pixels from a point path (the standard "pixel-perfect"
 * filter used by pixel-art pencils). A point is dropped when its previous and
 * next points are each orthogonally adjacent to it (share a row or column) yet
 * diagonal to each other — i.e. the point is the redundant elbow of an L-shaped
 * staircase step. A pure diagonal (already single-width) is returned untouched.
 */
export function pixelPerfectFilter(points: readonly Point2[]): Point2[] {
  if (points.length < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const out: Point2[] = [];
  const last = points.length - 1;
  let i = 0;
  while (i < points.length) {
    if (i > 0 && i < last) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];
      const prevOrtho = prev.x === cur.x || prev.y === cur.y;
      const nextOrtho = next.x === cur.x || next.y === cur.y;
      const neighborsDiagonal = prev.x !== next.x && prev.y !== next.y;
      if (prevOrtho && nextOrtho && neighborsDiagonal) {
        i += 1; // skip the corner; the diagonal neighbors carry the stroke
      }
    }
    out.push({ x: points[i].x, y: points[i].y });
    i += 1;
  }
  return out;
}

/**
 * Snap the endpoint (x1,y1) of a line anchored at (x0,y0) to the nearest of
 * horizontal, vertical, or 45° diagonal (Shift-constrained lines). The dominant
 * axis wins outside the ±22.5° diagonal band; on the diagonal the shorter axis is
 * extended to match the longer so |dx| === |dy|.
 */
export function snapLineEndpoint(x0: number, y0: number, x1: number, y1: number): Point2 {
  const ax = Math.trunc(x0);
  const ay = Math.trunc(y0);
  const bx = Math.trunc(x1);
  const by = Math.trunc(y1);
  const dx = bx - ax;
  const dy = by - ay;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) {
    return { x: bx, y: by };
  }
  if (ady <= adx * TAN_22_5) {
    return { x: bx, y: ay }; // horizontal
  }
  if (adx <= ady * TAN_22_5) {
    return { x: ax, y: by }; // vertical
  }
  const len = Math.max(adx, ady);
  return { x: ax + Math.sign(dx) * len, y: ay + Math.sign(dy) * len }; // 45°
}
