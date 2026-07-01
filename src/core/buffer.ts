/**
 * src/core/buffer.ts — pure pixel-buffer engine (master-spec §5).
 *
 * PURE and deterministic (no DOM). Two contracts coexist:
 *   - Immutable ops (`setPixel`) return a NEW buffer and never touch the input —
 *     these are the tested public contract.
 *   - A bounded in-place mutation API (`setPixelMut`, `fillRectMut`) exists for
 *     the render/tool hot path; the constitution permits mutating the per-layer
 *     working `Uint8ClampedArray` ONLY through this module, always tracking the
 *     dirty rect so history can capture an immutable before/after patch.
 *
 * Coordinate system: integer pixels, origin top-left, x right, y down.
 * Out-of-bounds reads return transparent; OOB writes are no-ops (never errors).
 */
import { bresenhamLine, pixelPerfectFilter } from './path';
import { clampRect, isEmptyRect, makeRect, unionRect } from './rect';
import type { Layer, PixelBuffer, Rect, RGBA } from './types';

const CHANNELS = 4;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

function index(buf: PixelBuffer, x: number, y: number): number {
  return (y * buf.w + x) * CHANNELS;
}

function inBounds(buf: PixelBuffer, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < buf.w && y < buf.h;
}

/** A fully transparent `w × h` buffer (`[0,0,0,0]` per pixel). */
export function createBuffer(w: number, h: number): PixelBuffer {
  const width = Math.max(0, Math.trunc(w));
  const height = Math.max(0, Math.trunc(h));
  return { w: width, h: height, data: new Uint8ClampedArray(width * height * CHANNELS) };
}

/** Deep copy of a buffer (independent backing array). */
export function cloneBuffer(buf: PixelBuffer): PixelBuffer {
  return { w: buf.w, h: buf.h, data: new Uint8ClampedArray(buf.data) };
}

/** Wrap an existing byte array as a buffer without copying (caller owns it). */
export function bufferFrom(w: number, h: number, data: Uint8ClampedArray): PixelBuffer {
  return { w, h, data };
}

/** Read a pixel. Out-of-bounds returns transparent `[0,0,0,0]`. */
export function getPixel(buf: PixelBuffer, x: number, y: number): RGBA {
  if (!inBounds(buf, x, y)) {
    return [...TRANSPARENT];
  }
  const i = index(buf, x, y);
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

/**
 * Immutable set: returns a NEW buffer with pixel (x, y) = c. The input is never
 * modified. An out-of-bounds write is a no-op that returns the input unchanged.
 */
export function setPixel(buf: PixelBuffer, x: number, y: number, c: RGBA): PixelBuffer {
  if (!inBounds(buf, x, y)) {
    return buf;
  }
  const next = cloneBuffer(buf);
  const i = index(next, x, y);
  next.data[i] = c[0];
  next.data[i + 1] = c[1];
  next.data[i + 2] = c[2];
  next.data[i + 3] = c[3];
  return next;
}

/**
 * In-place set for the working-buffer hot path. Mutates `buf.data` and returns
 * `true` iff the pixel actually changed. OOB is a no-op returning `false`.
 */
export function setPixelMut(buf: PixelBuffer, x: number, y: number, c: RGBA): boolean {
  if (!inBounds(buf, x, y)) {
    return false;
  }
  const i = index(buf, x, y);
  const d = buf.data;
  if (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2] && d[i + 3] === c[3]) {
    return false;
  }
  d[i] = c[0];
  d[i + 1] = c[1];
  d[i + 2] = c[2];
  d[i + 3] = c[3];
  return true;
}

/**
 * In-place fill of `rect` with color `c`, clamped to the buffer. Returns the
 * clamped dirty rect actually written, or `null` when nothing was in bounds.
 */
export function fillRectMut(buf: PixelBuffer, rect: Rect, c: RGBA): Rect | null {
  const area = clampRect(rect, buf.w, buf.h);
  if (isEmptyRect(area)) {
    return null;
  }
  const d = buf.data;
  for (let y = area.y; y < area.y + area.h; y++) {
    let i = (y * buf.w + area.x) * CHANNELS;
    for (let x = 0; x < area.w; x++) {
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c[3];
      i += CHANNELS;
    }
  }
  return area;
}

/** Source-over compositing of one source pixel (with effective alpha) onto dst. */
function overPixel(
  dst: Uint8ClampedArray,
  di: number,
  src: Uint8ClampedArray,
  si: number,
  srcA: number,
): void {
  const dstA = dst[di + 3];
  const inv = 1 - srcA / 255;
  const outA = srcA + dstA * inv;
  if (outA <= 0) {
    dst[di] = 0;
    dst[di + 1] = 0;
    dst[di + 2] = 0;
    dst[di + 3] = 0;
    return;
  }
  for (let ch = 0; ch < 3; ch++) {
    const blended = (src[si + ch] * srcA + dst[di + ch] * dstA * inv) / outA;
    dst[di + ch] = Math.round(blended);
  }
  dst[di + 3] = Math.round(outA);
}

/**
 * Flatten layers bottom-to-top into a new buffer via source-over compositing.
 * Hidden layers and zero-opacity layers are skipped; `opacity` (0–100) scales
 * each layer's source alpha. All layers are assumed to share the canvas size;
 * a layer smaller/larger than the base is composited over its overlapping area.
 */
export function composite(layers: Layer[]): PixelBuffer {
  if (layers.length === 0) {
    return createBuffer(0, 0);
  }
  const { w, h } = layers[0].buffer;
  const out = createBuffer(w, h);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) {
      continue;
    }
    const src = layer.buffer;
    if (src.w !== w || src.h !== h) {
      continue;
    }
    const opacity = Math.min(100, layer.opacity) / 100;
    const sd = src.data;
    const od = out.data;
    for (let p = 0; p < w * h; p++) {
      const i = p * CHANNELS;
      const srcA = sd[i + 3] * opacity;
      if (srcA <= 0) {
        continue;
      }
      overPixel(od, i, sd, i, srcA);
    }
  }
  return out;
}

/** A view of a buffer's pixels as 32-bit words when 4-byte aligned, else null. */
function asWords(buf: PixelBuffer, count: number): Uint32Array | null {
  if (buf.data.byteOffset % CHANNELS !== 0) {
    return null;
  }
  return new Uint32Array(buf.data.buffer, buf.data.byteOffset, count);
}

/** Whether pixel `p` differs between two byte arrays (word view preferred). */
function pixelDiffers(
  aWords: Uint32Array | null,
  bWords: Uint32Array | null,
  ad: Uint8ClampedArray,
  bd: Uint8ClampedArray,
  p: number,
): boolean {
  if (aWords && bWords) {
    return aWords[p] !== bWords[p];
  }
  const i = p * CHANNELS;
  return (
    ad[i] !== bd[i] || ad[i + 1] !== bd[i + 1] || ad[i + 2] !== bd[i + 2] || ad[i + 3] !== bd[i + 3]
  );
}

/**
 * Bounding box of pixels that differ between two same-size buffers, or `null`
 * when identical. Buffers of different size report the whole `after` as dirty.
 * Compares all four channels (32 bits at a time when the backing is aligned).
 */
export function dirtyRect(before: PixelBuffer, after: PixelBuffer): Rect | null {
  if (before.w !== after.w || before.h !== after.h) {
    return after.w > 0 && after.h > 0 ? makeRect(0, 0, after.w, after.h) : null;
  }
  const w = after.w;
  const h = after.h;
  const count = w * h;
  const aWords = asWords(before, count);
  const bWords = asWords(after, count);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (pixelDiffers(aWords, bWords, before.data, after.data, row + x)) {
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
  return makeRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** True when two buffers have equal size and identical bytes. */
export function buffersEqual(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) {
      return false;
    }
  }
  return true;
}

// ─── Drawing-tool raster primitives (master-spec §5) ────────────────────────
// Each public op is IMMUTABLE (clone-then-write) and pure; the `*Into` variants
// mutate a caller-owned working buffer in place for the interactive hot path and
// return the dirty rect. Coordinates are integer art space; OOB writes no-op.

/** Options for {@link drawLine}. `size` is the square-brush side (≥1). */
export interface LineOptions {
  size?: number;
  pixelPerfect?: boolean;
}

/** Options for {@link drawRect} / {@link drawEllipse}. */
export interface ShapeOptions {
  fill?: boolean;
  fillColor?: RGBA;
}

/** Options for {@link floodFill}. `tolerance` is Chebyshev per-channel (0 = exact). */
export interface FloodOptions {
  tolerance?: number;
  contiguous?: boolean;
}

/** True when two colors are byte-identical. */
export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * The integer bounding box of a square brush of side `size` centered on (cx,cy).
 * Odd sizes center on the pixel; even sizes bias one pixel to the bottom-right
 * (the common pixel-art convention), so size 1 is exactly the single pixel.
 */
export function brushRect(cx: number, cy: number, size: number): Rect {
  const s = Math.max(1, Math.trunc(size));
  const half = Math.floor((s - 1) / 2);
  return makeRect(cx - half, cy - half, s, s);
}

function accumulate(dirty: Rect | null, area: Rect | null): Rect | null {
  if (!area) {
    return dirty;
  }
  return dirty ? unionRect(dirty, area) : area;
}

/** Whether the pixel at (x,y) matches `target` within a Chebyshev tolerance. */
function pixelMatches(buf: PixelBuffer, x: number, y: number, target: RGBA, tol: number): boolean {
  const i = index(buf, x, y);
  const d = buf.data;
  if (tol <= 0) {
    return (
      d[i] === target[0] &&
      d[i + 1] === target[1] &&
      d[i + 2] === target[2] &&
      d[i + 3] === target[3]
    );
  }
  return (
    Math.abs(d[i] - target[0]) <= tol &&
    Math.abs(d[i + 1] - target[1]) <= tol &&
    Math.abs(d[i + 2] - target[2]) <= tol &&
    Math.abs(d[i + 3] - target[3]) <= tol
  );
}

/**
 * In-place Bresenham line with a square brush of `opts.size`, stamping every
 * point. `opts.pixelPerfect` removes doubled corner pixels from the point path
 * first. Returns the dirty rect actually written, or `null` if nothing changed.
 */
export function drawLineInto(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  opts: LineOptions = {},
): Rect | null {
  const size = Math.max(1, Math.trunc(opts.size ?? 1));
  const points = opts.pixelPerfect
    ? pixelPerfectFilter(bresenhamLine(x0, y0, x1, y1))
    : bresenhamLine(x0, y0, x1, y1);
  let dirty: Rect | null = null;
  for (const p of points) {
    if (size === 1) {
      if (setPixelMut(buf, p.x, p.y, c)) {
        dirty = accumulate(dirty, makeRect(p.x, p.y, 1, 1));
      }
    } else {
      dirty = accumulate(dirty, fillRectMut(buf, brushRect(p.x, p.y, size), c));
    }
  }
  return dirty;
}

/** Immutable Bresenham line — returns a NEW buffer (the tested contract, §5). */
export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  opts: LineOptions = {},
): PixelBuffer {
  const next = cloneBuffer(buf);
  drawLineInto(next, x0, y0, x1, y1, c, opts);
  return next;
}

/** Normalize a rect to truncated integer origin/size; negative extents collapse. */
function normalizeRect(rect: Rect): Rect {
  return makeRect(
    Math.trunc(rect.x),
    Math.trunc(rect.y),
    Math.max(0, Math.trunc(rect.w)),
    Math.max(0, Math.trunc(rect.h)),
  );
}

/** Stroke the 1px border of an inclusive rect (corners included). */
function strokeRectBorder(buf: PixelBuffer, r: Rect, c: RGBA): void {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w - 1;
  const y1 = r.y + r.h - 1;
  for (let x = x0; x <= x1; x++) {
    setPixelMut(buf, x, y0, c);
    setPixelMut(buf, x, y1, c);
  }
  for (let y = y0; y <= y1; y++) {
    setPixelMut(buf, x0, y, c);
    setPixelMut(buf, x1, y, c);
  }
}

/**
 * In-place rectangle. `opts.fill` fills the interior with `opts.fillColor ?? c`
 * and strokes the border with `c`; otherwise only the 1px outline is drawn.
 * Returns the clamped dirty rect, or `null` when the rect covers no pixels.
 */
export function drawRectInto(
  buf: PixelBuffer,
  rect: Rect,
  c: RGBA,
  opts: ShapeOptions = {},
): Rect | null {
  const r = normalizeRect(rect);
  if (r.w <= 0 || r.h <= 0) {
    return null;
  }
  if (opts.fill) {
    fillRectMut(buf, r, opts.fillColor ?? c);
    strokeRectBorder(buf, r, c);
  } else {
    strokeRectBorder(buf, r, c);
  }
  const area = clampRect(r, buf.w, buf.h);
  return isEmptyRect(area) ? null : area;
}

/** Immutable rectangle — returns a NEW buffer (the tested contract, §5). */
export function drawRect(
  buf: PixelBuffer,
  rect: Rect,
  c: RGBA,
  opts: ShapeOptions = {},
): PixelBuffer {
  const next = cloneBuffer(buf);
  drawRectInto(next, rect, c, opts);
  return next;
}

/**
 * Rasterize an ellipse fitting exactly in the inclusive rectangle (x0,y0)–(x1,y1),
 * invoking `plot` for each outline pixel. Alois Zingl's integer "ellipse in a
 * rectangle" method (a Bresenham/midpoint variant): correct for BOTH odd and even
 * diameters and touches the midpoint of each side, so no anti-aliasing is needed.
 */
function plotEllipseRect(
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  plot: (x: number, y: number) => void,
): void {
  let x0 = Math.trunc(px0);
  let y0 = Math.trunc(py0);
  let x1 = Math.trunc(px1);
  let y1 = Math.trunc(py1);
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  if (x0 > x1) {
    x0 = x1;
    x1 += a;
  }
  if (y0 > y1) {
    y0 = y1;
  }
  y0 += Math.floor((b + 1) / 2);
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  do {
    plot(x1, y0); // I. quadrant
    plot(x0, y0); // II. quadrant
    plot(x0, y1); // III. quadrant
    plot(x1, y1); // IV. quadrant
    const e2 = 2 * err;
    if (e2 <= dy) {
      y0 += 1;
      y1 -= 1;
      dy += a;
      err += dy;
    }
    if (e2 >= dx || 2 * err > dy) {
      x0 += 1;
      x1 -= 1;
      dx += b1;
      err += dx;
    }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    // Finish the flat tips of very thin ellipses.
    plot(x0 - 1, y0);
    plot(x1 + 1, y0);
    y0 += 1;
    plot(x0 - 1, y1);
    plot(x1 + 1, y1);
    y1 -= 1;
  }
}

/**
 * In-place midpoint ellipse. Outline mode strokes with `c`; fill mode fills each
 * scanline span with `opts.fillColor ?? c` then strokes the outline with `c`.
 * Returns the clamped dirty rect, or `null` when the rect covers no pixels.
 */
export function drawEllipseInto(
  buf: PixelBuffer,
  rect: Rect,
  c: RGBA,
  opts: ShapeOptions = {},
): Rect | null {
  const r = normalizeRect(rect);
  if (r.w <= 0 || r.h <= 0) {
    return null;
  }
  // A 1px-thick "ellipse" is a straight line; Zingl's rect method degenerates
  // for a zero radius, so render the 1×N / N×1 case as the line it truly is.
  if (r.w === 1 || r.h === 1) {
    fillRectMut(buf, r, opts.fill ? (opts.fillColor ?? c) : c);
    const line = clampRect(r, buf.w, buf.h);
    return isEmptyRect(line) ? null : line;
  }
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w - 1;
  const y1 = r.y + r.h - 1;
  if (opts.fill) {
    const fc = opts.fillColor ?? c;
    const rowMin = new Map<number, number>();
    const rowMax = new Map<number, number>();
    plotEllipseRect(x0, y0, x1, y1, (x, y) => {
      const mn = rowMin.get(y);
      if (mn === undefined || x < mn) {
        rowMin.set(y, x);
      }
      const mx = rowMax.get(y);
      if (mx === undefined || x > mx) {
        rowMax.set(y, x);
      }
    });
    for (const [y, mn] of rowMin) {
      const mx = rowMax.get(y) ?? mn;
      for (let x = mn; x <= mx; x++) {
        setPixelMut(buf, x, y, fc);
      }
    }
    plotEllipseRect(x0, y0, x1, y1, (x, y) => {
      setPixelMut(buf, x, y, c);
    });
  } else {
    plotEllipseRect(x0, y0, x1, y1, (x, y) => {
      setPixelMut(buf, x, y, c);
    });
  }
  const area = clampRect(r, buf.w, buf.h);
  return isEmptyRect(area) ? null : area;
}

/** Immutable ellipse — returns a NEW buffer (the tested contract, §5). */
export function drawEllipse(
  buf: PixelBuffer,
  rect: Rect,
  c: RGBA,
  opts: ShapeOptions = {},
): PixelBuffer {
  const next = cloneBuffer(buf);
  drawEllipseInto(next, rect, c, opts);
  return next;
}

/**
 * In-place 4-neighbour flood fill from the seed (sx,sy). Matches the seed's
 * color within a Chebyshev `tolerance` (0 = exact); `contiguous:false` replaces
 * every matching pixel globally. Uses an explicit stack + visited mask so it is
 * safe (no recursion, no revisits) at the 512×512 ceiling. Returns the dirty
 * rect, or `null` if nothing changed.
 */
export function floodFillInto(
  buf: PixelBuffer,
  sx: number,
  sy: number,
  c: RGBA,
  opts: FloodOptions = {},
): Rect | null {
  const x = Math.trunc(sx);
  const y = Math.trunc(sy);
  if (!inBounds(buf, x, y)) {
    return null;
  }
  const target = getPixel(buf, x, y);
  if (colorsEqual(target, c)) {
    return null; // seed already the fill color — nothing to do
  }
  const tol = Math.min(255, Math.max(0, Math.floor(opts.tolerance ?? 0)));
  const contiguous = opts.contiguous ?? true;
  let dirty: Rect | null = null;
  const mark = (px: number, py: number): void => {
    if (setPixelMut(buf, px, py, c)) {
      dirty = accumulate(dirty, makeRect(px, py, 1, 1));
    }
  };
  if (!contiguous) {
    for (let py = 0; py < buf.h; py++) {
      for (let px = 0; px < buf.w; px++) {
        if (pixelMatches(buf, px, py, target, tol)) {
          mark(px, py);
        }
      }
    }
    return dirty;
  }
  const w = buf.w;
  const h = buf.h;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [y * w + x];
  visited[y * w + x] = 1;
  while (stack.length > 0) {
    const idx = stack.pop();
    if (idx === undefined) {
      break;
    }
    const px = idx % w;
    const py = (idx / w) | 0;
    if (!pixelMatches(buf, px, py, target, tol)) {
      continue;
    }
    mark(px, py);
    if (px > 0 && visited[idx - 1] === 0) {
      visited[idx - 1] = 1;
      stack.push(idx - 1);
    }
    if (px < w - 1 && visited[idx + 1] === 0) {
      visited[idx + 1] = 1;
      stack.push(idx + 1);
    }
    if (py > 0 && visited[idx - w] === 0) {
      visited[idx - w] = 1;
      stack.push(idx - w);
    }
    if (py < h - 1 && visited[idx + w] === 0) {
      visited[idx + w] = 1;
      stack.push(idx + w);
    }
  }
  return dirty;
}

/** Immutable flood fill — returns a NEW buffer (the tested contract, §5). */
export function floodFill(
  buf: PixelBuffer,
  sx: number,
  sy: number,
  c: RGBA,
  opts: FloodOptions = {},
): PixelBuffer {
  const next = cloneBuffer(buf);
  floodFillInto(next, sx, sy, c, opts);
  return next;
}

/**
 * Copy the pixels of `rect` from `src` into `dst` IN PLACE (both same size). Used
 * by interactive shape/preview tools to restore a region to a committed base
 * before re-drawing a provisional shape. No-op on a size mismatch or empty rect.
 */
export function copyRegion(dst: PixelBuffer, src: PixelBuffer, rect: Rect): void {
  if (dst.w !== src.w || dst.h !== src.h) {
    return;
  }
  const area = clampRect(normalizeRect(rect), dst.w, dst.h);
  if (isEmptyRect(area)) {
    return;
  }
  const rowLen = area.w * 4;
  for (let y = area.y; y < area.y + area.h; y++) {
    const start = (y * dst.w + area.x) * 4;
    dst.data.set(src.data.subarray(start, start + rowLen), start);
  }
}

/**
 * Copy pixels of `rect` from `src` into `dst` where `keep(x,y)` is true (both the
 * same size). Used to clip an edit to a selection by restoring the pixels that
 * fell OUTSIDE it from a pre-edit base — keeping every working-buffer write
 * inside the buffer module (constitution). No-op on size mismatch / empty rect.
 */
export function copyRegionWhere(
  dst: PixelBuffer,
  src: PixelBuffer,
  rect: Rect,
  keep: (x: number, y: number) => boolean,
): void {
  if (dst.w !== src.w || dst.h !== src.h) {
    return;
  }
  const area = clampRect(normalizeRect(rect), dst.w, dst.h);
  if (isEmptyRect(area)) {
    return;
  }
  const d = dst.data;
  const s = src.data;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (keep(x, y)) {
        const i = (y * dst.w + x) * CHANNELS;
        d[i] = s[i];
        d[i + 1] = s[i + 1];
        d[i + 2] = s[i + 2];
        d[i + 3] = s[i + 3];
      }
    }
  }
}

/**
 * Extract `rect` of `src` into a NEW `rect.w × rect.h` buffer. Pixels where
 * `keep(x,y)` is false (in `src` art space) or that fall out of `src` bounds are
 * left transparent, so a non-rectangular selection mask keeps its shape when
 * lifted/copied. Pure: `src` is never modified. Powers clipboard copy and the
 * Move-lift of a selection into a floating selection.
 */
export function extractRegion(
  src: PixelBuffer,
  rect: Rect,
  keep?: (x: number, y: number) => boolean,
): PixelBuffer {
  const r = normalizeRect(rect);
  const out = createBuffer(r.w, r.h);
  if (r.w <= 0 || r.h <= 0) {
    return out;
  }
  const s = src.data;
  const o = out.data;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x;
      const sy = r.y + y;
      if (!inBounds(src, sx, sy) || (keep && !keep(sx, sy))) {
        continue;
      }
      const si = index(src, sx, sy);
      const di = (y * r.w + x) * CHANNELS;
      o[di] = s[si];
      o[di + 1] = s[si + 1];
      o[di + 2] = s[si + 2];
      o[di + 3] = s[si + 3];
    }
  }
  return out;
}

/**
 * Set to transparent (`[0,0,0,0]`) every pixel of `rect` where `hit(x,y)` is true,
 * IN PLACE. Returns the dirty rect actually cleared, or `null` when nothing
 * changed. Used to cut a selection and to punch the hole left when Move lifts a
 * selection off the layer. Writes go through {@link setPixelMut} (constitution).
 */
export function clearRegionWhere(
  buf: PixelBuffer,
  rect: Rect,
  hit: (x: number, y: number) => boolean,
): Rect | null {
  const area = clampRect(normalizeRect(rect), buf.w, buf.h);
  if (isEmptyRect(area)) {
    return null;
  }
  let dirty: Rect | null = null;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (hit(x, y) && setPixelMut(buf, x, y, TRANSPARENT)) {
        dirty = accumulate(dirty, makeRect(x, y, 1, 1));
      }
    }
  }
  return dirty;
}

/**
 * Source-over composite the small buffer `src` onto `dst` at art offset (ox,oy),
 * IN PLACE. Fully-transparent source pixels are skipped (they leave `dst`
 * untouched), so a masked floating selection blends only its real pixels; opaque
 * source pixels replace the destination. Returns the dirty rect, or `null`.
 * The blit for placing/previewing a floating (pasted or lifted) selection.
 */
export function blitOverInto(
  dst: PixelBuffer,
  src: PixelBuffer,
  ox: number,
  oy: number,
): Rect | null {
  const dx0 = Math.trunc(ox);
  const dy0 = Math.trunc(oy);
  let dirty: Rect | null = null;
  for (let y = 0; y < src.h; y++) {
    const dy = dy0 + y;
    if (dy < 0 || dy >= dst.h) {
      continue;
    }
    for (let x = 0; x < src.w; x++) {
      const dx = dx0 + x;
      if (dx < 0 || dx >= dst.w) {
        continue;
      }
      const si = (y * src.w + x) * CHANNELS;
      const srcA = src.data[si + 3];
      if (srcA <= 0) {
        continue;
      }
      const di = index(dst, dx, dy);
      const d = dst.data;
      const b0 = d[di];
      const b1 = d[di + 1];
      const b2 = d[di + 2];
      const b3 = d[di + 3];
      overPixel(d, di, src.data, si, srcA);
      if (d[di] !== b0 || d[di + 1] !== b1 || d[di + 2] !== b2 || d[di + 3] !== b3) {
        dirty = accumulate(dirty, makeRect(dx, dy, 1, 1));
      }
    }
  }
  return dirty;
}
