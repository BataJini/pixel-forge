import { describe, expect, it } from 'vitest';
import {
  addRect,
  computeBounds,
  createSelection,
  isSelectionEmpty,
  selectAll,
  selectionContains,
  selectRect,
  subtractRect,
} from './selection';

describe('createSelection / selectAll', () => {
  it('starts empty', () => {
    const sel = createSelection(4, 4);
    expect(isSelectionEmpty(sel)).toBe(true);
    expect(sel.mask.every((v) => v === 0)).toBe(true);
    expect(selectionContains(sel, 1, 1)).toBe(false);
  });

  it('selectAll covers the whole canvas', () => {
    const sel = selectAll(3, 2);
    expect(isSelectionEmpty(sel)).toBe(false);
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(sel.mask.every((v) => v === 1)).toBe(true);
    expect(selectionContains(sel, 2, 1)).toBe(true);
  });
});

describe('selectRect', () => {
  it('selects a rectangle and reports tight bounds', () => {
    const sel = selectRect(8, 8, { x: 2, y: 3, w: 3, h: 2 });
    expect(sel.bounds).toEqual({ x: 2, y: 3, w: 3, h: 2 });
    expect(selectionContains(sel, 2, 3)).toBe(true);
    expect(selectionContains(sel, 4, 4)).toBe(true);
    expect(selectionContains(sel, 5, 3)).toBe(false); // just outside
    expect(selectionContains(sel, 1, 3)).toBe(false);
  });

  it('clamps a rect that extends beyond the canvas', () => {
    const sel = selectRect(4, 4, { x: 2, y: 2, w: 10, h: 10 });
    expect(sel.bounds).toEqual({ x: 2, y: 2, w: 2, h: 2 });
  });

  it('is immutable — a fresh mask each call', () => {
    const a = selectRect(4, 4, { x: 0, y: 0, w: 2, h: 2 });
    const b = addRect(a, { x: 2, y: 2, w: 2, h: 2 });
    expect(a.mask).not.toBe(b.mask);
    expect(selectionContains(a, 3, 3)).toBe(false);
    expect(selectionContains(b, 3, 3)).toBe(true);
  });
});

describe('addRect / subtractRect', () => {
  it('adds a disjoint rectangle and unions the bounds', () => {
    let sel = selectRect(8, 8, { x: 0, y: 0, w: 2, h: 2 });
    sel = addRect(sel, { x: 5, y: 5, w: 2, h: 2 });
    expect(selectionContains(sel, 0, 0)).toBe(true);
    expect(selectionContains(sel, 6, 6)).toBe(true);
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 7, h: 7 });
  });

  it('subtracts a rectangle and shrinks the bounds', () => {
    let sel = selectRect(6, 6, { x: 0, y: 0, w: 6, h: 6 });
    sel = subtractRect(sel, { x: 0, y: 0, w: 6, h: 3 });
    expect(selectionContains(sel, 0, 0)).toBe(false);
    expect(selectionContains(sel, 0, 3)).toBe(true);
    expect(sel.bounds).toEqual({ x: 0, y: 3, w: 6, h: 3 });
  });

  it('subtracting everything returns an empty selection', () => {
    let sel = selectAll(4, 4);
    sel = subtractRect(sel, { x: 0, y: 0, w: 4, h: 4 });
    expect(isSelectionEmpty(sel)).toBe(true);
  });
});

describe('computeBounds', () => {
  it('is empty for an all-zero mask', () => {
    expect(computeBounds(new Uint8Array(9), 3, 3)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('finds the tight box of set pixels', () => {
    const mask = new Uint8Array(16);
    mask[1 * 4 + 1] = 1;
    mask[2 * 4 + 3] = 1;
    expect(computeBounds(mask, 4, 4)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });
});
