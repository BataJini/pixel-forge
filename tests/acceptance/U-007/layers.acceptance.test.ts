// Held-out acceptance — U-007 Layers panel & management. Builder must NOT edit.
// Targets master-spec §5 layers.ts + buffer.ts composite. Runner: Vitest.
// Encodes the five machine-checkable criteria from docs/acceptance/U-007/criteria.md:
//   1. Hiding a layer removes its pixels from the composite; showing restores them.
//   2. Reordering two layers changes which opaque pixel wins in the composite.
//   3. merge-down of B onto A yields a composite equal to compositing [A, B].
//   4. flatten reduces to a single layer whose buffer equals the full composite.
//   5. Layer opacity scales its contribution (0% invisible, 100% full).
import { describe, expect, it } from 'vitest';
import { composite, createBuffer, getPixel, setPixel } from '../../../src/core/buffer';
import { flatten, mergeDown, moveLayer, setOpacity, setVisible } from '../../../src/core/layers';
import type { Layer, PixelBuffer, RGBA } from '../../../src/core/types';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const W = 4;
const H = 4;

const mkLayer = (id: string, buffer: PixelBuffer, over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  opacity: 100,
  blend: 'normal',
  buffer,
  ...over,
});

const paint = (x: number, y: number, c: RGBA): PixelBuffer => setPixel(createBuffer(W, H), x, y, c);
const bytes = (b: PixelBuffer): number[] => Array.from(b.data);

describe('U-007 held-out acceptance — layer composite semantics', () => {
  it('1. hiding a layer removes its pixels from the composite; showing restores them', () => {
    // Two opaque layers both painting (1,1); top (index 1) is BLUE, bottom RED.
    const stack: Layer[] = [mkLayer('bottom', paint(1, 1, RED)), mkLayer('top', paint(1, 1, BLUE))];

    expect(getPixel(composite(stack), 1, 1)).toEqual(BLUE); // top wins when visible

    const hidden = setVisible(stack, 1, false);
    expect(getPixel(composite(hidden), 1, 1)).toEqual(RED); // hidden top -> bottom shows

    const shown = setVisible(hidden, 1, true);
    expect(getPixel(composite(shown), 1, 1)).toEqual(BLUE); // showing restores it
  });

  it('2. reordering two layers changes which opaque pixel wins', () => {
    const A = mkLayer('A', paint(2, 2, RED));
    const B = mkLayer('B', paint(2, 2, BLUE));

    expect(getPixel(composite([A, B]), 2, 2)).toEqual(BLUE); // B is on top (last)

    const swapped = moveLayer([A, B], 1, 0); // move B below A
    expect(getPixel(composite(swapped), 2, 2)).toEqual(RED); // A now on top
  });

  it('3. merge-down of B onto A equals compositing [A, B]', () => {
    const A = mkLayer('A', paint(0, 0, RED));
    const B = mkLayer('B', paint(3, 3, BLUE));

    const merged = mergeDown([A, B], 1); // merge upper (B) down onto A
    expect(merged.length).toBe(1);
    expect(bytes(composite(merged))).toEqual(bytes(composite([A, B])));
  });

  it('4. flatten reduces to a single layer whose buffer equals the full composite', () => {
    const stack: Layer[] = [
      mkLayer('A', paint(0, 0, RED)),
      mkLayer('B', paint(3, 3, BLUE)),
      mkLayer('C', paint(1, 1, RED)),
    ];

    const flat = flatten(stack);
    expect(flat.length).toBe(1);
    expect(bytes(flat[0].buffer)).toEqual(bytes(composite(stack)));
  });

  it('5. layer opacity scales its contribution (0% invisible, 100% full)', () => {
    const stack: Layer[] = [mkLayer('bottom', paint(1, 1, RED)), mkLayer('top', paint(1, 1, BLUE))];

    const opaque0 = setOpacity(stack, 1, 0);
    expect(getPixel(composite(opaque0), 1, 1)).toEqual(RED); // 0% -> top invisible

    const opaque100 = setOpacity(stack, 1, 100);
    expect(getPixel(composite(opaque100), 1, 1)).toEqual(BLUE); // 100% -> top fully covers
  });
});
