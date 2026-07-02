// Held-out acceptance — U-010 Export GIF + spritesheet (+JSON atlas). Builder must NOT edit.
// Targets master-spec §5 exporters/spritesheet.ts + exporters/gif.ts. Runner: Vitest.
// Encodes the machine-checkable criteria from docs/acceptance/U-010/criteria.md.
import { describe, it, expect } from 'vitest';
import { packFrames } from '../../../src/core/exporters/spritesheet';
import { encodeGifFromFrames, parseGifInfo } from '../../../src/core/exporters/gif';
import { createBuffer, setPixel } from '../../../src/core/buffer';
import type { Frame, Layer, RGBA } from '../../../src/core/types';

const RED: RGBA = [255, 0, 0, 255];

const mkLayer = (id: string, w: number, h: number, c: RGBA): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  opacity: 100,
  blend: 'normal',
  buffer: setPixel(createBuffer(w, h), 0, 0, c),
});

const mkFrame = (id: string, w: number, h: number, durationMs: number): Frame => ({
  id,
  durationMs,
  layers: [mkLayer(`${id}-l`, w, h, RED)],
});

const frameSet = (n: number, w: number, h: number, dur = (i: number) => 100 + i): Frame[] =>
  Array.from({ length: n }, (_, i) => mkFrame(`f${i}`, w, h, dur(i)));

describe('U-010 held-out acceptance — spritesheet packing', () => {
  it('packFrames: one rect per frame, correct size, within bounds, non-overlapping, margin + durations', () => {
    const w = 8;
    const h = 8;
    const n = 5;
    const padding = 2;
    const margin = 3;
    const { atlas, meta } = packFrames(frameSet(n, w, h), { layout: 'grid', padding, margin });

    expect(meta.frames.length).toBe(n);
    expect(meta.count).toBe(n);

    for (const r of meta.frames) {
      expect(r.w).toBe(w); // each rect matches the frame size
      expect(r.h).toBe(h);
      expect(r.x).toBeGreaterThanOrEqual(margin); // outer margin applied
      expect(r.y).toBeGreaterThanOrEqual(margin);
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.w); // within atlas bounds
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.h);
    }

    // durations carried through
    meta.frames.forEach((r, i) => expect(r.duration).toBe(100 + i));

    // rects are pairwise non-overlapping
    for (let i = 0; i < meta.frames.length; i++) {
      for (let j = i + 1; j < meta.frames.length; j++) {
        const a = meta.frames[i];
        const b = meta.frames[j];
        const disjoint =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  it('grid, horizontal-strip and vertical-strip layouts yield the expected atlas dimensions', () => {
    const w = 8;
    const h = 8;
    const n = 4;

    const horiz = packFrames(frameSet(n, w, h), { layout: 'horizontal' });
    expect(horiz.meta.rows).toBe(1);
    expect(horiz.meta.columns).toBe(n);
    expect(horiz.meta.w).toBe(n * w);
    expect(horiz.meta.h).toBe(h);

    const vert = packFrames(frameSet(n, w, h), { layout: 'vertical' });
    expect(vert.meta.columns).toBe(1);
    expect(vert.meta.rows).toBe(n);
    expect(vert.meta.w).toBe(w);
    expect(vert.meta.h).toBe(n * h);

    const grid = packFrames(frameSet(n, w, h), { layout: 'grid', columns: 2 });
    expect(grid.meta.columns).toBe(2);
    expect(grid.meta.rows).toBe(2);
    expect(grid.meta.w).toBe(2 * w);
    expect(grid.meta.h).toBe(2 * h);
  });
});

describe('U-010 held-out acceptance — GIF encode', () => {
  it('encoded bytes begin with GIF89a and decode to the right frame count + dimensions', () => {
    const w = 6;
    const h = 4;
    const n = 3;
    const bytes = encodeGifFromFrames(frameSet(n, w, h), { loop: 0 });

    const header = String.fromCharCode(...Array.from(bytes.slice(0, 6)));
    expect(header).toBe('GIF89a');

    const info = parseGifInfo(bytes);
    expect(info.version).toBe('GIF89a');
    expect(info.frameCount).toBe(n);
    expect(info.width).toBe(w);
    expect(info.height).toBe(h);
  });

  it('effect-free: encode is a pure function of the composited buffers (deterministic, no leaked effects)', () => {
    const frames = frameSet(2, 8, 8);
    const a = encodeGifFromFrames(frames, { loop: 0 });
    const b = encodeGifFromFrames(frames, { loop: 0 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
