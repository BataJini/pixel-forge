/**
 * src/core/exporters/gif.ts — pure animated-GIF encoder (master-spec §3.8, §5).
 *
 * PURE and deterministic (no DOM): builds a valid animated GIF89a from a sequence
 * of COMPOSITED cels using `gifenc`. The input pixels come from composited buffers
 * (never the on-screen canvas), so the GIF is structurally effect-free — no
 * transparency checkerboard, no CRT scanlines/glow (constitution: clean-export).
 *
 * Color fidelity: pixel art is (almost) always ≤256 colors, so the encoder first
 * tries an EXACT global palette — the union of every frame's opaque colors plus a
 * reserved transparent slot — and maps each pixel to its exact index. That path is
 * pixel-perfect (no color drift) AND compact (one global color table). Only when
 * the union exceeds 256 colors does it fall back to `gifenc`'s per-frame median-cut
 * quantizer. Either way the same input yields the same bytes (deterministic).
 *
 * The heavy lifting is intentionally main-thread-agnostic: `encodeGif` runs fine in
 * Node, a Web Worker, or the browser. The platform layer (`src/platform/exporters`)
 * runs it inside a Worker so a 512×512 × many-frame encode never freezes the UI.
 */
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { compositeFrame } from '../frames';
import type { Frame, PixelBuffer } from '../types';
import { scaleBufferNearest } from './png';

const CHANNELS = 4;
const MAX_GIF_COLORS = 256;
/** GIF dispose method 2 = "restore to background" (keeps transparency clean). */
const DISPOSE_BACKGROUND = 2;

/** One composited GIF cel: its pixels and how long it shows (ms). */
export interface GifCel {
  readonly buffer: PixelBuffer;
  readonly delayMs: number;
}

export interface GifOptions {
  /** Integer nearest-neighbor upscale applied before encoding (default 1). */
  readonly scale?: number;
  /** Loop count: `0` = forever (default), `-1` = once, `n` = n repeats. */
  readonly loop?: number;
  /** Fallback FPS when a cel's `delayMs` is ≤ 0. */
  readonly fps?: number;
  /** Max palette colors for the quantized fallback path (default 256). */
  readonly maxColors?: number;
  /** Alpha below this is treated as fully transparent (default 128). */
  readonly alphaThreshold?: number;
  /** Progress callback fired after each frame is written. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** Structural facts decoded back out of a GIF (used by tests + previews). */
export interface GifInfo {
  readonly version: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  /** Loop repeat count from the NETSCAPE ext (`0` = forever), or `null` if absent. */
  readonly loopCount: number | null;
  /** Per-frame delays in ms (from each Graphic Control Extension). */
  readonly delaysMs: number[];
}

function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

interface ExactPalette {
  readonly palette: number[][];
  readonly keyToIndex: Map<number, number>;
  readonly transparentIndex: number;
  readonly hasTransparent: boolean;
}

/**
 * Build one exact global palette from the union of all cels' colors, or `null` if
 * that union exceeds 256 entries. Index 0 is reserved for transparency when any
 * cel has a sub-threshold pixel; opaque colors are assigned ascending for a stable,
 * deterministic table.
 */
function buildExactPalette(cels: readonly GifCel[], alphaThreshold: number): ExactPalette | null {
  const keys = new Set<number>();
  let hasTransparent = false;
  for (const cel of cels) {
    const d = cel.buffer.data;
    for (let i = 0; i < d.length; i += CHANNELS) {
      if (d[i + 3] < alphaThreshold) {
        hasTransparent = true;
      } else {
        keys.add(packRgb(d[i], d[i + 1], d[i + 2]));
      }
    }
  }
  const transparentSlots = hasTransparent ? 1 : 0;
  if (keys.size + transparentSlots > MAX_GIF_COLORS) {
    return null;
  }
  const palette: number[][] = [];
  const keyToIndex = new Map<number, number>();
  if (hasTransparent) {
    palette.push([0, 0, 0]);
  }
  for (const key of [...keys].sort((a, b) => a - b)) {
    keyToIndex.set(key, palette.length);
    palette.push([(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
  }
  while (palette.length < 2) {
    palette.push([0, 0, 0]);
  }
  return { palette, keyToIndex, transparentIndex: 0, hasTransparent };
}

/** Map a cel's pixels to indices in the exact global palette. */
function indexWithExact(buf: PixelBuffer, exact: ExactPalette, alphaThreshold: number): Uint8Array {
  const d = buf.data;
  const out = new Uint8Array(d.length / CHANNELS);
  for (let p = 0, i = 0; i < d.length; p++, i += CHANNELS) {
    out[p] =
      d[i + 3] < alphaThreshold
        ? exact.transparentIndex
        : (exact.keyToIndex.get(packRgb(d[i], d[i + 1], d[i + 2])) ?? 0);
  }
  return out;
}

function delayFor(cel: GifCel, fps: number): number {
  if (cel.delayMs > 0) {
    return cel.delayMs;
  }
  const f = Number.isFinite(fps) && fps > 0 ? fps : 12;
  return Math.round(1000 / f);
}

/** Scale every cel up front so encoding sees final pixels; validates equal sizes. */
function prepareCels(cels: readonly GifCel[], scale: number): GifCel[] {
  const s = Number.isInteger(scale) && scale >= 1 ? scale : 1;
  const w = cels[0].buffer.w;
  const h = cels[0].buffer.h;
  return cels.map((cel) => {
    if (cel.buffer.w !== w || cel.buffer.h !== h) {
      throw new RangeError('encodeGif: all frames must share the same dimensions.');
    }
    return s === 1 ? cel : { buffer: scaleBufferNearest(cel.buffer, s), delayMs: cel.delayMs };
  });
}

/** Encode the exact-palette path: one global color table, exact per-frame indices. */
function encodeExact(
  gif: ReturnType<typeof GIFEncoder>,
  cels: readonly GifCel[],
  exact: ExactPalette,
  opts: Required<Pick<GifOptions, 'loop' | 'fps' | 'alphaThreshold'>> &
    Pick<GifOptions, 'onProgress'>,
): void {
  const { w, h } = cels[0].buffer;
  cels.forEach((cel, i) => {
    const index = indexWithExact(cel.buffer, exact, opts.alphaThreshold);
    gif.writeFrame(index, w, h, {
      palette: i === 0 ? exact.palette : undefined,
      repeat: i === 0 ? opts.loop : undefined,
      delay: delayFor(cel, opts.fps),
      transparent: exact.hasTransparent,
      transparentIndex: exact.transparentIndex,
      dispose: exact.hasTransparent ? DISPOSE_BACKGROUND : -1,
    });
    opts.onProgress?.(i + 1, cels.length);
  });
}

/** Encode the fallback path: gifenc median-cut quantization, one palette per frame. */
function encodeQuantized(
  gif: ReturnType<typeof GIFEncoder>,
  cels: readonly GifCel[],
  maxColors: number,
  opts: Required<Pick<GifOptions, 'loop' | 'fps'>> & Pick<GifOptions, 'onProgress'>,
): void {
  const { w, h } = cels[0].buffer;
  cels.forEach((cel, i) => {
    const rgba = cel.buffer.data;
    const palette = quantize(rgba, maxColors, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c) => c.length === CHANNELS && c[3] === 0);
    const hasTransparent = transparentIndex >= 0;
    gif.writeFrame(index, w, h, {
      palette,
      repeat: i === 0 ? opts.loop : undefined,
      delay: delayFor(cel, opts.fps),
      transparent: hasTransparent,
      transparentIndex: hasTransparent ? transparentIndex : 0,
      dispose: hasTransparent ? DISPOSE_BACKGROUND : -1,
    });
    opts.onProgress?.(i + 1, cels.length);
  });
}

/**
 * Encode composited cels into an animated GIF89a byte stream. Throws `RangeError`
 * on an empty set or mismatched frame sizes (programmer errors). Pixel-exact for
 * ≤256-color art; falls back to median-cut quantization above that.
 */
export function encodeGif(cels: readonly GifCel[], opts: GifOptions = {}): Uint8Array {
  if (cels.length === 0) {
    throw new RangeError('encodeGif: at least one frame is required.');
  }
  const scaled = prepareCels(cels, opts.scale ?? 1);
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const loop = opts.loop ?? 0;
  const fps = opts.fps ?? 12;
  const gif = GIFEncoder();
  const exact = buildExactPalette(scaled, alphaThreshold);
  if (exact) {
    encodeExact(gif, scaled, exact, { loop, fps, alphaThreshold, onProgress: opts.onProgress });
  } else {
    encodeQuantized(gif, scaled, opts.maxColors ?? MAX_GIF_COLORS, {
      loop,
      fps,
      onProgress: opts.onProgress,
    });
  }
  gif.finish();
  return gif.bytes();
}

/** Composite core {@link Frame}s and encode them as an animated GIF (§5). */
export function encodeGifFromFrames(frames: readonly Frame[], opts: GifOptions = {}): Uint8Array {
  const cels: GifCel[] = frames.map((frame) => ({
    buffer: compositeFrame(frame),
    delayMs: frame.durationMs,
  }));
  return encodeGif(cels, opts);
}

// ─── GIF inspection (pure decoder walk — for tests + previews) ────────────────

/** Skip a run of size-prefixed GIF sub-blocks; return the index after the 0 terminator. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let p = start;
  while (p < bytes.length && bytes[p] !== 0) {
    p += 1 + bytes[p];
  }
  return p + 1;
}

function readNetscapeLoop(bytes: Uint8Array, appDataStart: number): number | null {
  let p = appDataStart;
  let loop: number | null = null;
  while (p < bytes.length && bytes[p] !== 0) {
    const size = bytes[p];
    if (size === 3 && bytes[p + 1] === 1) {
      loop = bytes[p + 2] | (bytes[p + 3] << 8);
    }
    p += 1 + size;
  }
  return loop;
}

/**
 * Walk a GIF byte stream and report its structural facts: version, logical screen
 * size, frame (image-descriptor) count, NETSCAPE loop count, and per-frame delays.
 * Robust to global/local color tables and arbitrary extensions. Throws on a
 * non-GIF signature (programmer error).
 */
export function parseGifInfo(bytes: Uint8Array): GifInfo {
  const version = String.fromCharCode(...bytes.slice(0, 6));
  if (version !== 'GIF89a' && version !== 'GIF87a') {
    throw new RangeError('parseGifInfo: not a GIF byte stream.');
  }
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  const gctSize = packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  let pos = 13 + gctSize;
  let frameCount = 0;
  let loopCount: number | null = null;
  const delaysMs: number[] = [];
  let pendingDelay = 0;

  while (pos < bytes.length) {
    const block = bytes[pos];
    if (block === 0x3b) {
      break;
    }
    if (block === 0x21) {
      const label = bytes[pos + 1];
      if (label === 0xf9) {
        pendingDelay = (bytes[pos + 4] | (bytes[pos + 5] << 8)) * 10;
        pos = skipSubBlocks(bytes, pos + 2);
      } else if (label === 0xff) {
        const appIdEnd = pos + 3 + bytes[pos + 2];
        if (String.fromCharCode(...bytes.slice(pos + 3, pos + 11)) === 'NETSCAPE') {
          loopCount = readNetscapeLoop(bytes, appIdEnd);
        }
        pos = skipSubBlocks(bytes, appIdEnd);
      } else {
        pos = skipSubBlocks(bytes, pos + 2);
      }
    } else if (block === 0x2c) {
      frameCount += 1;
      delaysMs.push(pendingDelay);
      pendingDelay = 0;
      const packedImg = bytes[pos + 9];
      let p = pos + 10;
      if (packedImg & 0x80) {
        p += 3 * 2 ** ((packedImg & 0x07) + 1);
      }
      pos = skipSubBlocks(bytes, p + 1);
    } else {
      pos += 1;
    }
  }
  return { version, width, height, frameCount, loopCount, delaysMs };
}
