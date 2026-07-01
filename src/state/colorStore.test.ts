import { describe, expect, it } from 'vitest';
import { BUILTIN_PALETTES, makePalette, snapColorToPalette } from '../core/palette';
import type { RGBA } from '../core/types';
import {
  type ColorState,
  colorReducer,
  effectivePaintColor,
  initialColorState,
  pushRecent,
  RECENT_CAP,
  RESET_BG,
  RESET_FG,
} from './colorStore';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const MAGENTA: RGBA = [255, 0, 255, 255];

describe('pushRecent', () => {
  it('prepends, de-duplicates (moving to front), and caps', () => {
    let list = pushRecent([], RED);
    list = pushRecent(list, GREEN);
    expect(list).toEqual([GREEN, RED]);
    // re-adding RED moves it to the front, no duplicate
    list = pushRecent(list, RED);
    expect(list).toEqual([RED, GREEN]);
  });

  it('never grows beyond the cap', () => {
    let list: RGBA[] = [];
    for (let i = 0; i < RECENT_CAP + 10; i++) {
      list = pushRecent(list, [i, 0, 0, 255]);
    }
    expect(list).toHaveLength(RECENT_CAP);
  });

  it('does not mutate the input array', () => {
    const input: RGBA[] = [GREEN];
    const out = pushRecent(input, RED);
    expect(input).toEqual([GREEN]);
    expect(out).not.toBe(input);
  });
});

describe('colorReducer', () => {
  const base: ColorState = initialColorState();

  it('sets fg/bg and optionally remembers', () => {
    const s1 = colorReducer(base, { type: 'setFg', color: RED, remember: true });
    expect(s1.fg).toEqual(RED);
    expect(s1.recent).toEqual([RED]);
    const s2 = colorReducer(base, { type: 'setBg', color: GREEN });
    expect(s2.bg).toEqual(GREEN);
    expect(s2.recent).toEqual([]); // remember not requested
  });

  it('swaps fg and bg', () => {
    const s = colorReducer({ ...base, fg: RED, bg: GREEN }, { type: 'swap' });
    expect(s.fg).toEqual(GREEN);
    expect(s.bg).toEqual(RED);
  });

  it('resets to black/white', () => {
    const s = colorReducer({ ...base, fg: RED, bg: GREEN }, { type: 'reset' });
    expect(s.fg).toEqual(RESET_FG);
    expect(s.bg).toEqual(RESET_BG);
  });

  it('loads a palette and toggles indexed mode', () => {
    const loaded = colorReducer(base, { type: 'loadPalette', palette: BUILTIN_PALETTES.gameboy });
    expect(loaded.palette.id).toBe('gameboy');
    expect(colorReducer(base, { type: 'toggleIndexed' }).indexed).toBe(true);
    expect(colorReducer(base, { type: 'setIndexed', value: true }).indexed).toBe(true);
  });

  it('hydrates recents with a capped copy', () => {
    const many: RGBA[] = Array.from({ length: RECENT_CAP + 5 }, (_, i) => [i, 0, 0, 255]);
    const s = colorReducer(base, { type: 'hydrateRecent', recent: many });
    expect(s.recent).toHaveLength(RECENT_CAP);
  });

  it('defaults to free-color mode with pico-8 active', () => {
    expect(base.indexed).toBe(false);
    expect(base.palette.id).toBe('pico8');
  });
});

describe('effectivePaintColor (indexed / palette-lock enforcement)', () => {
  const gameboy = BUILTIN_PALETTES.gameboy; // 4 greens, none magenta

  it('returns the raw foreground verbatim in free-color mode (lock off)', () => {
    const state: ColorState = { ...initialColorState(gameboy), fg: MAGENTA, indexed: false };
    expect(effectivePaintColor(state)).toEqual(MAGENTA);
  });

  it('snaps an off-palette foreground to the nearest palette entry when locked', () => {
    const state: ColorState = { ...initialColorState(gameboy), fg: MAGENTA, indexed: true };
    const drawn = effectivePaintColor(state);
    // The drawn color must be an actual palette color — never the raw magenta.
    expect(drawn).not.toEqual(MAGENTA);
    expect(gameboy.colors).toContainEqual(drawn);
    expect(drawn).toEqual(snapColorToPalette(gameboy, MAGENTA));
  });

  it('leaves an in-palette foreground unchanged when locked', () => {
    const inPalette = gameboy.colors[2];
    const state: ColorState = { ...initialColorState(gameboy), fg: inPalette, indexed: true };
    expect(effectivePaintColor(state)).toEqual(inPalette);
  });

  it('draws nothing (transparent) when locked to an empty palette', () => {
    const empty = makePalette('Empty', []);
    const state: ColorState = { ...initialColorState(empty), fg: MAGENTA, indexed: true };
    expect(effectivePaintColor(state)).toEqual([0, 0, 0, 0]);
  });

  it('preserves a transparent (eraser) foreground when locked', () => {
    const state: ColorState = { ...initialColorState(gameboy), fg: [0, 0, 0, 0], indexed: true };
    expect(effectivePaintColor(state)).toEqual([0, 0, 0, 0]);
  });

  it('returns a fresh tuple (never the stored fg reference)', () => {
    const state = initialColorState(gameboy);
    expect(effectivePaintColor(state)).not.toBe(state.fg);
  });
});
