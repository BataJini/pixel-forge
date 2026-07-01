import { beforeEach, describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixelMut } from '../core/buffer';
import type { PixelBuffer, Rect, RGBA } from '../core/types';
import { type RenderTarget, ToolSession } from './toolSession';

const RED: RGBA = [255, 106, 26, 255]; // default fg
const BLU: RGBA = [0, 0, 255, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

const on = (b: PixelBuffer, x: number, y: number): boolean => getPixel(b, x, y)[3] === 255;

/** A DOM-free render target that records what the session pushes to it. */
class FakeTarget implements RenderTarget {
  composite: PixelBuffer | null = null;
  regions: Rect[] = [];
  selectionRect: Rect | null = null;
  updateRegion(_buf: PixelBuffer, rect: Rect): void {
    this.regions.push(rect);
  }
  setComposite(buf: PixelBuffer): void {
    this.composite = buf;
  }
  setSelectionOverlay(rect: Rect | null): void {
    this.selectionRect = rect;
  }
}

let target: FakeTarget;
let session: ToolSession;

beforeEach(() => {
  target = new FakeTarget();
  session = new ToolSession(target, createBuffer(16, 16));
});

describe('pencil', () => {
  it('draws a gap-free freehand stroke and reports a dirty region', () => {
    session.setTool('pencil');
    session.pointerDown(2, 2);
    session.pointerMove(6, 2);
    session.pointerUp();
    const b = session.getBuffer();
    for (let x = 2; x <= 6; x++) {
      expect(getPixel(b, x, 2)).toEqual(RED);
    }
    expect(target.regions.length).toBeGreaterThan(0);
  });

  it('honors brush size', () => {
    session.update({ tool: 'pencil', brushSize: 3 });
    session.pointerDown(5, 5);
    session.pointerUp();
    const b = session.getBuffer();
    expect(on(b, 4, 4)).toBe(true);
    expect(on(b, 6, 6)).toBe(true);
  });

  it('mirror-X paints a symmetric stroke', () => {
    session.update({ tool: 'pencil', mirror: { x: true, y: false } });
    session.pointerDown(1, 1);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(getPixel(b, 14, 1)).toEqual(RED); // 16-1-1
  });

  it('pixel-perfect removes the doubled corner of an L drag', () => {
    session.update({ tool: 'pencil', pixelPerfect: true });
    session.pointerDown(0, 0);
    session.pointerMove(2, 0);
    session.pointerMove(2, 2);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 0, 0)).toEqual(RED);
    expect(getPixel(b, 2, 2)).toEqual(RED);
    expect(on(b, 2, 0)).toBe(false); // the elbow is thinned away
  });
});

describe('eraser', () => {
  it('clears alpha on the active buffer', () => {
    const buf = createBuffer(8, 8);
    setPixelMut(buf, 3, 3, BLU);
    session.setBuffer(buf);
    session.setTool('eraser');
    session.pointerDown(3, 3);
    session.pointerUp();
    expect(getPixel(session.getBuffer(), 3, 3)).toEqual(CLEAR);
  });
});

describe('bucket', () => {
  it('flood fills a contiguous region', () => {
    session.setTool('bucket');
    session.pointerDown(0, 0);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 0, 0)).toEqual(RED);
    expect(getPixel(b, 15, 15)).toEqual(RED);
  });

  it('is constrained to an active selection', () => {
    session.setTool('select');
    session.pointerDown(8, 0);
    session.pointerMove(15, 15);
    session.pointerUp();
    session.setTool('bucket');
    session.pointerDown(10, 5); // seed inside the selection
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 10, 5)).toEqual(RED); // filled inside selection
    expect(on(b, 2, 2)).toBe(false); // left half untouched
  });

  it('does nothing when the seed is outside the selection', () => {
    session.setTool('select');
    session.pointerDown(8, 0);
    session.pointerMove(15, 15);
    session.pointerUp();
    session.setTool('bucket');
    session.pointerDown(1, 1); // outside selection
    session.pointerUp();
    expect(on(session.getBuffer(), 1, 1)).toBe(false);
  });
});

describe('line / rect / ellipse commit on pointer up with live preview', () => {
  it('line commits both endpoints', () => {
    session.setTool('line');
    session.pointerDown(1, 1);
    session.pointerMove(5, 1);
    session.pointerMove(7, 1);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 1, 1)).toEqual(RED);
    expect(getPixel(b, 7, 1)).toEqual(RED);
    expect(on(b, 5, 5)).toBe(false); // stray preview cleaned up
  });

  it('line with Shift snaps to 45 degrees', () => {
    session.setTool('line');
    session.pointerDown(0, 0);
    session.pointerMove(6, 5, { shift: true }); // snaps to (6,6)
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 6, 6)).toEqual(RED);
    expect(getPixel(b, 3, 3)).toEqual(RED);
  });

  it('rect outline leaves the interior empty', () => {
    session.setTool('rect');
    session.pointerDown(2, 2);
    session.pointerMove(6, 6);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 2, 2)).toEqual(RED);
    expect(getPixel(b, 6, 6)).toEqual(RED);
    expect(on(b, 4, 4)).toBe(false);
  });

  it('ellipse touches the extremes', () => {
    session.setTool('ellipse');
    session.pointerDown(0, 0);
    session.pointerMove(8, 8);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 0, 4)).toEqual(RED);
    expect(getPixel(b, 4, 0)).toEqual(RED);
  });

  it('the shape preview does not leave earlier provisional pixels behind', () => {
    session.setTool('rect');
    session.pointerDown(1, 1);
    session.pointerMove(10, 10); // big provisional
    session.pointerMove(3, 3); // shrink
    session.pointerUp();
    const b = session.getBuffer();
    // the large box outline at (10,10) must be gone
    expect(on(b, 10, 1)).toBe(false);
    expect(on(b, 1, 10)).toBe(false);
    expect(getPixel(b, 3, 3)).toEqual(RED); // final small box corner
  });
});

describe('eyedropper', () => {
  it('samples into fg, or bg with Alt', () => {
    const buf = createBuffer(8, 8);
    setPixelMut(buf, 4, 4, BLU);
    session.setBuffer(buf);
    session.setTool('eyedropper');
    session.pointerDown(4, 4);
    expect(session.getState().fg).toEqual(BLU);
    session.pointerDown(4, 4, { alt: true });
    expect(session.getState().bg).toEqual(BLU);
  });
});

describe('move', () => {
  it('drags the layer by whole pixels and clears the exposed area', () => {
    const buf = createBuffer(8, 8);
    setPixelMut(buf, 1, 1, BLU);
    session.setBuffer(buf);
    session.setTool('move');
    session.pointerDown(1, 1);
    session.pointerMove(3, 2);
    session.pointerUp();
    const b = session.getBuffer();
    expect(getPixel(b, 3, 2)).toEqual(BLU);
    expect(on(b, 1, 1)).toBe(false);
  });

  it('nudges by whole pixels via arrow keys', () => {
    const buf = createBuffer(8, 8);
    setPixelMut(buf, 2, 2, BLU);
    session.setBuffer(buf);
    session.nudge(1, 0);
    expect(getPixel(session.getBuffer(), 3, 2)).toEqual(BLU);
  });
});

describe('selection', () => {
  it('builds a mask and reports it to the overlay', () => {
    session.setTool('select');
    session.pointerDown(2, 2);
    session.pointerMove(5, 5);
    session.pointerUp();
    const sel = session.getSelection();
    expect(sel).not.toBeNull();
    expect(sel?.bounds).toEqual({ x: 2, y: 2, w: 4, h: 4 });
    expect(target.selectionRect).toEqual({ x: 2, y: 2, w: 4, h: 4 });
  });

  it('Shift adds and Alt subtracts', () => {
    session.setTool('select');
    session.pointerDown(0, 0);
    session.pointerMove(3, 3);
    session.pointerUp();
    session.pointerDown(6, 6, { shift: true });
    session.pointerMove(8, 8, { shift: true });
    session.pointerUp({ shift: true });
    let sel = session.getSelection();
    expect(sel?.bounds).toEqual({ x: 0, y: 0, w: 9, h: 9 });
    session.pointerDown(0, 0, { alt: true });
    session.pointerMove(3, 3, { alt: true });
    session.pointerUp({ alt: true });
    sel = session.getSelection();
    expect(sel?.bounds).toEqual({ x: 6, y: 6, w: 3, h: 3 });
  });

  it('select-all then deselect', () => {
    session.selectAllPixels();
    expect(session.getSelection()?.bounds).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    session.clearSelection();
    expect(session.getSelection()).toBeNull();
    expect(target.selectionRect).toBeNull();
  });

  it('a plain click (no drag) with select clears the selection', () => {
    session.selectAllPixels();
    session.setTool('select');
    session.pointerDown(4, 4);
    session.pointerUp();
    expect(session.getSelection()).toBeNull();
  });
});

describe('color helpers', () => {
  it('swaps fg and bg', () => {
    session.update({ fg: RED, bg: BLU });
    session.swapColors();
    expect(session.getState().fg).toEqual(BLU);
    expect(session.getState().bg).toEqual(RED);
  });
});

describe('clipboard & floating selection', () => {
  /** A fresh session over an 8×8 buffer with BLU at (2,2) and (3,3). */
  const seeded = (): ToolSession => {
    const buf = createBuffer(8, 8);
    setPixelMut(buf, 2, 2, BLU);
    setPixelMut(buf, 3, 3, BLU);
    session.setBuffer(buf);
    return session;
  };

  /** Drag a replace-mode marquee over the inclusive rect (x0,y0)-(x1,y1). */
  const selectDrag = (x0: number, y0: number, x1: number, y1: number): void => {
    session.setTool('select');
    session.pointerDown(x0, y0);
    session.pointerMove(x1, y1);
    session.pointerUp();
  };

  it('copy is a no-op (returns false) with no selection', () => {
    seeded();
    expect(session.copySelection()).toBe(false);
    expect(session.hasClipboard()).toBe(false);
  });

  it('paste with an empty clipboard does nothing', () => {
    seeded();
    expect(session.paste()).toBe(false);
    expect(session.getFloatingBounds()).toBeNull();
  });

  it('copy → paste → move → commit relocates a copy, keeping the original', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    expect(session.copySelection()).toBe(true);
    expect(session.hasClipboard()).toBe(true);

    expect(session.paste()).toBe(true);
    expect(session.getState().tool).toBe('move'); // placed with Move
    expect(session.getFloatingBounds()).toEqual({ x: 2, y: 2, w: 2, h: 2 });

    session.nudge(4, 0); // float now at (6,2)
    session.setTool('pencil'); // commit on tool change

    const b = session.getBuffer();
    expect(getPixel(b, 2, 2)).toEqual(BLU); // original kept (copy, not cut)
    expect(getPixel(b, 3, 3)).toEqual(BLU);
    expect(getPixel(b, 6, 2)).toEqual(BLU); // pasted copy at new spot
    expect(getPixel(b, 7, 3)).toEqual(BLU);
    expect(session.getFloatingBounds()).toBeNull(); // no longer floating
  });

  it('cut removes the selected pixels; paste places them elsewhere', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    expect(session.cut()).toBe(true);
    let b = session.getBuffer();
    expect(on(b, 2, 2)).toBe(false); // cut hole
    expect(on(b, 3, 3)).toBe(false);
    expect(session.getSelection()).toBeNull();

    session.paste(); // floating at origin (2,2)
    session.nudge(4, 0); // → (6,2)
    session.setTool('pencil'); // commit
    b = session.getBuffer();
    expect(on(b, 2, 2)).toBe(false); // still a hole
    expect(getPixel(b, 6, 2)).toEqual(BLU); // relocated
    expect(getPixel(b, 7, 3)).toEqual(BLU);
  });

  it('Move lifts an active selection and drags it, leaving a hole (F-5)', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.setTool('move');
    session.pointerDown(2, 2); // lifts the selection into a floating selection
    session.pointerMove(6, 2); // drag by (4,0)
    session.pointerUp();
    let b = session.getBuffer();
    expect(on(b, 2, 2)).toBe(false); // hole left behind
    expect(getPixel(b, 6, 2)).toEqual(BLU); // moved pixels
    expect(session.getFloatingBounds()).toEqual({ x: 6, y: 2, w: 2, h: 2 });

    session.commitFloatingSelection(); // Enter
    b = session.getBuffer();
    expect(on(b, 2, 2)).toBe(false);
    expect(getPixel(b, 6, 2)).toEqual(BLU);
    expect(getPixel(b, 7, 3)).toEqual(BLU);
    expect(session.getFloatingBounds()).toBeNull();
  });

  it('a second paste commits the first floating selection', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.copySelection();
    session.paste(); // float #1 at (2,2)
    session.nudge(0, 4); // float #1 → (2,6)
    session.paste(); // commits #1 at (2,6), starts float #2 at (2,2)
    expect(session.getFloatingBounds()).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    const b = session.getBuffer();
    expect(getPixel(b, 2, 6)).toEqual(BLU); // committed float #1
    expect(getPixel(b, 3, 7)).toEqual(BLU);
  });

  it('cut of a floating selection removes it from the layer', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.copySelection();
    session.paste();
    session.nudge(4, 0); // float at (6,2)
    expect(session.cut()).toBe(true);
    expect(session.getFloatingBounds()).toBeNull();
    const b = session.getBuffer();
    expect(on(b, 6, 2)).toBe(false); // floated pixels removed
    expect(getPixel(b, 2, 2)).toEqual(BLU); // base originals untouched
  });

  it('cut respects a non-rectangular selection mask', () => {
    const buf = createBuffer(8, 1);
    for (let x = 0; x < 4; x++) setPixelMut(buf, x, 0, BLU);
    session.setBuffer(buf);
    session.setTool('select');
    session.pointerDown(0, 0);
    session.pointerMove(3, 0); // select x 0..3
    session.pointerUp();
    session.pointerDown(1, 0, { alt: true }); // subtract x 1..2
    session.pointerMove(2, 0, { alt: true });
    session.pointerUp({ alt: true });
    session.cut(); // only (0,0) and (3,0) are masked
    const b = session.getBuffer();
    expect(on(b, 0, 0)).toBe(false); // masked → cut
    expect(getPixel(b, 1, 0)).toEqual(BLU); // outside mask → kept
    expect(getPixel(b, 2, 0)).toEqual(BLU);
    expect(on(b, 3, 0)).toBe(false); // masked → cut
  });

  it('commit re-selects the placed region', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.copySelection();
    session.paste();
    session.nudge(3, 3); // → (5,5)
    session.setTool('pencil');
    expect(session.getSelection()?.bounds).toEqual({ x: 5, y: 5, w: 2, h: 2 });
  });

  it('committing on deselect keeps floated pixels (no data loss)', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.copySelection();
    session.paste();
    session.nudge(4, 0); // → (6,2)
    session.clearSelection(); // Esc: commit in place, drop the marquee
    const b = session.getBuffer();
    expect(getPixel(b, 6, 2)).toEqual(BLU);
    expect(session.getFloatingBounds()).toBeNull();
    expect(session.getSelection()).toBeNull();
  });

  it('setBuffer drops a floating selection', () => {
    seeded();
    selectDrag(2, 2, 3, 3);
    session.copySelection();
    session.paste();
    expect(session.getFloatingBounds()).not.toBeNull();
    session.setBuffer(createBuffer(8, 8));
    expect(session.getFloatingBounds()).toBeNull();
  });
});
