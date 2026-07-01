// Held-out acceptance — U-003 canvas engine core. Builder must NOT edit.
// Targets the exact contracts in master-spec §5. Runner: Vitest.
import { describe, it, expect } from 'vitest';
import { hexToRgba, rgbaToHex } from '../../../src/core/color';
import {
  createBuffer, getPixel, setPixel, composite, dirtyRect,
} from '../../../src/core/buffer';
import type { Layer, PixelBuffer, RGBA } from '../../../src/core/types';

const layer = (buffer: PixelBuffer, over: Partial<Layer> = {}): Layer => ({
  id: 'l', name: 'l', visible: true, locked: false, opacity: 100,
  blend: 'normal', buffer, ...over,
});

describe('color round-trip', () => {
  it('rgbaToHex/hexToRgba round-trips opaque colors', () => {
    const c: RGBA = [255, 106, 26, 255];
    expect(hexToRgba(rgbaToHex(c))).toEqual(c);
    expect(rgbaToHex([0, 0, 0, 255])).toBe('#000000');
    expect(rgbaToHex([255, 255, 255, 255])).toBe('#FFFFFF');
  });
  it('preserves alpha when requested', () => {
    const c: RGBA = [18, 16, 14, 128];
    expect(hexToRgba(rgbaToHex(c, true))).toEqual(c);
  });
});

describe('buffer create/get/set', () => {
  it('creates a fully transparent buffer', () => {
    const b = createBuffer(4, 3);
    expect(b.w).toBe(4); expect(b.h).toBe(3);
    expect(b.data.length).toBe(4 * 3 * 4);
    expect(getPixel(b, 0, 0)).toEqual([0, 0, 0, 0]);
  });
  it('setPixel is immutable and returns the new color', () => {
    const b = createBuffer(2, 2);
    const c: RGBA = [255, 106, 26, 255];
    const b2 = setPixel(b, 1, 0, c);
    expect(getPixel(b2, 1, 0)).toEqual(c);
    // original unchanged
    expect(getPixel(b, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(b2).not.toBe(b);
  });
  it('out-of-bounds get returns transparent and set is a no-op', () => {
    const b = createBuffer(2, 2);
    expect(getPixel(b, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(b, 5, 5)).toEqual([0, 0, 0, 0]);
    const b2 = setPixel(b, 9, 9, [1, 2, 3, 4]);
    expect(Array.from(b2.data)).toEqual(Array.from(b.data));
  });
});

describe('composite', () => {
  it('honors z-order (later layer on top) for opaque pixels', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const top = setPixel(createBuffer(1, 1), 0, 0, [0, 255, 0, 255]);
    const out = composite([layer(bottom), layer(top)]);
    expect(getPixel(out, 0, 0)).toEqual([0, 255, 0, 255]);
  });
  it('skips hidden layers', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const top = setPixel(createBuffer(1, 1), 0, 0, [0, 255, 0, 255]);
    const out = composite([layer(bottom), layer(top, { visible: false })]);
    expect(getPixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
  });
  it('lets a transparent top pixel reveal the bottom', () => {
    const bottom = setPixel(createBuffer(1, 1), 0, 0, [255, 0, 0, 255]);
    const top = createBuffer(1, 1); // fully transparent
    const out = composite([layer(bottom), layer(top)]);
    expect(getPixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('dirtyRect', () => {
  it('returns null when buffers are identical', () => {
    const b = createBuffer(4, 4);
    expect(dirtyRect(b, b)).toBeNull();
  });
  it('bounds the changed pixels', () => {
    const b = createBuffer(4, 4);
    const b2 = setPixel(setPixel(b, 1, 1, [1, 2, 3, 4]), 2, 3, [5, 6, 7, 8]);
    expect(dirtyRect(b, b2)).toEqual({ x: 1, y: 1, w: 2, h: 3 });
  });
});
