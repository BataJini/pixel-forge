// Held-out acceptance — U-006 history. Builder must NOT edit.
// Targets master-spec §5 history.ts. Runner: Vitest.
import { describe, it, expect } from 'vitest';
import { createBuffer, setPixel, getPixel } from '../../../src/core/buffer';
import { makePatch, applyPatch } from '../../../src/core/history';
import type { RGBA } from '../../../src/core/types';

const C: RGBA = [255, 106, 26, 255];

describe('dirty-rect patch undo/redo', () => {
  it('undo restores the before-buffer exactly', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(setPixel(before, 2, 2, C), 3, 5, [0, 0, 255, 255]);
    const patch = makePatch('l1', 'f1', before, after);
    expect(patch).not.toBeNull();
    const undone = applyPatch(after, patch!, 'undo');
    expect(Array.from(undone.data)).toEqual(Array.from(before.data));
  });

  it('redo restores the after-buffer exactly', () => {
    const before = createBuffer(8, 8);
    const after = setPixel(before, 4, 4, C);
    const patch = makePatch('l1', 'f1', before, after)!;
    const undone = applyPatch(after, patch, 'undo');
    const redone = applyPatch(undone, patch, 'redo');
    expect(Array.from(redone.data)).toEqual(Array.from(after.data));
    expect(getPixel(redone, 4, 4)).toEqual(C);
  });

  it('round-trips: undo then redo equals original after', () => {
    const before = createBuffer(16, 16);
    let after = before;
    for (let i = 0; i < 16; i++) after = setPixel(after, i, i, C);
    const patch = makePatch('l', 'f', before, after)!;
    const rt = applyPatch(applyPatch(after, patch, 'undo'), patch, 'redo');
    expect(Array.from(rt.data)).toEqual(Array.from(after.data));
  });

  it('returns null patch when nothing changed', () => {
    const b = createBuffer(4, 4);
    expect(makePatch('l', 'f', b, b)).toBeNull();
  });

  it('patch only stores the dirty sub-rect (not the whole buffer)', () => {
    const before = createBuffer(64, 64);
    const after = setPixel(before, 10, 10, C);
    const patch = makePatch('l', 'f', before, after)!;
    // a 1px change must not carry 64*64*4 bytes of "after" data
    const bytes = JSON.stringify(patch).length;
    expect(bytes).toBeLessThan(64 * 64 * 4);
  });
});
