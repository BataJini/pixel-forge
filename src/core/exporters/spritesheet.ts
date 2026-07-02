/**
 * src/core/exporters/spritesheet.ts — pure sprite-atlas packer (master-spec §5, §3.8).
 *
 * PURE and deterministic (no DOM). Lays a sequence of animation cels out into a
 * single atlas `PixelBuffer` (grid / horizontal-strip / vertical-strip), with
 * configurable inter-cell `padding`, an outer `margin`, and optional power-of-two
 * atlas dimensions, and returns a machine-readable {@link SpritesheetMeta} whose
 * frame rects/durations describe exactly where each cel landed. A companion JSON
 * atlas ({@link atlasToJson}) maps each frame name → `{x,y,w,h,duration}` (§3.8).
 *
 * The input pixels come from COMPOSITED buffers (never the on-screen canvas), so
 * the atlas is structurally effect-free: no transparency checkerboard and no CRT
 * scanlines/glow can leak in (constitution: clean-export invariant). {@link packFrames}
 * composites core {@link Frame}s via `buffer.composite`; {@link packCels} packs
 * pre-composited cels directly (used by the platform export path).
 */
import { composite, createBuffer } from '../buffer';
import { compositeFrame } from '../frames';
import type { Frame, PixelBuffer, RGBA } from '../types';

const CHANNELS = 4;
const OPAQUE = 255;

/** How the cells are arranged in the atlas. */
export type SpritesheetLayout = 'grid' | 'horizontal' | 'vertical';

/** One composited animation cel: its pixels, on-screen duration, and optional name. */
export interface SheetCel {
  readonly buffer: PixelBuffer;
  readonly durationMs: number;
  readonly name?: string;
}

/** Packing options (all optional; sensible pixel-art defaults). */
export interface PackOptions {
  /** Cell arrangement (default `'grid'`). */
  readonly layout?: SpritesheetLayout;
  /** Transparent gutter BETWEEN adjacent cells, in px (default 0). */
  readonly padding?: number;
  /** Transparent border around the whole sheet, in px (default 0). */
  readonly margin?: number;
  /** Explicit grid column count (grid layout only); default `ceil(sqrt(n))`. */
  readonly columns?: number;
  /** Round the atlas width/height up to the next power of two (default false). */
  readonly powerOfTwo?: boolean;
  /** Opaque matte painted behind every cel + gutter, or `null` for transparent. */
  readonly background?: RGBA | null;
}

/** Where a single frame landed in the atlas, plus its playback duration (ms). */
export interface FrameRect {
  readonly index: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly duration: number;
}

/** Full, machine-readable description of a packed atlas. */
export interface SpritesheetMeta {
  readonly w: number;
  readonly h: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly columns: number;
  readonly rows: number;
  readonly layout: SpritesheetLayout;
  readonly padding: number;
  readonly margin: number;
  readonly count: number;
  readonly frames: FrameRect[];
}

/** The packed atlas pixels plus its metadata. */
export interface PackResult {
  readonly atlas: PixelBuffer;
  readonly meta: SpritesheetMeta;
}

/** Extra fields folded into the JSON atlas `meta` block. */
export interface AtlasJsonExtra {
  readonly image?: string;
  readonly fps?: number;
  readonly scale?: number;
}

function clampNonNeg(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

/** Smallest power of two ≥ `n` (POT of ≤1 is 1). */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n <= 1) {
    return 1;
  }
  return 2 ** Math.ceil(Math.log2(n));
}

/** Column count for a layout and cel count (grid defaults to a near-square). */
function columnsFor(layout: SpritesheetLayout, count: number, explicit?: number): number {
  if (layout === 'horizontal') {
    return Math.max(1, count);
  }
  if (layout === 'vertical') {
    return 1;
  }
  if (explicit !== undefined && Number.isFinite(explicit)) {
    return Math.max(1, Math.min(Math.trunc(explicit), Math.max(1, count)));
  }
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

/**
 * Source-over blit of `cel` into `atlas` with its top-left at `(ox, oy)`, clipped to
 * both the atlas bounds AND the cell's `clipW × clipH` box — so an oversized cel can
 * never bleed into an adjacent cell (the non-overlap invariant holds unconditionally).
 */
function blitOver(
  atlas: PixelBuffer,
  cel: PixelBuffer,
  ox: number,
  oy: number,
  clipW: number,
  clipH: number,
): void {
  const ad = atlas.data;
  const cd = cel.data;
  const rows = Math.min(cel.h, clipH);
  const cols = Math.min(cel.w, clipW);
  for (let y = 0; y < rows; y++) {
    const ay = oy + y;
    if (ay < 0 || ay >= atlas.h) {
      continue;
    }
    for (let x = 0; x < cols; x++) {
      const ax = ox + x;
      if (ax < 0 || ax >= atlas.w) {
        continue;
      }
      const si = (y * cel.w + x) * CHANNELS;
      const sa = cd[si + 3];
      if (sa === 0) {
        continue;
      }
      const di = (ay * atlas.w + ax) * CHANNELS;
      if (sa === OPAQUE) {
        ad[di] = cd[si];
        ad[di + 1] = cd[si + 1];
        ad[di + 2] = cd[si + 2];
        ad[di + 3] = OPAQUE;
        continue;
      }
      const a = sa / OPAQUE;
      const inv = 1 - a;
      const da = ad[di + 3] / OPAQUE;
      const outA = a + da * inv;
      ad[di] = Math.round((cd[si] * a + ad[di] * da * inv) / (outA || 1));
      ad[di + 1] = Math.round((cd[si + 1] * a + ad[di + 1] * da * inv) / (outA || 1));
      ad[di + 2] = Math.round((cd[si + 2] * a + ad[di + 2] * da * inv) / (outA || 1));
      ad[di + 3] = Math.round(outA * OPAQUE);
    }
  }
}

/** Fill an atlas with an opaque matte color (used when `background` is set). */
function fillBackground(atlas: PixelBuffer, bg: RGBA): void {
  const d = atlas.data;
  for (let i = 0; i < d.length; i += CHANNELS) {
    d[i] = bg[0];
    d[i + 1] = bg[1];
    d[i + 2] = bg[2];
    d[i + 3] = OPAQUE;
  }
}

function emptyResult(margin: number): PackResult {
  const side = margin * 2;
  return {
    atlas: createBuffer(side, side),
    meta: {
      w: side,
      h: side,
      frameW: 0,
      frameH: 0,
      columns: 0,
      rows: 0,
      layout: 'grid',
      padding: 0,
      margin,
      count: 0,
      frames: [],
    },
  };
}

/**
 * Pack pre-composited cels into an atlas. Cells are laid out row-major in the
 * chosen `layout`; each cell is `frameW × frameH` (taken from the first cel).
 * Rects are non-overlapping, sit within the atlas bounds, are separated by exactly
 * `padding`, and the whole grid is inset by `margin`. Returns the atlas pixels and
 * a full {@link SpritesheetMeta}. Deterministic; never mutates its inputs.
 */
export function packCels(cels: readonly SheetCel[], opts: PackOptions = {}): PackResult {
  const margin = clampNonNeg(opts.margin, 0);
  if (cels.length === 0) {
    return emptyResult(margin);
  }
  const layout = opts.layout ?? 'grid';
  const padding = clampNonNeg(opts.padding, 0);
  const frameW = cels[0].buffer.w;
  const frameH = cels[0].buffer.h;
  const count = cels.length;
  const columns = columnsFor(layout, count, opts.columns);
  const rows = Math.max(1, Math.ceil(count / columns));

  const contentW = columns * frameW + Math.max(0, columns - 1) * padding;
  const contentH = rows * frameH + Math.max(0, rows - 1) * padding;
  let atlasW = contentW + margin * 2;
  let atlasH = contentH + margin * 2;
  if (opts.powerOfTwo) {
    atlasW = nextPowerOfTwo(atlasW);
    atlasH = nextPowerOfTwo(atlasH);
  }

  const atlas = createBuffer(atlasW, atlasH);
  if (opts.background) {
    fillBackground(atlas, opts.background);
  }

  const frames: FrameRect[] = cels.map((cel, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (frameW + padding);
    const y = margin + row * (frameH + padding);
    blitOver(atlas, cel.buffer, x, y, frameW, frameH);
    return {
      index,
      name: cel.name && cel.name.length > 0 ? cel.name : `frame_${index}`,
      x,
      y,
      w: frameW,
      h: frameH,
      duration: cel.durationMs,
    };
  });

  return {
    atlas,
    meta: {
      w: atlasW,
      h: atlasH,
      frameW,
      frameH,
      columns,
      rows,
      layout,
      padding,
      margin,
      count,
      frames,
    },
  };
}

/** Wrap a composited frame into a {@link SheetCel} (name defaults to `frame_i`). */
function celFromFrame(frame: Frame, index: number): SheetCel {
  const buffer = frame.layers.length > 0 ? compositeFrame(frame) : composite([]);
  return { buffer, durationMs: frame.durationMs, name: `frame_${index}` };
}

/**
 * Pack core {@link Frame}s (master-spec §5 contract): each frame is composited to
 * flat pixels, then packed via {@link packCels}. `meta.frames[i].duration` carries
 * each frame's `durationMs`.
 */
export function packFrames(frames: readonly Frame[], opts: PackOptions = {}): PackResult {
  return packCels(frames.map(celFromFrame), opts);
}

/**
 * Scale every dimension in a {@link SpritesheetMeta} by an integer factor, so the
 * JSON atlas stays consistent with an atlas PNG exported at that scale (the rects
 * still slice the scaled image correctly). `scale ≤ 1` returns the meta unchanged.
 */
export function scaleMeta(meta: SpritesheetMeta, scale: number): SpritesheetMeta {
  const s = Number.isInteger(scale) && scale > 1 ? scale : 1;
  if (s === 1) {
    return meta;
  }
  return {
    ...meta,
    w: meta.w * s,
    h: meta.h * s,
    frameW: meta.frameW * s,
    frameH: meta.frameH * s,
    padding: meta.padding * s,
    margin: meta.margin * s,
    frames: meta.frames.map((f) => ({
      ...f,
      x: f.x * s,
      y: f.y * s,
      w: f.w * s,
      h: f.h * s,
    })),
  };
}

/** Extract a cel-sized sub-rect from the atlas (inverse of a pack blit; round-trip). */
export function sliceCel(
  atlas: PixelBuffer,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): PixelBuffer {
  const out = createBuffer(Math.max(0, rect.w), Math.max(0, rect.h));
  const od = out.data;
  const ad = atlas.data;
  for (let y = 0; y < rect.h; y++) {
    const ay = rect.y + y;
    if (ay < 0 || ay >= atlas.h) {
      continue;
    }
    for (let x = 0; x < rect.w; x++) {
      const ax = rect.x + x;
      if (ax < 0 || ax >= atlas.w) {
        continue;
      }
      const di = (y * rect.w + x) * CHANNELS;
      const si = (ay * atlas.w + ax) * CHANNELS;
      od[di] = ad[si];
      od[di + 1] = ad[si + 1];
      od[di + 2] = ad[si + 2];
      od[di + 3] = ad[si + 3];
    }
  }
  return out;
}

/**
 * Serialize a packed atlas to a companion JSON descriptor: `frames[name] =
 * {x,y,w,h,duration}` plus a `meta` block (master-spec §3.8). Human-diffable,
 * stable key order.
 */
export function atlasToJson(meta: SpritesheetMeta, extra: AtlasJsonExtra = {}): string {
  const frames: Record<string, { x: number; y: number; w: number; h: number; duration: number }> =
    {};
  for (const f of meta.frames) {
    frames[f.name] = { x: f.x, y: f.y, w: f.w, h: f.h, duration: f.duration };
  }
  const doc = {
    frames,
    meta: {
      app: 'PixelForge',
      version: '1.0',
      image: extra.image,
      format: 'RGBA8888',
      size: { w: meta.w, h: meta.h },
      scale: extra.scale ?? 1,
      layout: meta.layout,
      columns: meta.columns,
      rows: meta.rows,
      frameW: meta.frameW,
      frameH: meta.frameH,
      padding: meta.padding,
      margin: meta.margin,
      frameCount: meta.count,
      fps: extra.fps,
    },
  };
  return JSON.stringify(doc, null, 2);
}
