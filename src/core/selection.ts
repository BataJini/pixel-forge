/**
 * src/core/selection.ts — pure rectangular-marquee selection masks (master-spec §3.2).
 *
 * A {@link Selection} is a 0/1 mask over the canvas plus its tight bounds. When a
 * selection is active every drawing/fill op is constrained to the `1` pixels
 * (the tool layer consults {@link selectionContains}); with no active selection
 * (represented as `null` at the tool layer) edits are unconstrained. All ops are
 * IMMUTABLE — they return a NEW selection and never touch shared state. No DOM.
 */
import { clampRect, isEmptyRect, makeRect } from './rect';
import type { Rect, Selection } from './types';

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** An empty (nothing-selected) mask for a `w × h` canvas. */
export function createSelection(w: number, h: number): Selection {
  const width = Math.max(0, Math.trunc(w));
  const height = Math.max(0, Math.trunc(h));
  return { w: width, h: height, mask: new Uint8Array(width * height), bounds: { ...EMPTY_BOUNDS } };
}

/** A selection covering the whole canvas. */
export function selectAll(w: number, h: number): Selection {
  const width = Math.max(0, Math.trunc(w));
  const height = Math.max(0, Math.trunc(h));
  const mask = new Uint8Array(width * height).fill(1);
  const bounds = width > 0 && height > 0 ? makeRect(0, 0, width, height) : { ...EMPTY_BOUNDS };
  return { w: width, h: height, mask, bounds };
}

/** Whether the selection currently covers no pixels. */
export function isSelectionEmpty(sel: Selection): boolean {
  return isEmptyRect(sel.bounds);
}

/** Whether art pixel (x,y) is inside the selection mask. */
export function selectionContains(sel: Selection, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sel.w || y >= sel.h) {
    return false;
  }
  return sel.mask[y * sel.w + x] === 1;
}

/** Tight integer bounding box of the set pixels in `mask`, or an empty rect. */
export function computeBounds(mask: Uint8Array, w: number, h: number): Rect {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { ...EMPTY_BOUNDS };
  }
  return makeRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

function paintRect(sel: Selection, rect: Rect, value: 0 | 1): Selection {
  const mask = new Uint8Array(sel.mask);
  const area = clampRect(
    makeRect(Math.trunc(rect.x), Math.trunc(rect.y), Math.trunc(rect.w), Math.trunc(rect.h)),
    sel.w,
    sel.h,
  );
  if (!isEmptyRect(area)) {
    for (let y = area.y; y < area.y + area.h; y++) {
      const row = y * sel.w;
      for (let x = area.x; x < area.x + area.w; x++) {
        mask[row + x] = value;
      }
    }
  }
  return { w: sel.w, h: sel.h, mask, bounds: computeBounds(mask, sel.w, sel.h) };
}

/** Add a rectangle to the selection (Shift-drag union). */
export function addRect(sel: Selection, rect: Rect): Selection {
  return paintRect(sel, rect, 1);
}

/** Remove a rectangle from the selection (Alt-drag subtract). */
export function subtractRect(sel: Selection, rect: Rect): Selection {
  return paintRect(sel, rect, 0);
}

/** A fresh selection consisting of exactly one rectangle. */
export function selectRect(w: number, h: number, rect: Rect): Selection {
  return paintRect(createSelection(w, h), rect, 1);
}
