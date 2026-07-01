import { describe, expect, it } from 'vitest';
import {
  CORE_MODULE,
  clampCanvasDimension,
  isValidCanvasSize,
  MAX_CANVAS,
  MIN_CANVAS,
} from './index';

describe('core module boundary', () => {
  it('exposes a stable module marker and the canvas cap', () => {
    expect(CORE_MODULE).toBe('pixel-forge/core');
    expect(MAX_CANVAS).toBe(512);
    expect(MIN_CANVAS).toBe(1);
  });
});

describe('clampCanvasDimension', () => {
  it('passes through valid integer dimensions', () => {
    expect(clampCanvasDimension(1)).toBe(1);
    expect(clampCanvasDimension(64)).toBe(64);
    expect(clampCanvasDimension(512)).toBe(512);
  });

  it('clamps below the minimum up to MIN_CANVAS', () => {
    expect(clampCanvasDimension(0)).toBe(MIN_CANVAS);
    expect(clampCanvasDimension(-40)).toBe(MIN_CANVAS);
  });

  it('clamps above the maximum down to MAX_CANVAS', () => {
    expect(clampCanvasDimension(513)).toBe(MAX_CANVAS);
    expect(clampCanvasDimension(4096)).toBe(MAX_CANVAS);
  });

  it('truncates fractional input toward zero', () => {
    expect(clampCanvasDimension(31.9)).toBe(31);
    expect(clampCanvasDimension(1.4)).toBe(1);
  });

  it('collapses non-finite input to MIN_CANVAS', () => {
    expect(clampCanvasDimension(Number.NaN)).toBe(MIN_CANVAS);
    expect(clampCanvasDimension(Number.POSITIVE_INFINITY)).toBe(MIN_CANVAS);
  });
});

describe('isValidCanvasSize', () => {
  it('accepts sizes inside the bounds', () => {
    expect(isValidCanvasSize(1, 1)).toBe(true);
    expect(isValidCanvasSize(512, 512)).toBe(true);
    expect(isValidCanvasSize(160, 144)).toBe(true);
  });

  it('rejects out-of-range or non-integer sizes', () => {
    expect(isValidCanvasSize(0, 10)).toBe(false);
    expect(isValidCanvasSize(10, 513)).toBe(false);
    expect(isValidCanvasSize(10.5, 10)).toBe(false);
    expect(isValidCanvasSize(Number.NaN, 10)).toBe(false);
  });
});
