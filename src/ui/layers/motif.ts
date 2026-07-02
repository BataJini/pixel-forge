/**
 * src/ui/layers/motif.ts — forge-native seed content for the Layers panel preview.
 *
 * Builds a small three-layer stack (Anvil / Heat / Sparks) with overlapping,
 * distinct pixel art so the panel demonstrably shows layer semantics: hiding the
 * Sparks layer removes the sparks from the composite, reordering brings different
 * pixels to the top, opacity fades a layer, and merge/flatten bake them together.
 * Pure engine buffer ops only (no DOM); the artwork is the user's true colors and
 * is never tinted by the chrome theme (constitution: clean canvas).
 */
import { createBuffer, fillRectMut, setPixelMut } from '../../core/buffer';
import type { Layer, RGBA } from '../../core/types';
import { layerFromBuffer } from '../../state/layerStore';

export const MOTIF_W = 32;
export const MOTIF_H = 32;

const IRON: RGBA = [58, 52, 46, 255];
const IRON_DARK: RGBA = [36, 32, 28, 255];
const IRON_HI: RGBA = [92, 84, 74, 255];
const EMBER: RGBA = [255, 106, 26, 255];
const EMBER_HOT: RGBA = [226, 59, 46, 255];
const GLOW: RGBA = [255, 176, 58, 255];
const SPARK: RGBA = [255, 224, 138, 255];
const SPARK_HOT: RGBA = [255, 255, 255, 255];

/** The anvil body — the base metal (opaque iron with a top-left highlight). */
function anvil(): Layer {
  const buf = createBuffer(MOTIF_W, MOTIF_H);
  fillRectMut(buf, { x: 8, y: 24, w: 16, h: 3 }, IRON_DARK); // foot
  fillRectMut(buf, { x: 11, y: 16, w: 10, h: 8 }, IRON); // body
  fillRectMut(buf, { x: 20, y: 17, w: 7, h: 3 }, IRON); // horn
  fillRectMut(buf, { x: 9, y: 22, w: 14, h: 2 }, IRON); // waist
  fillRectMut(buf, { x: 11, y: 16, w: 10, h: 1 }, IRON_HI); // lit top edge
  return layerFromBuffer('layer-1', 'Anvil', buf);
}

/** The heated metal — a molten glow sitting on the anvil face. */
function heat(): Layer {
  const buf = createBuffer(MOTIF_W, MOTIF_H);
  fillRectMut(buf, { x: 13, y: 14, w: 6, h: 2 }, EMBER_HOT); // ingot
  fillRectMut(buf, { x: 14, y: 13, w: 4, h: 1 }, EMBER);
  fillRectMut(buf, { x: 15, y: 12, w: 2, h: 1 }, GLOW);
  return layerFromBuffer('layer-2', 'Heat', buf);
}

/** The sparks — bright flecks flying up off the hammer strike. */
function sparks(): Layer {
  const buf = createBuffer(MOTIF_W, MOTIF_H);
  const pts: Array<[number, number, RGBA]> = [
    [16, 8, SPARK_HOT],
    [18, 6, SPARK],
    [14, 5, SPARK],
    [20, 9, GLOW],
    [12, 8, SPARK],
    [17, 4, SPARK_HOT],
  ];
  for (const [x, y, c] of pts) {
    setPixelMut(buf, x, y, c);
  }
  return layerFromBuffer('layer-3', 'Sparks', buf);
}

/** The seeded bottom→top stack for the panel preview. */
export function seedForgeLayers(): Layer[] {
  return [anvil(), heat(), sparks()];
}
