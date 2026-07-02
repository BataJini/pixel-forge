/**
 * src/core/layers.test.ts — unit tests for the pure layer-stack ops (U-007).
 *
 * Mirrors and expands the held-out acceptance suite (docs/acceptance/U-007): the
 * composite semantics AND the management ops (add/duplicate/delete/rename/lock/
 * reorder) plus their immutability and edge cases (delete-last guard, out-of-range
 * no-ops, opacity clamping, buffer sharing vs. deep-copy).
 */
import { describe, expect, it } from 'vitest';
import { composite, createBuffer, getPixel, setPixel } from './buffer';
import {
  blankLayer,
  canDeleteLayer,
  clampOpacity,
  deleteLayer,
  duplicateLayer,
  flatten,
  insertLayer,
  MAX_OPACITY,
  makeLayer,
  mergeDown,
  moveLayer,
  setBlend,
  setLocked,
  setName,
  setOpacity,
  setVisible,
} from './layers';
import type { Layer, PixelBuffer, RGBA } from './types';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const W = 4;
const H = 4;

const mk = (id: string, buffer: PixelBuffer, over: Partial<Layer> = {}): Layer =>
  makeLayer(id, id, buffer, over);
const paint = (x: number, y: number, c: RGBA): PixelBuffer => setPixel(createBuffer(W, H), x, y, c);
const bytes = (b: PixelBuffer): number[] => Array.from(b.data);

describe('clampOpacity', () => {
  it('rounds and clamps into 0..100', () => {
    expect(clampOpacity(-5)).toBe(0);
    expect(clampOpacity(0)).toBe(0);
    expect(clampOpacity(49.4)).toBe(49);
    expect(clampOpacity(49.6)).toBe(50);
    expect(clampOpacity(100)).toBe(100);
    expect(clampOpacity(250)).toBe(100);
  });
  it('non-finite collapses to fully opaque', () => {
    expect(clampOpacity(Number.NaN)).toBe(MAX_OPACITY);
    expect(clampOpacity(Number.POSITIVE_INFINITY)).toBe(MAX_OPACITY);
  });
});

describe('constructors', () => {
  it('blankLayer is a fully transparent, visible, unlocked, 100% normal layer', () => {
    const l = blankLayer('a', 'Layer 1', W, H);
    expect(l).toMatchObject({
      id: 'a',
      name: 'Layer 1',
      visible: true,
      locked: false,
      opacity: 100,
      blend: 'normal',
    });
    expect(l.buffer.w).toBe(W);
    expect(l.buffer.h).toBe(H);
    expect(Array.from(l.buffer.data).every((v) => v === 0)).toBe(true);
  });
  it('makeLayer applies overrides but never lets over clobber the buffer', () => {
    const buf = paint(0, 0, RED);
    const l = makeLayer('b', 'B', buf, { visible: false, opacity: 40, locked: true });
    expect(l).toMatchObject({ visible: false, opacity: 40, locked: true });
    expect(l.buffer).toBe(buf);
  });
});

describe('metadata setters are immutable and buffer-preserving', () => {
  const stack = [mk('bottom', paint(1, 1, RED)), mk('top', paint(1, 1, BLUE))];

  it('setVisible does not mutate the input and shares buffers', () => {
    const next = setVisible(stack, 1, false);
    expect(next).not.toBe(stack);
    expect(stack[1].visible).toBe(true); // input untouched
    expect(next[1].visible).toBe(false);
    expect(next[1].buffer).toBe(stack[1].buffer); // pixels shared (metadata edit)
    expect(next[0]).toBe(stack[0]); // untouched layer is the same object
  });

  it('setLocked / setName / setBlend patch only the target', () => {
    expect(setLocked(stack, 0, true)[0].locked).toBe(true);
    expect(setName(stack, 0, 'Base')[0].name).toBe('Base');
    expect(setBlend(stack, 1, 'multiply')[1].blend).toBe('multiply');
    expect(stack[0].locked).toBe(false); // originals untouched
  });

  it('setOpacity clamps and rounds', () => {
    expect(setOpacity(stack, 1, 250)[1].opacity).toBe(100);
    expect(setOpacity(stack, 1, -3)[1].opacity).toBe(0);
    expect(setOpacity(stack, 1, 33.7)[1].opacity).toBe(34);
  });

  it('out-of-range index is a safe no-op copy', () => {
    const next = setVisible(stack, 9, false);
    expect(next).not.toBe(stack);
    expect(next.map((l) => l.visible)).toEqual([true, true]);
  });
});

describe('composite semantics (mirrors held-out acceptance)', () => {
  it('hiding removes pixels; showing restores', () => {
    const stack = [mk('bottom', paint(1, 1, RED)), mk('top', paint(1, 1, BLUE))];
    expect(getPixel(composite(stack), 1, 1)).toEqual(BLUE);
    const hidden = setVisible(stack, 1, false);
    expect(getPixel(composite(hidden), 1, 1)).toEqual(RED);
    expect(getPixel(composite(setVisible(hidden, 1, true)), 1, 1)).toEqual(BLUE);
  });

  it('reordering changes which opaque pixel wins', () => {
    const A = mk('A', paint(2, 2, RED));
    const B = mk('B', paint(2, 2, BLUE));
    expect(getPixel(composite([A, B]), 2, 2)).toEqual(BLUE);
    expect(getPixel(composite(moveLayer([A, B], 1, 0)), 2, 2)).toEqual(RED);
  });

  it('opacity scales contribution (0 invisible, 100 full)', () => {
    const stack = [mk('bottom', paint(1, 1, RED)), mk('top', paint(1, 1, BLUE))];
    expect(getPixel(composite(setOpacity(stack, 1, 0)), 1, 1)).toEqual(RED);
    expect(getPixel(composite(setOpacity(stack, 1, 100)), 1, 1)).toEqual(BLUE);
  });
});

describe('moveLayer', () => {
  it('is a no-op copy for 0/1-length stacks and identical indices', () => {
    expect(moveLayer([], 0, 0)).toEqual([]);
    const one = [mk('a', createBuffer(W, H))];
    expect(moveLayer(one, 0, 0)).not.toBe(one);
    const two = [mk('a', createBuffer(W, H)), mk('b', createBuffer(W, H))];
    expect(moveLayer(two, 1, 1).map((l) => l.id)).toEqual(['a', 'b']);
  });
  it('clamps out-of-range indices', () => {
    const s = [
      mk('a', createBuffer(W, H)),
      mk('b', createBuffer(W, H)),
      mk('c', createBuffer(W, H)),
    ];
    expect(moveLayer(s, 0, 99).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(moveLayer(s, -5, 2).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('insert / duplicate / delete', () => {
  const base = [mk('a', paint(0, 0, RED)), mk('b', paint(1, 1, BLUE))];

  it('insertLayer clamps and never mutates', () => {
    const l = blankLayer('new', 'New', W, H);
    expect(insertLayer(base, 0, l).map((x) => x.id)).toEqual(['new', 'a', 'b']);
    expect(insertLayer(base, 99, l).map((x) => x.id)).toEqual(['a', 'b', 'new']);
    expect(base.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('duplicateLayer deep-copies pixels and inserts above the source', () => {
    const next = duplicateLayer(base, 0, 'a2');
    expect(next.map((x) => x.id)).toEqual(['a', 'a2', 'b']);
    const copy = next[1];
    expect(copy.name).toBe('a copy');
    expect(copy.locked).toBe(false);
    expect(bytes(copy.buffer)).toEqual(bytes(base[0].buffer));
    expect(copy.buffer).not.toBe(base[0].buffer); // independent backing array
    // Mutating the copy's buffer must not bleed into the source.
    copy.buffer.data[0] = 9;
    expect(base[0].buffer.data[0]).not.toBe(9);
  });

  it('duplicateLayer out-of-range is a no-op copy', () => {
    expect(duplicateLayer(base, 5, 'x').map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('deleteLayer removes the target but protects the last layer', () => {
    expect(canDeleteLayer(base)).toBe(true);
    expect(deleteLayer(base, 0).map((x) => x.id)).toEqual(['b']);
    const single = [mk('only', createBuffer(W, H))];
    expect(canDeleteLayer(single)).toBe(false);
    expect(deleteLayer(single, 0).map((x) => x.id)).toEqual(['only']); // refused
    expect(deleteLayer(base, 9).map((x) => x.id)).toEqual(['a', 'b']); // out-of-range
  });
});

describe('mergeDown', () => {
  it('merges the upper layer onto the one below and equals compositing the pair', () => {
    const A = mk('A', paint(0, 0, RED));
    const B = mk('B', paint(3, 3, BLUE));
    const merged = mergeDown([A, B], 1);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('A'); // keeps the lower layer's identity
    expect(merged[0].opacity).toBe(100);
    expect(merged[0].visible).toBe(true);
    expect(bytes(composite(merged))).toEqual(bytes(composite([A, B])));
  });

  it('bakes opacity/visibility of the pair into the merged buffer', () => {
    const A = mk('A', paint(1, 1, RED));
    const B = mk('B', paint(1, 1, BLUE), { opacity: 0 });
    // B at 0% contributes nothing, so the merge should show A only.
    expect(getPixel(composite(mergeDown([A, B], 1)), 1, 1)).toEqual(RED);
  });

  it('is a no-op for the bottom layer or out-of-range', () => {
    const s = [mk('A', createBuffer(W, H)), mk('B', createBuffer(W, H))];
    expect(mergeDown(s, 0).map((l) => l.id)).toEqual(['A', 'B']);
    expect(mergeDown(s, 9).map((l) => l.id)).toEqual(['A', 'B']);
  });
});

describe('flatten', () => {
  it('collapses to one layer equal to the full composite', () => {
    const stack = [
      mk('A', paint(0, 0, RED)),
      mk('B', paint(3, 3, BLUE)),
      mk('C', paint(1, 1, GREEN)),
    ];
    const flat = flatten(stack);
    expect(flat.length).toBe(1);
    expect(flat[0].opacity).toBe(100);
    expect(flat[0].visible).toBe(true);
    expect(flat[0].locked).toBe(false);
    expect(bytes(flat[0].buffer)).toEqual(bytes(composite(stack)));
  });

  it('respects hidden layers when flattening', () => {
    const stack = [mk('A', paint(1, 1, RED)), mk('B', paint(1, 1, BLUE), { visible: false })];
    expect(getPixel(flatten(stack)[0].buffer, 1, 1)).toEqual(RED);
  });

  it('empty stack stays empty; re-flatten is idempotent', () => {
    expect(flatten([])).toEqual([]);
    const one = flatten([mk('A', paint(2, 2, RED))]);
    expect(bytes(flatten(one)[0].buffer)).toEqual(bytes(one[0].buffer));
  });
});
