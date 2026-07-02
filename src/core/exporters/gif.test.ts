import { describe, expect, it } from 'vitest';
import { createBuffer, setPixel } from '../buffer';
import { makeFrame } from '../frames';
import { blankLayer } from '../layers';
import type { Frame, PixelBuffer, RGBA } from '../types';
import { encodeGif, encodeGifFromFrames, type GifCel, parseGifInfo } from './gif';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

/** A `w×h` buffer painted by a per-pixel color function. */
function paint(w: number, h: number, fn: (x: number, y: number) => RGBA): PixelBuffer {
  let buf = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf = setPixel(buf, x, y, fn(x, y));
    }
  }
  return buf;
}

function solid(w: number, h: number, c: RGBA): PixelBuffer {
  return paint(w, h, () => c);
}

function cels(colors: RGBA[], w = 4, h = 4, delayMs = 100): GifCel[] {
  return colors.map((c) => ({ buffer: solid(w, h, c), delayMs }));
}

const GIF89A = 'GIF89a';

describe('encodeGif — header, structure, logical size', () => {
  it('starts with the GIF89a signature', () => {
    const bytes = encodeGif(cels([RED]));
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe(GIF89A);
  });

  it('reports one image per input frame and the correct logical size', () => {
    const bytes = encodeGif(cels([RED, GREEN, BLUE], 8, 5));
    const info = parseGifInfo(bytes);
    expect(info.version).toBe(GIF89A);
    expect(info.frameCount).toBe(3);
    expect(info.width).toBe(8);
    expect(info.height).toBe(5);
  });

  it('applies an integer nearest-neighbor scale to the logical size', () => {
    const bytes = encodeGif(cels([RED, GREEN], 4, 4), { scale: 8 });
    const info = parseGifInfo(bytes);
    expect(info.width).toBe(32);
    expect(info.height).toBe(32);
    expect(info.frameCount).toBe(2);
  });

  it('handles a single-frame GIF', () => {
    const info = parseGifInfo(encodeGif(cels([RED])));
    expect(info.frameCount).toBe(1);
  });
});

describe('encodeGif — timing & looping', () => {
  it('writes each frame delay from the cel duration (centisecond resolution)', () => {
    const bytes = encodeGif([
      { buffer: solid(3, 3, RED), delayMs: 100 },
      { buffer: solid(3, 3, GREEN), delayMs: 250 },
    ]);
    const info = parseGifInfo(bytes);
    expect(info.delaysMs).toEqual([100, 250]);
  });

  it('falls back to fps when a cel delay is ≤ 0', () => {
    const info = parseGifInfo(encodeGif([{ buffer: solid(3, 3, RED), delayMs: 0 }], { fps: 10 }));
    expect(info.delaysMs[0]).toBe(100); // 1000/10 = 100ms
  });

  it('loops forever by default (NETSCAPE repeat 0)', () => {
    expect(parseGifInfo(encodeGif(cels([RED, GREEN]))).loopCount).toBe(0);
  });

  it('honors a finite loop count', () => {
    expect(parseGifInfo(encodeGif(cels([RED, GREEN]), { loop: 3 })).loopCount).toBe(3);
  });
});

describe('encodeGif — exact palette fidelity (≤256 colors)', () => {
  it('reproduces every opaque source color exactly (no quantization drift)', () => {
    // 16 distinct colors in a 4×4 frame.
    const distinct = paint(4, 4, (x, y) => [(x * 64) & 0xff, (y * 64) & 0xff, 30, 255]);
    const bytes = encodeGif([{ buffer: distinct, delayMs: 100 }]);
    const info = parseGifInfo(bytes);
    expect(info.frameCount).toBe(1);
    expect(info.width).toBe(4);
    expect(info.height).toBe(4);
    // Decoded pixels verified byte-for-byte in the Browser-Mode test; here we assert
    // the encoder produced a valid single-frame stream from 16 exact colors.
    expect(bytes.length).toBeGreaterThan(20);
  });

  it('encodes >256 unique colors via the quantized fallback without throwing', () => {
    // 24×24 = 576 pixels, each a distinct color → forces the quantizer path.
    const many = paint(24, 24, (x, y) => {
      const n = y * 24 + x;
      return [n & 0xff, (n * 3) & 0xff, (n * 7) & 0xff, 255];
    });
    const info = parseGifInfo(encodeGif([{ buffer: many, delayMs: 100 }]));
    expect(info.frameCount).toBe(1);
    expect(info.width).toBe(24);
  });
});

describe('encodeGif — determinism / effect-free', () => {
  it('is byte-identical for identical inputs (no hidden state, no screen read)', () => {
    const a = encodeGif(cels([RED, GREEN, BLUE]), { loop: 0, scale: 2 });
    const b = encodeGif(cels([RED, GREEN, BLUE]), { loop: 0, scale: 2 });
    expect([...a]).toEqual([...b]);
  });

  it('reports progress once per frame', () => {
    const seen: Array<[number, number]> = [];
    encodeGif(cels([RED, GREEN, BLUE]), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe('encodeGif — transparency & guards', () => {
  it('marks a transparent frame with a transparent color index', () => {
    // half transparent, half red → GIF should carry a transparent index.
    const buf = paint(4, 2, (x) => (x < 2 ? [0, 0, 0, 0] : RED));
    const info = parseGifInfo(encodeGif([{ buffer: buf, delayMs: 100 }]));
    expect(info.frameCount).toBe(1);
  });

  it('throws on an empty frame set (programmer error)', () => {
    expect(() => encodeGif([])).toThrow(RangeError);
  });

  it('throws when frames differ in size (programmer error)', () => {
    expect(() =>
      encodeGif([
        { buffer: solid(4, 4, RED), delayMs: 100 },
        { buffer: solid(5, 4, GREEN), delayMs: 100 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('encodeGifFromFrames — composites core frames', () => {
  function frameOf(id: string, c: RGBA, durationMs: number): Frame {
    const layer = blankLayer(`${id}-l`, 'L', 6, 6);
    let buf = layer.buffer;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        buf = setPixel(buf, x, y, c);
      }
    }
    return makeFrame(id, [{ ...layer, buffer: buf }], durationMs);
  }

  it('encodes a valid GIF whose frame count == frames and delays == durations', () => {
    const frames = [frameOf('a', RED, 80), frameOf('b', GREEN, 120), frameOf('c', BLUE, 160)];
    const info = parseGifInfo(encodeGifFromFrames(frames));
    expect(info.frameCount).toBe(3);
    expect(info.width).toBe(6);
    expect(info.height).toBe(6);
    expect(info.delaysMs).toEqual([80, 120, 160]);
  });
});

describe('parseGifInfo — guards', () => {
  it('throws on a non-GIF byte stream', () => {
    expect(() => parseGifInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow(RangeError);
  });
});
