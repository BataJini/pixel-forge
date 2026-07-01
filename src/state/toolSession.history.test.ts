/**
 * ToolSession × History integration (U-006). Proves the running-app guarantees:
 * a drag = one undo entry; undo/redo restores pixels exactly; redo clears after a
 * new edit; and cut / paste / fill / move are undoable — all without a DOM.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buffersEqual, cloneBuffer, createBuffer, getPixel } from '../core/buffer';
import type { PixelBuffer, RGBA } from '../core/types';
import { History } from './historyStore';
import { type RenderTarget, ToolSession } from './toolSession';

const RED: RGBA = [255, 106, 26, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

class FakeTarget implements RenderTarget {
  composite: PixelBuffer | null = null;
  updateRegion(): void {}
  setComposite(buf: PixelBuffer): void {
    this.composite = buf;
  }
  setSelectionOverlay(): void {}
}

let target: FakeTarget;
let history: History;
let session: ToolSession;

beforeEach(() => {
  target = new FakeTarget();
  history = new History();
  session = new ToolSession(target, createBuffer(16, 16));
  session.attachHistory(history);
});

const snapshot = (): PixelBuffer => cloneBuffer(session.getBuffer());

describe('pencil undo/redo', () => {
  it('collapses a whole multi-pixel drag into ONE undo entry', () => {
    const empty = snapshot();
    session.setTool('pencil');
    session.pointerDown(2, 2);
    session.pointerMove(3, 2);
    session.pointerMove(4, 2);
    session.pointerMove(8, 2);
    session.pointerUp();

    expect(history.depth).toBe(1); // one gesture = one entry
    const drawn = snapshot();
    for (let x = 2; x <= 8; x++) expect(getPixel(drawn, x, 2)).toEqual(RED);

    expect(history.undo()).toBe(true);
    expect(buffersEqual(session.getBuffer(), empty)).toBe(true); // whole stroke gone

    expect(history.redo()).toBe(true);
    expect(buffersEqual(session.getBuffer(), drawn)).toBe(true); // whole stroke back
  });

  it('records nothing for a no-op gesture (pointer down/up with no movement off-canvas)', () => {
    session.setTool('pencil');
    session.pointerDown(-5, -5); // out of bounds → no pixels change
    session.pointerUp();
    expect(history.depth).toBe(0);
  });

  it('clears the redo stack when a new stroke follows an undo', () => {
    session.setTool('pencil');
    session.pointerDown(1, 1);
    session.pointerUp();
    session.pointerDown(5, 5);
    session.pointerUp();
    history.undo(); // undo the 2nd stroke — redo now available
    expect(history.canRedo()).toBe(true);

    session.pointerDown(9, 9); // a NEW edit
    session.pointerUp();
    expect(history.canRedo()).toBe(false);
  });
});

describe('other tools are undoable', () => {
  it('bucket fill undoes/redoes as one entry', () => {
    const empty = snapshot();
    session.setTool('bucket');
    session.pointerDown(0, 0); // fills the whole empty canvas
    const filled = snapshot();
    expect(history.depth).toBe(1);
    history.undo();
    expect(buffersEqual(session.getBuffer(), empty)).toBe(true);
    history.redo();
    expect(buffersEqual(session.getBuffer(), filled)).toBe(true);
  });

  it('an outlined rectangle shape undoes to empty', () => {
    const empty = snapshot();
    session.update({ tool: 'rect', rectFilled: false });
    session.pointerDown(2, 2);
    session.pointerMove(10, 9);
    session.pointerUp();
    expect(history.depth).toBe(1);
    expect(getPixel(session.getBuffer(), 2, 2)).toEqual(RED); // a border pixel
    expect(buffersEqual(session.getBuffer(), empty)).toBe(false);
    history.undo();
    expect(buffersEqual(session.getBuffer(), empty)).toBe(true);
  });

  it('cut then undo restores the cut pixels', () => {
    // paint a block, select it, cut it, undo → block returns.
    session.update({ tool: 'rect', rectFilled: true });
    session.pointerDown(3, 3);
    session.pointerMove(6, 6);
    session.pointerUp();
    const withBlock = snapshot();

    session.setTool('select');
    session.pointerDown(3, 3);
    session.pointerMove(6, 6);
    session.pointerUp();
    session.cut();
    expect(getPixel(session.getBuffer(), 4, 4)).toEqual(CLEAR); // cut cleared it

    history.undo(); // undo the cut
    expect(buffersEqual(session.getBuffer(), withBlock)).toBe(true);
  });

  it('paste then commit is a single undoable entry', () => {
    // paint a pixel, copy it, paste + move the copy elsewhere, commit, then undo.
    session.setTool('pencil');
    session.pointerDown(0, 0);
    session.pointerUp();
    const beforePaste = snapshot();
    expect(history.depth).toBe(1);

    session.setTool('select');
    session.pointerDown(0, 0);
    session.pointerMove(2, 2);
    session.pointerUp();
    session.copySelection();
    session.paste(); // floating placed at its origin (0,0)
    session.nudge(6, 6); // move the floating selection to (6,6)
    session.commitFloatingSelection(); // bake it
    expect(getPixel(session.getBuffer(), 6, 6)).toEqual(RED); // the moved copy landed

    const undoDepthAfterPaste = history.depth;
    // the paste/commit added exactly one entry beyond the initial pencil dot.
    expect(undoDepthAfterPaste).toBe(2);
    history.undo(); // undo just the paste
    expect(buffersEqual(session.getBuffer(), beforePaste)).toBe(true);
  });
});

describe('history without a sink attached', () => {
  it('a detached session mutates normally and records nothing', () => {
    const solo = new ToolSession(new FakeTarget(), createBuffer(8, 8));
    solo.setTool('pencil');
    solo.pointerDown(1, 1);
    solo.pointerUp();
    expect(getPixel(solo.getBuffer(), 1, 1)).toEqual(RED);
    // No throw, no history — attachHistory was never called.
    solo.attachHistory(history);
    solo.attachHistory(null);
    expect(getPixel(solo.getBuffer(), 1, 1)).toEqual(RED);
  });
});

describe('depth cap in the running session', () => {
  it('drops oldest entries beyond the cap', () => {
    const capped = new History({ maxDepth: 3 });
    const s = new ToolSession(new FakeTarget(), createBuffer(8, 8));
    s.attachHistory(capped);
    s.setTool('pencil');
    for (let i = 0; i < 6; i++) {
      s.pointerDown(i, 0);
      s.pointerUp();
    }
    expect(capped.depth).toBe(3);
  });
});
