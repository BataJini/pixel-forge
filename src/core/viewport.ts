/**
 * src/core/viewport.ts — pure viewport (pan/zoom) transform math.
 *
 * PURE and deterministic (no DOM). A `Viewport` maps art space (integer pixels)
 * to view space (CSS px). `zoom` = displayed CSS px per art pixel; `panX/panY` =
 * CSS-px position of art origin (0,0) within the view's top-left. All helpers
 * return NEW viewports (immutable). The platform renderer applies these to the
 * canvas via `setTransform`.
 */

export interface Viewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Integer-friendly zoom ladder. Sub-1 steps let large canvases (up to 512²) fit
 * on screen; the >=1 steps are the classic 100/200/400/800/1600% family plus
 * intermediates for finer control. Ascending, deduplicated.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.125, 0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
];

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const EPSILON = 1e-6;

/** Clamp a zoom value to the supported `[MIN_ZOOM, MAX_ZOOM]` range. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM) {
    return MIN_ZOOM;
  }
  if (zoom > MAX_ZOOM) {
    return MAX_ZOOM;
  }
  return zoom;
}

/** Map a view-space (CSS px) point to the integer art pixel under it. */
export function screenToArt(vp: Viewport, sx: number, sy: number): Point {
  return {
    x: Math.floor((sx - vp.panX) / vp.zoom),
    y: Math.floor((sy - vp.panY) / vp.zoom),
  };
}

/** Map an art pixel's top-left corner to its view-space (CSS px) position. */
export function artToScreen(vp: Viewport, ax: number, ay: number): Point {
  return { x: ax * vp.zoom + vp.panX, y: ay * vp.zoom + vp.panY };
}

/**
 * Next ladder step strictly above (`dir > 0`) or below (`dir < 0`) the current
 * zoom. Snaps off-ladder zoom values to the neighbouring rung in that direction.
 */
export function nextZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) {
    for (const step of ZOOM_STEPS) {
      if (step > zoom + EPSILON) {
        return step;
      }
    }
    return MAX_ZOOM;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < zoom - EPSILON) {
      return ZOOM_STEPS[i];
    }
  }
  return MIN_ZOOM;
}

/**
 * Re-zoom to `newZoom` while keeping the art point under the view anchor
 * (`anchorSx, anchorSy`) fixed on screen — the standard cursor-centered zoom.
 */
export function zoomAt(
  vp: Viewport,
  newZoom: number,
  anchorSx: number,
  anchorSy: number,
): Viewport {
  const z = clampZoom(newZoom);
  const artX = (anchorSx - vp.panX) / vp.zoom;
  const artY = (anchorSy - vp.panY) / vp.zoom;
  return {
    zoom: z,
    panX: anchorSx - artX * z,
    panY: anchorSy - artY * z,
  };
}

/** Translate the viewport by a view-space delta. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { zoom: vp.zoom, panX: vp.panX + dx, panY: vp.panY + dy };
}

/**
 * Largest ladder zoom at which `artW × artH` fits inside `viewW × viewH` (minus
 * `padding` on each side), centered. Falls back to a continuous fit when the art
 * is larger than the smallest ladder step allows.
 */
export function fitToScreen(
  artW: number,
  artH: number,
  viewW: number,
  viewH: number,
  padding = 0,
): Viewport {
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const raw = Math.min(availW / Math.max(1, artW), availH / Math.max(1, artH));
  let zoom = MIN_ZOOM;
  for (const step of ZOOM_STEPS) {
    if (step <= raw + EPSILON) {
      zoom = step;
    }
  }
  if (raw < MIN_ZOOM) {
    zoom = raw;
  }
  const panX = (viewW - artW * zoom) / 2;
  const panY = (viewH - artH * zoom) / 2;
  return { zoom, panX, panY };
}
