import { describe, expect, it } from 'vitest';
import {
  bufferFrom,
  buffersEqual,
  cloneBuffer,
  composite,
  createBuffer,
  dirtyRect,
  fillRectMut,
  getPixel,
  setPixel,
  setPixelMut,
} from './buffer';
import { makeRect } from './rect';
import type { Layer, PixelBuffer, RGBA } from './types';

const layer = (buffer: PixelBuffer, over: Partial<Layer> = {}): Layer => ({
  id: 'l',
  name: 'l',
  visible: true,
  locked: false,
  opacity: 100,
  blend: 'normal',
  buffer,
  ...over,
});

describe('createBuffer', () => {
  it('is fully transparent and correctly sized', () => {
    const b = createBuffer(4, 3);
    expect(b.w).toBe(4);
    expect(b.h).toBe(3);
    expect(b.data.length).toBe(4 * 3 * 4);
    expect(Array.from(b.data).every((v) => v === 0)).toBe(true);
  });

  it('truncates and floors negative dimensions to a valid buffer', () => {
    const b = createBuffer(2.9, -3);
    expect(b.w).toBe(2);
    expect(b.h).toBe(0);
    expect(b.data.length).toBe(0);
  });
});

describe('getPixel / setPixel (immutable)', () => {
  it('sets a pixel on a new buffer and leaves the original intact', () => {
    const b = createBuffer(2, 2);
    const c: RGBA = [255, 106, 26, 255];
    const b2 = setPixel(b, 1, 0, c);
    expect(getPixel(b2, 1, 0)).toEqual(c);
    expect(getPixel(b, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(b2).not.toBe(b);
    expect(b2.data).not.toBe(b.data);
  });

  it('returns transparent for out-of-bounds reads', () => {
    const b = createBuffer(2, 2);
    expect(getPixel(b, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(b, 0, -1)).toEqual([0, 0, 0, 0]);
    expect(getPixel(b, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(b, 0, 2)).toEqual([0, 0, 0, 0]);
  });

  it('treats an out-of-bounds set as a no-op returning an equal buffer', () => {
    const b = setPixel(createBuffer(2, 2), 0, 0, [1, 2, 3, 4]);
    const b2 = setPixel(b, 9, 9, [9, 9, 9, 9]);
    expect(Array.from(b2.data)).toEqual(Array.from(b.data));
  });
});

describe('cloneBuffer / bufferFrom / buffersEqual', () => {
  it('clone is independent and equal', () => {
    const b = setPixel(createBuffer(3, 3), 1, 1, [10, 20, 30, 40]);
    const c = cloneBuffer(b);
    expect(buffersEqual(b, c)).toBe(true);
    expect(c.data).not.toBe(b.data);
    setPixelMut(c, 0, 0, [1, 1, 1, 1]);
    expect(buffersEqual(b, c)).toBe(false);
  });

  it('bufferFrom wraps an existing array without copying', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const b = bufferFrom(2, 2, data);
    expect(b.data).toBe(data);
  });

  it('buffersEqual is false for size mismatch', () => {
    expect(buffersEqual(createBuffer(2, 2), createBuffer(2, 3))).toBe(false);
  });
});

describe('setPixelMut (in-place)', () => {
  it('mutates in place and reports whether it changed', () => {
    const b = createBuffer(2, 2);
    expect(setPixelMut(b, 0, 0, [5, 6, 7, 8])).toBe(true);
    expect(getPixel(b, 0, 0)).toEqual([5, 6, 7, 8]);
    // same value again -> no change
    expect(setPixelMut(b, 0, 0, [5, 6, 7, 8])).toBe(false);
  });

  it('returns false for out-of-bounds writes', () => {
    const b = createBuffer(2, 2);
    expect(setPixelMut(b, -1, 0, [1, 1, 1, 1])).toBe(false);
    expect(setPixelMut(b, 2, 2, [1, 1, 1, 1])).toBe(false);
  });
});

describe('fillRectMut', () => {
  it('fills a clamped rect and returns the written area', () => {
    const b = createBuffer(4, 4);
    const dirty = fillRectMut(b, makeRect(1, 1, 2, 2), [9, 8, 7, 255]);
    expect(dirty).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(getPixel(b, 1, 1)).toEqual([9, 8, 7, 255]);
    expect(getPixel(b, 2, 2)).toEqual([9, 8, 7, 255]);
    expect(getPixel(b, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(b, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('clamps a rect that extends past the edges', () => {
    const b = createBuffer(3, 3);
    const dirty = fillRectMut(b, makeRect(2, 2, 5, 5), [1, 1, 1, 1]);
    expect(dirty).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });

  it('returns null when nothing is in bounds', () => {
    const b = createBuffer(3, 3);
    expect(fillRectMut(b, makeRect(10, 10, 2, 2), [1, 1, 1, 1])).toBeNull();
  });
});

describe('composite', () => {
  it('honors z-order for opaque pixels (later on top)', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const top = setPixel(createBuffer(1, 1), 0, 0, [0, 255, 0, 255]);
    expect(getPixel(composite([layer(bottom), layer(top)]), 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('skips hidden and zero-opacity layers', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const green = setPixel(createBuffer(1, 1), 0, 0, [0, 255, 0, 255]);
    expect(getPixel(composite([layer(bottom), layer(green, { visible: false })]), 0, 0)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(getPixel(composite([layer(bottom), layer(green, { opacity: 0 })]), 0, 0)).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it('lets a transparent top pixel reveal the bottom exactly', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const top = createBuffer(1, 1);
    expect(getPixel(composite([layer(bottom), layer(top)]), 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('blends a 50% opaque white over opaque black to mid grey', () => {
    const black = setPixel(createBuffer(1, 1), 0, 0, [0, 0, 0, 255]);
    const white = setPixel(createBuffer(1, 1), 0, 0, [255, 255, 255, 255]);
    const out = getPixel(composite([layer(black), layer(white, { opacity: 50 })]), 0, 0);
    // effective src alpha 127.5 -> over opaque black -> ~128 grey, full alpha
    expect(out[3]).toBe(255);
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(128);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
  });

  it('composites two semi-transparent layers with correct output alpha', () => {
    const a = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 128]);
    const b = setPixel(createBuffer(1, 1), 0, 0, [0, 0, 255, 128]);
    const out = getPixel(composite([layer(a), layer(b)]), 0, 0);
    // outA = 128 + 128*(1-128/255) ~= 191
    expect(out[3]).toBeGreaterThanOrEqual(190);
    expect(out[3]).toBeLessThanOrEqual(192);
  });

  it('returns a 0x0 buffer for an empty layer list', () => {
    const out = composite([]);
    expect(out.w).toBe(0);
    expect(out.h).toBe(0);
  });

  it('skips a layer whose buffer size does not match the base', () => {
    const base = setPixel(createBuffer(2, 2), 0, 0, [255, 0, 0, 255]);
    const mismatched = setPixel(createBuffer(3, 3), 0, 0, [0, 255, 0, 255]);
    const out = composite([layer(base), layer(mismatched)]);
    expect(out.w).toBe(2);
    expect(getPixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('dirtyRect', () => {
  it('returns null when buffers are identical', () => {
    const b = createBuffer(4, 4);
    expect(dirtyRect(b, b)).toBeNull();
    expect(dirtyRect(b, cloneBuffer(b))).toBeNull();
  });

  it('bounds the changed pixels', () => {
    const b = createBuffer(4, 4);
    const b2 = setPixel(setPixel(b, 1, 1, [1, 2, 3, 4]), 2, 3, [5, 6, 7, 8]);
    expect(dirtyRect(b, b2)).toEqual({ x: 1, y: 1, w: 2, h: 3 });
  });

  it('detects an alpha-only change', () => {
    const b = createBuffer(2, 2);
    const b2 = setPixel(b, 0, 0, [0, 0, 0, 1]);
    expect(dirtyRect(b, b2)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('reports the whole after-buffer when sizes differ', () => {
    expect(dirtyRect(createBuffer(2, 2), createBuffer(3, 4))).toEqual({ x: 0, y: 0, w: 3, h: 4 });
    expect(dirtyRect(createBuffer(2, 2), createBuffer(0, 0))).toBeNull();
  });

  it('works on a non 4-byte-aligned buffer view (byte fallback path)', () => {
    const backing = new Uint8ClampedArray(1 + 2 * 2 * 4);
    const before = bufferFrom(2, 2, backing.subarray(1));
    const after = cloneBuffer(before);
    setPixelMut(after, 1, 1, [3, 3, 3, 3]);
    expect(before.data.byteOffset % 4).not.toBe(0);
    expect(dirtyRect(before, after)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });
});
