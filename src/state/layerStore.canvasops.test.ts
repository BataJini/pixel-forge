import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../core/buffer';
import { resizeBuffer } from '../core/canvas';
import type { PixelBuffer, RGBA } from '../core/types';
import { LayerStack } from './layerStore';

const RED: RGBA = [255, 0, 0, 255];

function stack(w = 4, h = 4): LayerStack {
  return new LayerStack(w, h);
}

describe('LayerStack — import-as-layer (U-011)', () => {
  it('adds a layer from an imported buffer and makes it active, undoably', () => {
    const s = stack();
    const buf = setPixel(createBuffer(4, 4), 2, 2, RED);
    s.addLayerWithBuffer(buf, 'Imported');
    expect(s.getLayers()).toHaveLength(2);
    const active = s.getActiveLayer();
    expect(active?.name).toBe('Imported');
    expect(getPixel(active?.buffer as PixelBuffer, 2, 2)).toEqual(RED);
    // Undoable.
    expect(s.undo()).toBe(true);
    expect(s.getLayers()).toHaveLength(1);
    expect(s.redo()).toBe(true);
    expect(s.getLayers()).toHaveLength(2);
  });
});

describe('LayerStack — resizeCanvas (U-011)', () => {
  it('resizes every layer and the canvas size as one undoable op', () => {
    const s = stack(2, 2);
    s.stampPixel(0, 0, RED); // paint the base layer
    s.addLayer(); // a second layer, 2×2
    s.resizeCanvas(4, 4, (buf) => resizeBuffer(buf, 4, 4), 'Resize canvas');
    expect(s.getSize()).toEqual({ w: 4, h: 4 });
    for (const layer of s.getLayers()) {
      expect(layer.buffer.w).toBe(4);
      expect(layer.buffer.h).toBe(4);
    }
    // The painted pixel survived at its position.
    expect(getPixel(s.getLayers()[0].buffer, 0, 0)).toEqual(RED);

    // Undo restores the previous size + buffers.
    expect(s.undo()).toBe(true);
    expect(s.getSize()).toEqual({ w: 2, h: 2 });
    expect(s.getLayers()[0].buffer.w).toBe(2);
    // Redo re-applies.
    expect(s.redo()).toBe(true);
    expect(s.getSize()).toEqual({ w: 4, h: 4 });
  });

  it('runs side effects in lockstep with undo/redo', () => {
    const s = stack(2, 2);
    const log: string[] = [];
    s.resizeCanvas(3, 3, (buf) => resizeBuffer(buf, 3, 3), 'Resize', {
      apply: () => log.push('apply'),
      revert: () => log.push('revert'),
    });
    expect(log).toEqual(['apply']);
    s.undo();
    expect(log).toEqual(['apply', 'revert']);
    s.redo();
    expect(log).toEqual(['apply', 'revert', 'apply']);
  });
});

describe('LayerStack — reset (U-011 new/open)', () => {
  it('replaces the document and clears history', () => {
    const s = stack(2, 2);
    s.stampPixel(0, 0, RED);
    expect(s.historySnapshot().canUndo).toBe(true);
    const fresh = setPixel(createBuffer(8, 8), 3, 3, RED);
    s.reset(8, 8, [
      {
        id: 'imp',
        name: 'Opened',
        visible: true,
        locked: false,
        opacity: 100,
        blend: 'normal',
        buffer: fresh,
      },
    ]);
    expect(s.getSize()).toEqual({ w: 8, h: 8 });
    expect(s.getLayers()).toHaveLength(1);
    expect(s.getActiveLayer()?.name).toBe('Opened');
    // History cleared — the previous paint is no longer undoable.
    expect(s.historySnapshot().canUndo).toBe(false);
  });

  it('falls back to a blank layer when reset with no layers', () => {
    const s = stack(4, 4);
    s.reset(6, 6, []);
    expect(s.getSize()).toEqual({ w: 6, h: 6 });
    expect(s.getLayers()).toHaveLength(1);
    expect(s.getActiveLayer()?.buffer.w).toBe(6);
  });
});
