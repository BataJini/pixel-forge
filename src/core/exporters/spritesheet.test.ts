import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../buffer';
import { makeFrame } from '../frames';
import { blankLayer } from '../layers';
import type { Frame, PixelBuffer, RGBA } from '../types';
import {
  atlasToJson,
  nextPowerOfTwo,
  packCels,
  packFrames,
  type SheetCel,
  sliceCel,
} from './spritesheet';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 200, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const YELLOW: RGBA = [255, 220, 0, 255];

/** A solid `w×h` cel of one color, with a distinctive top-left marker pixel. */
function solidCel(w: number, h: number, color: RGBA, durationMs = 100, name?: string): SheetCel {
  let buf = createBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf = setPixel(buf, x, y, color);
    }
  }
  buf = setPixel(buf, 0, 0, [1, 2, 3, 255]); // marker so slices are identifiable
  return { buffer: buf, durationMs, name };
}

function cels4(): SheetCel[] {
  return [
    solidCel(16, 16, RED, 100),
    solidCel(16, 16, GREEN, 120),
    solidCel(16, 16, BLUE, 140),
    solidCel(16, 16, YELLOW, 160),
  ];
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function buffersEqual(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.w !== b.w || a.h !== b.h) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) {
      return false;
    }
  }
  return true;
}

describe('nextPowerOfTwo', () => {
  it('rounds up to the next power of two (≤1 → 1)', () => {
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(16)).toBe(16);
    expect(nextPowerOfTwo(17)).toBe(32);
    expect(nextPowerOfTwo(48)).toBe(64);
  });
});

describe('packCels — meta invariants (held-out criteria)', () => {
  it('emits one rect per input frame, each of frame size, carrying its duration', () => {
    const cels = cels4();
    const { meta } = packCels(cels, { layout: 'grid' });
    expect(meta.frames).toHaveLength(cels.length);
    expect(meta.count).toBe(4);
    meta.frames.forEach((r, i) => {
      expect(r.index).toBe(i);
      expect(r.w).toBe(16);
      expect(r.h).toBe(16);
      expect(r.duration).toBe(cels[i].durationMs);
    });
  });

  it('produces non-overlapping rects that lie fully within the atlas bounds', () => {
    const { atlas, meta } = packCels(cels4(), { layout: 'grid', padding: 2, margin: 3 });
    for (const r of meta.frames) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.w);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.h);
    }
    for (let i = 0; i < meta.frames.length; i++) {
      for (let j = i + 1; j < meta.frames.length; j++) {
        expect(rectsOverlap(meta.frames[i], meta.frames[j])).toBe(false);
      }
    }
  });

  it('separates adjacent cells by exactly `padding` and insets by `margin`', () => {
    const { meta } = packCels(cels4(), { layout: 'horizontal', padding: 4, margin: 5 });
    expect(meta.frames[0].x).toBe(5); // outer margin
    expect(meta.frames[0].y).toBe(5);
    // gap between cell 0 and cell 1 == padding
    expect(meta.frames[1].x - (meta.frames[0].x + meta.frames[0].w)).toBe(4);
  });
});

describe('packCels — layout atlas dimensions', () => {
  it('grid of 4 × 16px → 2×2 cells → 32×32 (no padding/margin)', () => {
    const { atlas, meta } = packCels(cels4(), { layout: 'grid' });
    expect(meta.columns).toBe(2);
    expect(meta.rows).toBe(2);
    expect([atlas.w, atlas.h]).toEqual([32, 32]);
  });

  it('horizontal strip of 4 × 16px → 64×16', () => {
    const { atlas, meta } = packCels(cels4(), { layout: 'horizontal' });
    expect(meta.columns).toBe(4);
    expect(meta.rows).toBe(1);
    expect([atlas.w, atlas.h]).toEqual([64, 16]);
  });

  it('vertical strip of 4 × 16px → 16×64', () => {
    const { atlas, meta } = packCels(cels4(), { layout: 'vertical' });
    expect(meta.columns).toBe(1);
    expect(meta.rows).toBe(4);
    expect([atlas.w, atlas.h]).toEqual([16, 64]);
  });

  it('applies padding + margin to the atlas size', () => {
    // grid 2×2, 16px, padding 2, margin 3:
    // content = 2*16 + 1*2 = 34; atlas = 34 + 2*3 = 40
    const { atlas } = packCels(cels4(), { layout: 'grid', padding: 2, margin: 3 });
    expect([atlas.w, atlas.h]).toEqual([40, 40]);
  });

  it('rounds atlas dims up to a power of two when requested', () => {
    // horizontal 3×16 → 48×16 → POT → 64×16
    const cels = [solidCel(16, 16, RED), solidCel(16, 16, GREEN), solidCel(16, 16, BLUE)];
    const { atlas } = packCels(cels, { layout: 'horizontal', powerOfTwo: true });
    expect([atlas.w, atlas.h]).toEqual([64, 16]);
  });

  it('honors an explicit grid column count', () => {
    const { meta, atlas } = packCels(cels4(), { layout: 'grid', columns: 4 });
    expect(meta.columns).toBe(4);
    expect(meta.rows).toBe(1);
    expect([atlas.w, atlas.h]).toEqual([64, 16]);
  });
});

describe('packCels — pixels & round-trip', () => {
  it('blits each cel at its rect so the atlas slices back to the exact frame', () => {
    const cels = cels4();
    const { atlas, meta } = packCels(cels, { layout: 'grid', padding: 2, margin: 1 });
    meta.frames.forEach((r, i) => {
      expect(buffersEqual(sliceCel(atlas, r), cels[i].buffer)).toBe(true);
    });
  });

  it('leaves the padding gutter transparent by default', () => {
    const { atlas, meta } = packCels(cels4(), { layout: 'horizontal', padding: 3, margin: 0 });
    // a pixel in the gutter between frame 0 and frame 1
    const gutterX = meta.frames[0].x + meta.frames[0].w + 1;
    expect(getPixel(atlas, gutterX, 8)[3]).toBe(0);
  });

  it('fills the background matte behind cels + gutters when set', () => {
    const bg: RGBA = [10, 20, 30, 255];
    const { atlas } = packCels(cels4(), { layout: 'horizontal', padding: 3, background: bg });
    // gutter pixel takes the matte (opaque), not transparent
    expect(getPixel(atlas, 17, 8)).toEqual(bg);
  });

  it('returns an empty atlas for zero frames', () => {
    const { atlas, meta } = packCels([], { margin: 2 });
    expect(meta.count).toBe(0);
    expect(meta.frames).toHaveLength(0);
    expect([atlas.w, atlas.h]).toEqual([4, 4]);
  });
});

describe('packFrames — composites core frames', () => {
  function frameOf(id: string, color: RGBA, durationMs: number): Frame {
    let layer = blankLayer(`${id}-l`, 'Layer 1', 8, 8);
    let buf = layer.buffer;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        buf = setPixel(buf, x, y, color);
      }
    }
    layer = { ...layer, buffer: buf };
    return makeFrame(id, [layer], durationMs);
  }

  it('packs composited frames with per-frame durations and default names', () => {
    const frames = [frameOf('a', RED, 90), frameOf('b', BLUE, 110)];
    const { atlas, meta } = packFrames(frames, { layout: 'horizontal' });
    expect(meta.frames.map((f) => f.name)).toEqual(['frame_0', 'frame_1']);
    expect(meta.frames.map((f) => f.duration)).toEqual([90, 110]);
    expect(getPixel(atlas, 0, 0)).toEqual(RED);
    expect(getPixel(atlas, 8, 0)).toEqual(BLUE);
  });
});

describe('atlasToJson', () => {
  it('maps each frame name → {x,y,w,h,duration} and includes a meta block', () => {
    const { meta } = packCels(cels4(), { layout: 'grid', padding: 2, margin: 1 });
    const json = JSON.parse(atlasToJson(meta, { image: 'sprite.png', fps: 12, scale: 2 }));
    expect(Object.keys(json.frames)).toEqual(['frame_0', 'frame_1', 'frame_2', 'frame_3']);
    const f0 = json.frames.frame_0;
    expect(f0).toEqual({ x: meta.frames[0].x, y: meta.frames[0].y, w: 16, h: 16, duration: 100 });
    expect(json.meta.app).toBe('PixelForge');
    expect(json.meta.image).toBe('sprite.png');
    expect(json.meta.size).toEqual({ w: meta.w, h: meta.h });
    expect(json.meta.layout).toBe('grid');
    expect(json.meta.frameCount).toBe(4);
    expect(json.meta.fps).toBe(12);
    expect(json.meta.scale).toBe(2);
  });

  it('uses custom cel names when provided', () => {
    const cels = [solidCel(8, 8, RED, 100, 'walk_0'), solidCel(8, 8, BLUE, 100, 'walk_1')];
    const { meta } = packCels(cels, { layout: 'horizontal' });
    const json = JSON.parse(atlasToJson(meta));
    expect(Object.keys(json.frames)).toEqual(['walk_0', 'walk_1']);
  });
});
