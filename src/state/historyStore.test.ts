import { describe, expect, it, vi } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../core/buffer';
import { applyPatch, makePatch, type Patch } from '../core/history';
import type { PixelBuffer, RGBA } from '../core/types';
import { History, type HistoryEntry, patchEntry } from './historyStore';

const RED: RGBA = [226, 59, 46, 255];

/** A trivial reversible entry that toggles a boxed value, for stack semantics. */
function boxEntry(box: { v: number }, from: number, to: number, key?: string): HistoryEntry {
  return {
    label: `set ${to}`,
    bytes: 8,
    coalesceKey: key,
    undo: () => {
      box.v = from;
    },
    redo: () => {
      box.v = to;
    },
  };
}

describe('History stack semantics', () => {
  it('records, undoes, and redoes in order', () => {
    const box = { v: 0 };
    const h = new History();
    h.record(boxEntry(box, 0, 1));
    box.v = 1;
    h.record(boxEntry(box, 1, 2));
    box.v = 2;
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);

    h.undo();
    expect(box.v).toBe(1);
    h.undo();
    expect(box.v).toBe(0);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);

    h.redo();
    expect(box.v).toBe(1);
    h.redo();
    expect(box.v).toBe(2);
  });

  it('undo/redo on an empty side is a safe no-op returning false', () => {
    const h = new History();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('clears the redo stack when a new edit is recorded after an undo', () => {
    const box = { v: 0 };
    const h = new History();
    h.record(boxEntry(box, 0, 1));
    box.v = 1;
    h.record(boxEntry(box, 1, 2));
    box.v = 2;
    h.undo(); // v=1, redo has the "set 2" entry
    expect(h.canRedo()).toBe(true);

    h.record(boxEntry(box, 1, 9)); // a NEW edit
    box.v = 9;
    expect(h.canRedo()).toBe(false);
    expect(h.redoDepth).toBe(0);
  });

  it('notifies onChange for record/undo/redo/clear', () => {
    const onChange = vi.fn();
    const box = { v: 0 };
    const h = new History({ onChange });
    h.record(boxEntry(box, 0, 1));
    h.undo();
    h.redo();
    h.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('clear() on an already-empty history does not notify', () => {
    const onChange = vi.fn();
    const h = new History({ onChange });
    h.clear();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('History caps', () => {
  it('enforces the depth cap, evicting oldest entries', () => {
    const box = { v: 0 };
    const h = new History({ maxDepth: 3 });
    for (let i = 1; i <= 6; i++) {
      h.record(boxEntry(box, i - 1, i));
    }
    expect(h.depth).toBe(3);
    // Only the newest 3 remain undoable (entries 4,5,6).
    let undos = 0;
    while (h.undo()) undos += 1;
    expect(undos).toBe(3);
  });

  it('enforces the total-byte cap, evicting oldest entries', () => {
    const box = { v: 0 };
    const h = new History({ maxDepth: 100, maxBytes: 24 }); // 8 bytes/entry -> keep 3
    for (let i = 1; i <= 6; i++) {
      h.record(boxEntry(box, i - 1, i));
    }
    expect(h.depth).toBe(3);
    expect(h.bytes).toBeLessThanOrEqual(24);
  });
});

describe('History coalescing', () => {
  it('merges consecutive entries with the same coalesceKey into one', () => {
    const box = { v: 0 };
    const h = new History();
    h.record(boxEntry(box, 0, 1, 'stroke#1'));
    box.v = 1;
    h.record(boxEntry(box, 1, 2, 'stroke#1'));
    box.v = 2;
    h.record(boxEntry(box, 2, 3, 'stroke#1'));
    box.v = 3;
    // Three sub-steps of the SAME gesture collapse to one undo entry.
    expect(h.depth).toBe(1);
    h.undo();
    expect(box.v).toBe(0); // undo jumps back to before the first sub-step
    h.redo();
    expect(box.v).toBe(3); // redo jumps to after the last sub-step
  });

  it('does not merge entries with different keys', () => {
    const box = { v: 0 };
    const h = new History();
    h.record(boxEntry(box, 0, 1, 'a'));
    h.record(boxEntry(box, 1, 2, 'b'));
    expect(h.depth).toBe(2);
  });
});

describe('patchEntry (pixel history)', () => {
  it('undo/redo blit the patch onto a live layer buffer', () => {
    let live: PixelBuffer = createBuffer(8, 8);
    const before = live;
    const after = setPixel(before, 3, 4, RED);
    live = after;
    const patch = makePatch('layer-0', 'frame-0', before, after);
    if (!patch) throw new Error('expected patch');

    const apply = (p: Patch, dir: 'undo' | 'redo'): void => {
      live = applyPatch(live, p, dir);
    };
    const entry = patchEntry(patch, apply, 'Pencil');
    expect(entry.label).toBe('Pencil');
    expect(entry.bytes).toBeGreaterThan(0);

    entry.undo();
    expect(getPixel(live, 3, 4)).toEqual([0, 0, 0, 0]);
    entry.redo();
    expect(getPixel(live, 3, 4)).toEqual(RED);
  });
});
