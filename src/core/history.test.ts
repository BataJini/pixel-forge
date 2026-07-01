import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from './buffer';
import {
  applyListEdit,
  applyPatch,
  capByBudget,
  DEFAULT_HISTORY_DEPTH,
  DEFAULT_HISTORY_MAX_BYTES,
  invertPatch,
  type ListEdit,
  makePatch,
  patchByteSize,
} from './history';
import type { RGBA } from './types';

const ORANGE: RGBA = [255, 106, 26, 255];
const BLUE: RGBA = [0, 0, 255, 255];

describe('makePatch', () => {
  it('returns null when nothing changed', () => {
    const b = createBuffer(4, 4);
    expect(makePatch('l', 'f', b, b)).toBeNull();
    expect(makePatch('l', 'f', b, createBuffer(4, 4))).toBeNull();
  });

  it('captures the tight dirty sub-rect and its before/after bytes', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(setPixel(before, 2, 2, ORANGE), 5, 6, BLUE);
    const patch = makePatch('layer-1', 'frame-1', before, after);
    expect(patch).not.toBeNull();
    if (!patch) return;
    expect(patch.layerId).toBe('layer-1');
    expect(patch.frameId).toBe('frame-1');
    // Bounding box of (2,2)-(5,6) is x2 y2 w4 h5.
    expect(patch.rect).toEqual({ x: 2, y: 2, w: 4, h: 5 });
    expect(patch.before.length).toBe(4 * 5 * 4);
    expect(patch.after.length).toBe(4 * 5 * 4);
  });

  it('stores only the dirty sub-rect, never the whole buffer', () => {
    const before = createBuffer(128, 128);
    const after = setPixel(before, 64, 64, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    expect(patch).not.toBeNull();
    if (!patch) return;
    // one 1px change carries 1*1*4 bytes each way, not 128*128*4.
    expect(patch.before.length).toBe(4);
    expect(patch.after.length).toBe(4);
    expect(JSON.stringify(patch).length).toBeLessThan(128 * 128 * 4);
  });

  it('freezes the returned patch (immutable command)', () => {
    const before = createBuffer(4, 4);
    const after = setPixel(before, 1, 1, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    expect(patch).not.toBeNull();
    if (!patch) return;
    expect(Object.isFrozen(patch)).toBe(true);
  });
});

describe('applyPatch', () => {
  it('undo restores the before-buffer exactly and does not mutate the input', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(setPixel(before, 2, 2, ORANGE), 3, 5, BLUE);
    const patch = makePatch('l', 'f', before, after);
    if (!patch) throw new Error('expected patch');
    const undone = applyPatch(after, patch, 'undo');
    expect(Array.from(undone.data)).toEqual(Array.from(before.data));
    expect(undone).not.toBe(after);
    // input unchanged
    expect(getPixel(after, 2, 2)).toEqual(ORANGE);
  });

  it('redo restores the after-buffer exactly', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(before, 4, 4, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    if (!patch) throw new Error('expected patch');
    const undone = applyPatch(after, patch, 'undo');
    const redone = applyPatch(undone, patch, 'redo');
    expect(Array.from(redone.data)).toEqual(Array.from(after.data));
    expect(getPixel(redone, 4, 4)).toEqual(ORANGE);
  });

  it('round-trips undo then redo back to after for a large diagonal edit', () => {
    const before = createBuffer(32, 32);
    let after = before;
    for (let i = 0; i < 32; i++) after = setPixel(after, i, i, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    if (!patch) throw new Error('expected patch');
    const rt = applyPatch(applyPatch(after, patch, 'undo'), patch, 'redo');
    expect(Array.from(rt.data)).toEqual(Array.from(after.data));
  });

  it('is bounds-safe against a smaller target buffer (never throws / OOB)', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(before, 7, 7, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    if (!patch) throw new Error('expected patch');
    const smaller = createBuffer(4, 4);
    // The patch rect (7,7) lies outside the 4x4 buffer — apply is a safe no-op copy.
    const out = applyPatch(smaller, patch, 'undo');
    expect(out.w).toBe(4);
    expect(Array.from(out.data)).toEqual(Array.from(smaller.data));
  });
});

describe('invertPatch', () => {
  it('swaps before/after so applying the inverse undoes the original redo', () => {
    const before = createBuffer(6, 6);
    const after = setPixel(before, 3, 3, ORANGE);
    const patch = makePatch('l', 'f', before, after);
    if (!patch) throw new Error('expected patch');
    const inv = invertPatch(patch);
    expect(inv.before).toBe(patch.after);
    expect(inv.after).toBe(patch.before);
    // redo of the inverse == undo of the original.
    const viaInverse = applyPatch(after, inv, 'redo');
    const viaOriginal = applyPatch(after, patch, 'undo');
    expect(Array.from(viaInverse.data)).toEqual(Array.from(viaOriginal.data));
  });
});

describe('patchByteSize', () => {
  it('grows with the dirty area and stays tiny for a 1px edit at 512x512', () => {
    const big = createBuffer(512, 512);
    const onePx = makePatch('l', 'f', big, setPixel(big, 256, 256, ORANGE));
    if (!onePx) throw new Error('expected patch');
    // A single-pixel edit must never approach the 1MB full-buffer size.
    expect(patchByteSize(onePx)).toBeLessThan(1024);

    const before = createBuffer(16, 16);
    let after = before;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) after = setPixel(after, x, y, ORANGE);
    const full = makePatch('l', 'f', before, after);
    if (!full) throw new Error('expected patch');
    expect(patchByteSize(full)).toBeGreaterThan(patchByteSize(onePx));
  });
});

describe('applyListEdit (structural reversible list algebra)', () => {
  const base = ['a', 'b', 'c', 'd'];

  const roundTrip = (edit: ListEdit<string>): void => {
    const { next, inverse } = applyListEdit(base, edit);
    const back = applyListEdit(next, inverse);
    expect(back.next).toEqual(base);
  };

  it('insert adds items and inverts to a remove', () => {
    const { next, inverse } = applyListEdit(base, { type: 'insert', index: 2, items: ['x', 'y'] });
    expect(next).toEqual(['a', 'b', 'x', 'y', 'c', 'd']);
    expect(inverse).toEqual({ type: 'remove', index: 2, count: 2 });
    roundTrip({ type: 'insert', index: 2, items: ['x', 'y'] });
    roundTrip({ type: 'insert', index: 0, items: ['x'] });
    roundTrip({ type: 'insert', index: 4, items: ['z'] });
  });

  it('remove deletes items and inverts to an insert that restores them', () => {
    const { next, inverse } = applyListEdit(base, { type: 'remove', index: 1, count: 2 });
    expect(next).toEqual(['a', 'd']);
    expect(inverse).toEqual({ type: 'insert', index: 1, items: ['b', 'c'] });
    roundTrip({ type: 'remove', index: 1, count: 2 });
    roundTrip({ type: 'remove', index: 0, count: 1 });
    roundTrip({ type: 'remove', index: 3, count: 1 });
  });

  it('move reorders and inverts to the reverse move', () => {
    const { next, inverse } = applyListEdit(base, { type: 'move', from: 0, to: 2 });
    expect(next).toEqual(['b', 'c', 'a', 'd']);
    expect(inverse).toEqual({ type: 'move', from: 2, to: 0 });
    roundTrip({ type: 'move', from: 0, to: 2 });
    roundTrip({ type: 'move', from: 3, to: 0 });
    roundTrip({ type: 'move', from: 1, to: 1 });
  });

  it('replace swaps one item and inverts to restore the previous item', () => {
    const { next, inverse } = applyListEdit(base, { type: 'replace', index: 1, item: 'B' });
    expect(next).toEqual(['a', 'B', 'c', 'd']);
    expect(inverse).toEqual({ type: 'replace', index: 1, item: 'b' });
    roundTrip({ type: 'replace', index: 1, item: 'B' });
  });

  it('does not mutate the input list', () => {
    const input = ['a', 'b', 'c'];
    applyListEdit(input, { type: 'remove', index: 0, count: 1 });
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('move on a 0- or 1-element list is a safe no-op (no undefined leaks)', () => {
    expect(applyListEdit([], { type: 'move', from: 0, to: 1 }).next).toEqual([]);
    expect(applyListEdit(['only'], { type: 'move', from: 0, to: 3 }).next).toEqual(['only']);
  });

  it('replace into an empty list degenerates to an insert that inverts to remove', () => {
    const { next, inverse } = applyListEdit<string>([], { type: 'replace', index: 0, item: 'z' });
    expect(next).toEqual(['z']);
    expect(applyListEdit(next, inverse).next).toEqual([]);
  });

  it('clamps out-of-range indices instead of producing holes', () => {
    const { next } = applyListEdit(['a', 'b'], { type: 'insert', index: 99, items: ['c'] });
    expect(next).toEqual(['a', 'b', 'c']);
    const removed = applyListEdit(['a', 'b'], { type: 'remove', index: 5, count: 3 });
    expect(removed.next).toEqual(['a', 'b']);
  });
});

describe('capByBudget (depth + byte eviction, oldest dropped)', () => {
  const entries = (bytesEach: number, n: number): { id: number; bytes: number }[] =>
    Array.from({ length: n }, (_, i) => ({ id: i, bytes: bytesEach }));

  it('drops the oldest entries beyond the depth cap, keeping newest', () => {
    const { kept, dropped } = capByBudget(entries(10, 5), 3, Number.POSITIVE_INFINITY);
    expect(kept.map((e) => e.id)).toEqual([2, 3, 4]);
    expect(dropped.map((e) => e.id)).toEqual([0, 1]);
  });

  it('drops the oldest entries beyond the byte budget', () => {
    const { kept } = capByBudget(entries(100, 5), 100, 250);
    // keep newest until <= 250 bytes: entries 4,3 (200) fit; adding 2 → 300 > 250.
    expect(kept.map((e) => e.id)).toEqual([3, 4]);
  });

  it('always keeps at least the newest entry even if it exceeds the byte budget', () => {
    const { kept } = capByBudget(entries(1000, 3), 100, 250);
    expect(kept.map((e) => e.id)).toEqual([2]);
  });

  it('returns the stack unchanged when within both caps', () => {
    const input = entries(10, 3);
    const { kept, dropped } = capByBudget(input, 100, 1000);
    expect(kept).toEqual(input);
    expect(dropped).toEqual([]);
  });
});

describe('history defaults', () => {
  it('match the spec (depth 100, ~64MB)', () => {
    expect(DEFAULT_HISTORY_DEPTH).toBe(100);
    expect(DEFAULT_HISTORY_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});
