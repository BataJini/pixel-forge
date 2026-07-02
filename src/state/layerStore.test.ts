/**
 * src/state/layerStore.test.ts — the undoable layer-stack controller (U-007).
 *
 * Exercises every management op end-to-end WITH undo/redo, the delete-last guard,
 * active-layer tracking, composite effects (hide/reorder/opacity/merge/flatten),
 * pixel painting on the active layer, and the copy-on-write guarantee that a stroke
 * can never corrupt a buffer held by an older history snapshot.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../core/buffer';
import type { PixelBuffer, RGBA } from '../core/types';
import { LayerStack, layerFromBuffer } from './layerStore';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const W = 4;
const H = 4;

const buf = (x: number, y: number, c: RGBA): PixelBuffer => setPixel(createBuffer(W, H), x, y, c);

/** A three-layer seeded stack: bottom RED@(0,0), mid BLUE@(1,1), top GREEN@(1,1). */
function seeded(): LayerStack {
  return new LayerStack(W, H, {
    initial: {
      layers: [
        layerFromBuffer('layer-1', 'Base', buf(0, 0, RED)),
        layerFromBuffer('layer-2', 'Mid', buf(1, 1, BLUE)),
        layerFromBuffer('layer-3', 'Top', buf(1, 1, GREEN)),
      ],
      activeId: 'layer-3',
    },
  });
}

describe('LayerStack — construction', () => {
  it('defaults to a single blank active layer', () => {
    const s = new LayerStack(W, H);
    expect(s.getLayers()).toHaveLength(1);
    expect(s.getActiveIndex()).toBe(0);
    expect(s.getActiveLayer()?.visible).toBe(true);
    expect(s.getSnapshot().canDelete).toBe(false);
  });

  it('accepts seeded layers and resolves the active id', () => {
    const s = seeded();
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(s.getActiveId()).toBe('layer-3');
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(GREEN); // top wins
  });
});

describe('LayerStack — add / duplicate / delete (undoable)', () => {
  it('addLayer inserts above active, makes it active, and is undoable', () => {
    const s = seeded();
    s.setActive('layer-2');
    s.addLayer('Sketch');
    const layers = s.getLayers();
    expect(layers).toHaveLength(4);
    expect(layers[2].name).toBe('Sketch'); // inserted above 'Mid' (index 1)
    expect(s.getActiveId()).toBe(layers[2].id);
    s.undo();
    expect(s.getLayers()).toHaveLength(3);
    expect(s.getActiveId()).toBe('layer-2'); // active restored
    s.redo();
    expect(s.getLayers()).toHaveLength(4);
  });

  it('duplicateLayer deep-copies pixels and is independent', () => {
    const s = seeded();
    s.duplicateLayer(0); // duplicate Base
    const layers = s.getLayers();
    expect(layers).toHaveLength(4);
    expect(layers[1].name).toBe('Base copy');
    expect(getPixel(layers[1].buffer, 0, 0)).toEqual(RED);
    expect(layers[1].buffer).not.toBe(layers[0].buffer);
    s.undo();
    expect(s.getLayers()).toHaveLength(3);
  });

  it('deleteLayer removes + reassigns active and refuses the last layer', () => {
    const s = seeded();
    expect(s.deleteLayer(2)).toBe(true); // delete Top (active)
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-2']);
    expect(s.getActiveId()).toBe('layer-2'); // reassigned to the new top
    s.undo();
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(s.getActiveId()).toBe('layer-3');

    // Reduce to a single layer, then the guard must hold.
    const one = new LayerStack(W, H);
    expect(one.deleteLayer(0)).toBe(false);
    expect(one.getLayers()).toHaveLength(1);
    expect(one.getSnapshot().canUndo).toBe(false); // nothing recorded
  });
});

describe('LayerStack — metadata ops affect composite + undo', () => {
  it('hiding the top layer drops its pixels; undo restores', () => {
    const s = seeded();
    s.setVisible(2, false);
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(BLUE); // GREEN hidden -> BLUE (mid)
    s.undo();
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(GREEN);
  });

  it('toggleVisible flips and is one entry', () => {
    const s = seeded();
    s.toggleVisible(2);
    expect(s.getLayers()[2].visible).toBe(false);
    s.toggleVisible(2);
    expect(s.getLayers()[2].visible).toBe(true);
  });

  it('opacity 0 makes the top invisible; consecutive edits coalesce to one undo', () => {
    const s = seeded();
    s.setOpacity(2, 80);
    s.setOpacity(2, 40);
    s.setOpacity(2, 0); // slider drag: three edits, one entry
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(BLUE);
    expect(s.getSnapshot().canUndo).toBe(true);
    s.undo();
    expect(s.getLayers()[2].opacity).toBe(100); // back before the whole drag
    expect(s.getSnapshot().canUndo).toBe(false);
  });

  it('lock toggles and rename update the layer', () => {
    const s = seeded();
    s.toggleLocked(0);
    expect(s.getLayers()[0].locked).toBe(true);
    s.renameLayer(0, 'Ground');
    expect(s.getLayers()[0].name).toBe('Ground');
  });

  it('renames coalesce so typing is a single undo step', () => {
    const s = seeded();
    s.renameLayer(0, 'B');
    s.renameLayer(0, 'Ba');
    s.renameLayer(0, 'Bas');
    s.renameLayer(0, 'Base2');
    s.undo();
    expect(s.getLayers()[0].name).toBe('Base'); // one step back to the original
  });
});

describe('LayerStack — reorder / merge / flatten', () => {
  it('moveActive changes the composite winner and is undoable', () => {
    const s = seeded();
    s.setActive('layer-3');
    s.moveActive(-1); // Top moves below Mid
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-3', 'layer-2']);
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(BLUE); // Mid now on top
    s.undo();
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(getPixel(s.getComposite(), 1, 1)).toEqual(GREEN);
  });

  it('mergeDown collapses the active onto the one below; bottom is guarded', () => {
    const s = seeded();
    const before = Array.from(s.getComposite().data);
    expect(s.mergeDown(0)).toBe(false); // bottom layer: nothing beneath
    expect(s.mergeDown(2)).toBe(true); // merge Top onto Mid
    expect(s.getLayers()).toHaveLength(2);
    expect(Array.from(s.getComposite().data)).toEqual(before); // visually identical
    s.undo();
    expect(s.getLayers()).toHaveLength(3);
  });

  it('flatten reduces to one layer equal to the composite; guarded at 1', () => {
    const s = seeded();
    const before = Array.from(s.getComposite().data);
    expect(s.flatten()).toBe(true);
    expect(s.getLayers()).toHaveLength(1);
    expect(Array.from(s.getLayers()[0].buffer.data)).toEqual(before);
    expect(s.flatten()).toBe(false); // already single
    s.undo();
    expect(s.getLayers()).toHaveLength(3);
  });
});

describe('LayerStack — pixel editing on the active layer', () => {
  it('paints the active layer and records one undoable patch', () => {
    const s = new LayerStack(W, H);
    s.beginStroke();
    s.paint(2, 2, RED);
    s.paint(3, 3, RED);
    s.endStroke('Pencil');
    expect(getPixel(s.getComposite(), 2, 2)).toEqual(RED);
    expect(s.getSnapshot().undoLabel).toBe('Pencil');
    s.undo();
    expect(getPixel(s.getComposite(), 2, 2)).toEqual([0, 0, 0, 0]);
    s.redo();
    expect(getPixel(s.getComposite(), 2, 2)).toEqual(RED);
  });

  it('does not paint a locked layer and records nothing', () => {
    const s = new LayerStack(W, H);
    s.setLocked(0, true);
    s.beginStroke();
    s.paint(1, 1, RED);
    s.endStroke();
    expect(getPixel(s.getComposite(), 1, 1)).toEqual([0, 0, 0, 0]);
    // Only the lock op is on the timeline, no paint entry.
    expect(s.getSnapshot().undoLabel).toBe('Lock layer');
  });

  it('an empty stroke records nothing', () => {
    const s = new LayerStack(W, H);
    s.beginStroke();
    s.endStroke();
    expect(s.getSnapshot().canUndo).toBe(false);
  });

  it('interleaved structural op + draw + undo-across leaves no pixel corruption (F-1)', () => {
    // Reviewer F-1 repro: add a layer (its structural snapshot references the OTHER
    // layer's buffer), switch to that other layer, draw on it, then undo the draw
    // AND the add. Copy-on-write in beginStroke means the draw mutates a clone, so
    // the structural snapshot's buffer is pristine and undoing the add restores a
    // blank layer — never the drawn pixel.
    const s = new LayerStack(W, H, {
      initial: { layers: [layerFromBuffer('A', 'A', createBuffer(W, H))], activeId: 'A' },
    });
    s.addLayer('B'); // active becomes B; snapshot captures A's blank buffer by ref
    s.setActive('A');
    s.stampPixel(0, 0, RED);
    expect(getPixel(s.getComposite(), 0, 0)).toEqual(RED);

    s.undo(); // undo the draw
    expect(getPixel(s.getComposite(), 0, 0)).toEqual([0, 0, 0, 0]);

    s.undo(); // undo the add — layer A must be pristine, no leaked RED
    expect(s.getLayers()).toHaveLength(1);
    expect(s.getActiveId()).toBe('A');
    expect(getPixel(s.getComposite(), 0, 0)).toEqual([0, 0, 0, 0]);

    s.redo(); // redo add
    expect(s.getLayers()).toHaveLength(2);
    s.redo(); // redo draw — the pixel returns exactly once
    expect(getPixel(s.getComposite(), 0, 0)).toEqual(RED);
  });

  it('hide + draw + undo-across does not corrupt the hidden/other layer (F-1)', () => {
    const s = seeded(); // Base RED@(0,0) / Mid BLUE@(1,1) / Top GREEN@(1,1)
    s.setActive('layer-1'); // draw on Base
    s.setVisible(1, false); // hide Mid — metadata snapshot references live buffers
    s.stampPixel(2, 2, GREEN); // copy-on-write clone of Base
    s.undo(); // undo the draw
    expect(getPixel(s.getComposite(), 2, 2)).toEqual([0, 0, 0, 0]);
    s.undo(); // undo the hide — Mid visible again AND Base still pristine
    expect(s.getLayers()[1].visible).toBe(true);
    expect(getPixel(s.getComposite(), 0, 0)).toEqual(RED);
    expect(getPixel(s.getComposite(), 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('copy-on-write: a stroke never corrupts a buffer held by an older snapshot', () => {
    const s = new LayerStack(W, H);
    s.stampPixel(0, 0, RED); // active layer now has RED@(0,0)
    s.setOpacity(0, 50); // snapshot references the RED buffer
    s.beginStroke();
    s.paint(1, 1, BLUE); // must go to a CLONE, not the snapshot's buffer
    s.endStroke();
    // Undo the paint, then the opacity: the original pixels must be pristine.
    s.undo(); // undo paint
    expect(getPixel(s.getComposite(), 1, 1)).toEqual([0, 0, 0, 0]);
    s.undo(); // undo opacity
    expect(s.getLayers()[0].opacity).toBe(100);
    expect(getPixel(s.getComposite(), 0, 0)).toEqual(RED);
    expect(getPixel(s.getComposite(), 1, 1)).toEqual([0, 0, 0, 0]); // BLUE never leaked
  });
});

describe('LayerStack — lock protects a layer from destructive ops (F-2)', () => {
  it('a locked layer cannot be deleted; canDelete + activeLocked reflect it', () => {
    const s = seeded();
    s.setActive('layer-1');
    s.setLocked(0, true);
    expect(s.getSnapshot().activeLocked).toBe(true);
    expect(s.getSnapshot().canDelete).toBe(false);
    expect(s.deleteLayer(0)).toBe(false);
    expect(s.getLayers().map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    // Unlocking restores the ability to delete.
    s.setLocked(0, false);
    expect(s.getSnapshot().canDelete).toBe(true);
    expect(s.deleteLayer(0)).toBe(true);
    expect(s.getLayers()).toHaveLength(2);
  });

  it('merge-down is refused when the source or the layer below is locked', () => {
    const s = seeded();
    s.setLocked(1, true); // lock Mid
    expect(s.mergeDown(2)).toBe(false); // Top onto locked Mid → refused
    expect(s.mergeDown(1)).toBe(false); // locked Mid onto Base → refused
    expect(s.getLayers()).toHaveLength(3);
    s.setLocked(1, false);
    expect(s.mergeDown(2)).toBe(true); // now allowed
    expect(s.getLayers()).toHaveLength(2);
  });

  it('canMergeDown clears when the active layer is locked', () => {
    const s = seeded();
    s.setActive('layer-3'); // Top (index 2), has a layer beneath
    expect(s.getSnapshot().canMergeDown).toBe(true);
    s.setLocked(2, true);
    expect(s.getSnapshot().canMergeDown).toBe(false);
  });

  it('flatten is refused while any layer is locked; canFlatten + anyLocked reflect it', () => {
    const s = seeded();
    s.setLocked(0, true);
    expect(s.getSnapshot().anyLocked).toBe(true);
    expect(s.getSnapshot().canFlatten).toBe(false);
    expect(s.flatten()).toBe(false);
    expect(s.getLayers()).toHaveLength(3);
    s.setLocked(0, false);
    expect(s.getSnapshot().canFlatten).toBe(true);
    expect(s.flatten()).toBe(true);
    expect(s.getLayers()).toHaveLength(1);
  });

  it('a locked layer still rejects pixel edits (paint no-op)', () => {
    const s = seeded();
    s.setActive('layer-1');
    s.setLocked(0, true);
    s.stampPixel(3, 3, GREEN);
    expect(getPixel(s.getComposite(), 3, 3)).toEqual([0, 0, 0, 0]);
    // Only the lock op is undoable — the paint recorded nothing.
    expect(s.getSnapshot().undoLabel).toBe('Lock layer');
  });
});

describe('LayerStack — subscription surface', () => {
  it('notifies subscribers and bumps the snapshot version on change', () => {
    const s = new LayerStack(W, H);
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    const v0 = s.getSnapshot().version;
    s.addLayer();
    expect(listener).toHaveBeenCalled();
    expect(s.getSnapshot().version).toBeGreaterThan(v0);
    expect(s.getSnapshot()).not.toBe(undefined);
    unsub();
    const calls = listener.mock.calls.length;
    s.addLayer();
    expect(listener.mock.calls.length).toBe(calls); // unsubscribed
  });

  it('snapshot flags reflect capabilities', () => {
    const s = seeded();
    s.setActive('layer-1'); // bottom
    let snap = s.getSnapshot();
    expect(snap.canMergeDown).toBe(false); // bottom cannot merge down
    expect(snap.canFlatten).toBe(true);
    expect(snap.canDelete).toBe(true);
    s.setActive('layer-3');
    snap = s.getSnapshot();
    expect(snap.canMergeDown).toBe(true);
  });
});
