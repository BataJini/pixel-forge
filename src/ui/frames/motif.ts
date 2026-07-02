/**
 * src/ui/frames/motif.ts — forge-native seed animation for the Frames timeline.
 *
 * A four-frame hammer-strike loop: a static anvil + heating ingot on the bottom
 * `Anvil` layer (aligned across every frame), and a `Spark` layer that bursts and
 * fades per frame so the timeline visibly animates — demonstrating playback, onion
 * ghosts, and per-frame edits. Pure engine buffer ops only (no DOM); the artwork is
 * the user's true colors and is never tinted by the chrome theme (clean canvas).
 */
import { createBuffer, fillRectMut, setPixelMut } from '../../core/buffer';
import { makeFrame } from '../../core/frames';
import type { Frame, Layer, PixelBuffer, RGBA } from '../../core/types';

export const MOTIF_W = 32;
export const MOTIF_H = 32;
export const MOTIF_FPS = 8;

const IRON: RGBA = [58, 52, 46, 255];
const IRON_DARK: RGBA = [36, 32, 28, 255];
const IRON_HI: RGBA = [92, 84, 74, 255];
const EMBER: RGBA = [255, 106, 26, 255];
const EMBER_HOT: RGBA = [226, 59, 46, 255];
const GLOW: RGBA = [255, 176, 58, 255];
const SPARK: RGBA = [255, 224, 138, 255];
const SPARK_HOT: RGBA = [255, 255, 255, 255];

/** The anvil body + a heating ingot; `heat` (0..3) brightens the ingot glow. */
function anvilBuffer(heat: number): PixelBuffer {
  const buf = createBuffer(MOTIF_W, MOTIF_H);
  fillRectMut(buf, { x: 8, y: 24, w: 16, h: 3 }, IRON_DARK); // foot
  fillRectMut(buf, { x: 11, y: 16, w: 10, h: 8 }, IRON); // body
  fillRectMut(buf, { x: 20, y: 17, w: 7, h: 3 }, IRON); // horn
  fillRectMut(buf, { x: 9, y: 22, w: 14, h: 2 }, IRON); // waist
  fillRectMut(buf, { x: 11, y: 16, w: 10, h: 1 }, IRON_HI); // lit top edge
  // Ingot on the face — hotter (taller glow) on the strike frames.
  fillRectMut(buf, { x: 13, y: 14, w: 6, h: 2 }, EMBER_HOT);
  fillRectMut(buf, { x: 14, y: 13, w: 4, h: 1 }, heat >= 1 ? GLOW : EMBER);
  if (heat >= 2) {
    fillRectMut(buf, { x: 15, y: 12, w: 2, h: 1 }, SPARK);
  }
  return buf;
}

/** The spark burst for frame `i` (0..3): a rising, spreading, fading shower. */
function sparkBuffer(i: number): PixelBuffer {
  const buf = createBuffer(MOTIF_W, MOTIF_H);
  const bursts: Array<Array<[number, number, RGBA]>> = [
    // 0 — impact flash, tight and bright
    [
      [16, 11, SPARK_HOT],
      [15, 10, SPARK],
      [17, 10, SPARK],
    ],
    // 1 — sparks leap up and out
    [
      [16, 8, SPARK_HOT],
      [13, 9, SPARK],
      [19, 9, SPARK],
      [15, 6, GLOW],
      [18, 6, GLOW],
    ],
    // 2 — full arc, spreading
    [
      [12, 7, SPARK],
      [20, 7, SPARK],
      [14, 4, GLOW],
      [18, 4, SPARK_HOT],
      [16, 3, SPARK],
      [10, 9, GLOW],
      [22, 9, GLOW],
    ],
    // 3 — dying embers, sparse and low
    [
      [11, 6, GLOW],
      [21, 6, GLOW],
      [16, 2, SPARK],
    ],
  ];
  for (const [x, y, c] of bursts[i] ?? []) {
    setPixelMut(buf, x, y, c);
  }
  return buf;
}

function layer(id: string, name: string, buffer: PixelBuffer, over: Partial<Layer> = {}): Layer {
  return { id, name, visible: true, locked: false, opacity: 100, blend: 'normal', buffer, ...over };
}

/** The seeded four-frame forge animation (aligned Anvil + Spark layers per frame). */
export function seedForgeFrames(): Frame[] {
  const heats = [3, 2, 1, 0];
  return heats.map((heat, i) =>
    makeFrame(
      `frame-${i + 1}`,
      [layer('layer-1', 'Anvil', anvilBuffer(heat)), layer('layer-2', 'Spark', sparkBuffer(i))],
      120,
    ),
  );
}
