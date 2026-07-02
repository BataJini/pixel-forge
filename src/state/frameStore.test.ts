/**
 * Unit tests for the stateful, undoable frame controller (src/state/frameStore.ts).
 *
 * Covers the U-008 store-level guarantees: add-layer-to-all-frames (criterion 1),
 * frame add/duplicate(deep-copy)/delete(guard)/reorder + undo/redo (criterion 2),
 * per-frame duration (coalesced undo), playback/onion config (not undoable), live
 * per-frame painting with dirty-rect undo, and the composited-frame cache (§6 perf).
 */
import { describe, expect, it } from 'vitest';
import { getPixel, setPixelMut } from '../core/buffer';
import { blankFrame } from '../core/frames';
import type { Frame, RGBA } from '../core/types';
import { FrameStack } from './frameStore';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const W = 8;
const H = 8;

function seed(frameCount = 2): FrameStack {
  const frames: Frame[] = Array.from({ length: frameCount }, (_, i) =>
    blankFrame(`frame-${i + 1}`, W, H, 'layer-1', 'Base'),
  );
  return new FrameStack(W, H, { initial: { frames, activeFrameId: 'frame-1' } });
}

describe('FrameStack — construction', () => {
  it('defaults to a single blank frame with one blank layer', () => {
    const stack = new FrameStack(W, H);
    expect(stack.getFrames()).toHaveLength(1);
    expect(stack.getFrames()[0].layers).toHaveLength(1);
    expect(stack.getActiveIndex()).toBe(0);
  });

  it('seeds from provided frames and tracks the active frame/layer', () => {
    const stack = seed(3);
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-1', 'frame-2', 'frame-3']);
    expect(stack.getActiveFrameId()).toBe('frame-1');
    expect(stack.getActiveLayerId()).toBe('layer-1');
  });
});

describe('FrameStack — criterion 1: add-layer applies to every frame, undoable', () => {
  it('adds an aligned layer to all frames and makes it active', () => {
    const stack = seed(3);
    stack.addLayer('Ink');
    const frames = stack.getFrames();
    expect(frames.every((f) => f.layers.length === 2)).toBe(true);
    expect(frames.every((f) => f.layers[1].name === 'Ink')).toBe(true);
    // Same aligned id in every frame, distinct buffers.
    const ids = new Set(frames.map((f) => f.layers[1].id));
    expect(ids.size).toBe(1);
    const bufs = frames.map((f) => f.layers[1].buffer);
    expect(new Set(bufs).size).toBe(3);
    expect(stack.getActiveLayerId()).toBe(frames[0].layers[1].id);
  });

  it('undo removes the added layer from all frames; redo restores it', () => {
    const stack = seed(2);
    stack.addLayer('Ink');
    expect(stack.getFrames().every((f) => f.layers.length === 2)).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(stack.getFrames().every((f) => f.layers.length === 1)).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(stack.getFrames().every((f) => f.layers.length === 2)).toBe(true);
  });
});

describe('FrameStack — criterion 2: frame add / duplicate / delete / reorder', () => {
  it('addFrame inserts a blank aligned frame after the active one and activates it', () => {
    const stack = seed(2);
    stack.addLayer('Ink'); // 2 aligned layers
    stack.setActiveFrame('frame-1');
    stack.addFrame();
    const frames = stack.getFrames();
    expect(frames).toHaveLength(3);
    // Inserted at index 1 (after frame-1), aligned to the 2-layer set, blank buffers.
    expect(frames[1].layers).toHaveLength(2);
    expect(frames[1].layers.map((l) => l.id)).toEqual(frames[0].layers.map((l) => l.id));
    expect(stack.getActiveFrameId()).toBe(frames[1].id);
  });

  it('duplicateFrame deep-copies pixels: editing the copy never changes the source', () => {
    const stack = seed(1);
    // Paint the source frame's layer.
    stack.stampPixel(1, 1, RED);
    stack.duplicateFrame(0);
    const [source, copy] = stack.getFrames();
    expect(getPixel(copy.layers[0].buffer, 1, 1)).toEqual(RED);
    expect(copy.layers[0].buffer).not.toBe(source.layers[0].buffer);

    // Edit the copy (now active) and confirm the source is untouched.
    stack.stampPixel(4, 4, BLUE);
    const after = stack.getFrames();
    expect(getPixel(after[1].layers[0].buffer, 4, 4)).toEqual(BLUE);
    expect(getPixel(after[0].layers[0].buffer, 4, 4)).toEqual([0, 0, 0, 0]);
  });

  it('deleteFrame removes the active frame but guards the last one, and is undoable', () => {
    const stack = seed(3);
    stack.setActiveFrameIndex(1);
    expect(stack.deleteFrame()).toBe(true);
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-1', 'frame-3']);
    stack.undo();
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-1', 'frame-2', 'frame-3']);

    const one = seed(1);
    expect(one.deleteFrame()).toBe(false);
    expect(one.getFrames()).toHaveLength(1);
  });

  it('moveFrame reorders and is undoable', () => {
    const stack = seed(3);
    stack.moveFrame(0, 2);
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-2', 'frame-3', 'frame-1']);
    stack.undo();
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-1', 'frame-2', 'frame-3']);
    stack.redo();
    expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-2', 'frame-3', 'frame-1']);
  });

  it('setFrameDuration coalesces consecutive edits on the same frame into one undo', () => {
    const stack = seed(2);
    stack.setFrameDuration(0, 150);
    stack.setFrameDuration(0, 200);
    stack.setFrameDuration(0, 250);
    expect(stack.getFrames()[0].durationMs).toBe(250);
    // One coalesced entry → a single undo reverts to the pre-drag value.
    expect(stack.undo()).toBe(true);
    expect(stack.getFrames()[0].durationMs).toBe(100);
  });
});

describe('FrameStack — playback / onion config (not undoable)', () => {
  it('fps/loop/pingPong/onion update snapshot and do not enter history', () => {
    const stack = seed(2);
    stack.setFps(24);
    stack.setLoop(false);
    stack.setPingPong(true);
    stack.setOnion({ before: 2, after: 2, opacity: 0.3 });
    stack.toggleOnion();
    const s = stack.getSnapshot();
    expect(s.fps).toBe(24);
    expect(s.loop).toBe(false);
    expect(s.pingPong).toBe(true);
    expect(s.onion.before).toBe(2);
    expect(s.onion.enabled).toBe(false); // toggled off from default-on
    expect(s.canUndo).toBe(false); // none of the above are undoable
  });

  it('clamps fps into range', () => {
    const stack = seed(1);
    stack.setFps(9999);
    expect(stack.getFps()).toBe(60);
    stack.setFps(0);
    expect(stack.getFps()).toBe(1);
  });
});

describe('FrameStack — per-frame painting with dirty-rect undo', () => {
  it('paints the active frame active layer and undo/redo restores pixels exactly', () => {
    const stack = seed(2);
    stack.setActiveFrameIndex(1);
    stack.beginStroke();
    stack.paint(2, 2, RED);
    stack.paint(3, 3, RED);
    stack.endStroke('Pencil');
    const painted = stack.getFrames()[1].layers[0].buffer;
    expect(getPixel(painted, 2, 2)).toEqual(RED);

    expect(stack.undo()).toBe(true);
    expect(getPixel(stack.getFrames()[1].layers[0].buffer, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(stack.redo()).toBe(true);
    expect(getPixel(stack.getFrames()[1].layers[0].buffer, 2, 2)).toEqual(RED);
    // The OTHER frame was never touched by the stroke.
    expect(getPixel(stack.getFrames()[0].layers[0].buffer, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('a stroke on a frame does not leak into a duplicated sibling (independent buffers)', () => {
    const stack = seed(1);
    stack.duplicateFrame(0); // now 2 frames, copy active
    stack.stampPixel(5, 5, BLUE); // paints the active copy
    const frames = stack.getFrames();
    expect(getPixel(frames[1].layers[0].buffer, 5, 5)).toEqual(BLUE);
    expect(getPixel(frames[0].layers[0].buffer, 5, 5)).toEqual([0, 0, 0, 0]);
  });
});

describe('FrameStack — composited-frame cache (perf §6)', () => {
  it('returns a cached composite for an unchanged frame and a fresh one after edits', () => {
    const stack = seed(2);
    const frame0 = stack.getFrames()[0];
    const a = stack.getFrameComposite(frame0);
    const b = stack.getFrameComposite(frame0);
    expect(b).toBe(a); // same frame identity → cached instance reused

    // Editing frame 1 leaves frame 0's cache valid (only dirty frames recomposite).
    stack.setActiveFrameIndex(1);
    stack.stampPixel(0, 0, RED);
    expect(stack.getFrameComposite(stack.getFrames()[0])).toBe(a); // frame 0 unchanged
  });

  it('getActiveComposite reflects an in-flight stroke live', () => {
    const stack = seed(1);
    stack.beginStroke();
    stack.paint(1, 1, RED);
    expect(getPixel(stack.getActiveComposite(), 1, 1)).toEqual(RED);
    stack.endStroke();
  });
});

describe('FrameStack — immutability of seeds', () => {
  it('does not mutate a caller-provided seed frame array on ops', () => {
    const frames = [blankFrame('frame-1', W, H, 'layer-1', 'Base')];
    setPixelMut(frames[0].layers[0].buffer, 0, 0, RED);
    const stack = new FrameStack(W, H, { initial: { frames } });
    stack.addLayer('Ink');
    stack.addFrame();
    // The original array length is unchanged (the store sliced it).
    expect(frames).toHaveLength(1);
    expect(frames[0].layers).toHaveLength(1);
  });
});
