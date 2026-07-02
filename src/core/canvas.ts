/**
 * src/core/canvas.ts — pure canvas-size operations: resize, crop, trim
 * (master-spec §3.7 Canvas menu). No DOM. Every op is IMMUTABLE (returns new
 * buffers/projects; inputs untouched) and enforces the 1..512 canvas cap
 * (constitution). These power the Resize / Crop / Trim dialogs (U-011); making
 * them undoable is the store's job (it records the before/after).
 */
import { createBuffer, extractRegion } from './buffer';
import { unionRect } from './rect';
import type { Frame, PixelBuffer, Project, Rect } from './types';

const CHANNELS = 4;
const MIN_CANVAS = 1;
const MAX_CANVAS = 512;

/** Nine-way placement anchor for {@link resizeBuffer} content preservation. */
export type ResizeAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

type Align = 'start' | 'center' | 'end';

const ANCHOR_ALIGN: Readonly<Record<ResizeAnchor, { readonly h: Align; readonly v: Align }>> = {
  'top-left': { h: 'start', v: 'start' },
  top: { h: 'center', v: 'start' },
  'top-right': { h: 'end', v: 'start' },
  left: { h: 'start', v: 'center' },
  center: { h: 'center', v: 'center' },
  right: { h: 'end', v: 'center' },
  'bottom-left': { h: 'start', v: 'end' },
  bottom: { h: 'center', v: 'end' },
  'bottom-right': { h: 'end', v: 'end' },
};

/** Clamp a value to an integer canvas dimension in [1, 512]. */
export function clampDim(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_CANVAS;
  }
  const n = Math.trunc(value);
  return n < MIN_CANVAS ? MIN_CANVAS : n > MAX_CANVAS ? MAX_CANVAS : n;
}

function align(delta: number, mode: Align): number {
  if (mode === 'start') {
    return 0;
  }
  if (mode === 'end') {
    return delta;
  }
  return Math.floor(delta / 2);
}

/**
 * Resize the canvas to `w × h`, preserving existing pixels positioned by
 * `anchor` (default top-left). Growing pads with transparency; shrinking crops
 * the pixels that fall outside. Returns a NEW buffer; the input is untouched.
 */
export function resizeBuffer(
  buf: PixelBuffer,
  w: number,
  h: number,
  anchor: ResizeAnchor = 'top-left',
): PixelBuffer {
  const nw = clampDim(w);
  const nh = clampDim(h);
  const out = createBuffer(nw, nh);
  const { h: hAlign, v: vAlign } = ANCHOR_ALIGN[anchor] ?? ANCHOR_ALIGN['top-left'];
  const dx = align(nw - buf.w, hAlign);
  const dy = align(nh - buf.h, vAlign);
  const src = buf.data;
  const dst = out.data;
  for (let y = 0; y < buf.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= nh) {
      continue;
    }
    for (let x = 0; x < buf.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= nw) {
        continue;
      }
      const si = (y * buf.w + x) * CHANNELS;
      const di = (ty * nw + tx) * CHANNELS;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}

/**
 * Crop a buffer to `rect` (art space). Pixels outside the source become
 * transparent. Returns a NEW `rect.w × rect.h` buffer via {@link extractRegion}.
 */
export function cropBuffer(buf: PixelBuffer, rect: Rect): PixelBuffer {
  return extractRegion(buf, rect);
}

/**
 * Tight integer bounding box of every pixel with alpha > 0, or `null` when the
 * buffer is fully transparent. Used by Trim and the crop-to-content default.
 */
export function contentBounds(buf: PixelBuffer): Rect | null {
  const { w, h, data } = buf;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * CHANNELS + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Union of the content bounds across every layer of every frame, or `null` when
 * the whole project is transparent. This is the region Trim keeps.
 */
export function projectContentBounds(project: Project): Rect | null {
  let bounds: Rect | null = null;
  for (const frame of project.frames) {
    for (const layer of frame.layers) {
      const b = contentBounds(layer.buffer);
      if (b) {
        bounds = bounds ? unionRect(bounds, b) : b;
      }
    }
  }
  return bounds;
}

/** Clamp a crop rect to the project canvas and the 1..512 cap. Returns null on
 * an empty intersection. */
export function clampCropRect(rect: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.trunc(rect.x));
  const y = Math.max(0, Math.trunc(rect.y));
  const right = Math.min(w, Math.trunc(rect.x) + Math.max(0, Math.trunc(rect.w)));
  const bottom = Math.min(h, Math.trunc(rect.y) + Math.max(0, Math.trunc(rect.h)));
  const cw = right - x;
  const ch = bottom - y;
  if (cw < MIN_CANVAS || ch < MIN_CANVAS) {
    return null;
  }
  return { x, y, w: Math.min(MAX_CANVAS, cw), h: Math.min(MAX_CANVAS, ch) };
}

function mapFrames(frames: Frame[], map: (buf: PixelBuffer) => PixelBuffer): Frame[] {
  return frames.map((frame) => ({
    ...frame,
    layers: frame.layers.map((layer) => ({ ...layer, buffer: map(layer.buffer) })),
  }));
}

/**
 * Resize the whole project canvas to `w × h` (all frames/layers), preserving
 * pixels by `anchor`. Returns a NEW project (metadata carried, `updatedAt`
 * optionally refreshed by the caller). Pure and immutable.
 */
export function resizeProject(
  project: Project,
  w: number,
  h: number,
  anchor: ResizeAnchor = 'top-left',
): Project {
  const nw = clampDim(w);
  const nh = clampDim(h);
  return {
    ...project,
    w: nw,
    h: nh,
    frames: mapFrames(project.frames, (buf) => resizeBuffer(buf, nw, nh, anchor)),
  };
}

/**
 * Crop the whole project to `rect` (clamped to the canvas). Returns the new
 * project, or `null` when the rect does not intersect the canvas.
 */
export function cropProject(project: Project, rect: Rect): Project | null {
  const clamped = clampCropRect(rect, project.w, project.h);
  if (!clamped) {
    return null;
  }
  return {
    ...project,
    w: clamped.w,
    h: clamped.h,
    frames: mapFrames(project.frames, (buf) => cropBuffer(buf, clamped)),
  };
}

/**
 * Trim fully-transparent margins from every side. Returns the trimmed project +
 * the kept bounds, or `null` when there is nothing to trim (already tight, or a
 * fully-transparent canvas — Trim is then a no-op).
 */
export function trimProject(project: Project): { project: Project; bounds: Rect } | null {
  const bounds = projectContentBounds(project);
  if (!bounds) {
    return null;
  }
  if (bounds.x === 0 && bounds.y === 0 && bounds.w === project.w && bounds.h === project.h) {
    return null; // already tight
  }
  const cropped = cropProject(project, bounds);
  return cropped ? { project: cropped, bounds } : null;
}
