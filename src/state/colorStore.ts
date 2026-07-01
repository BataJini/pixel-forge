/**
 * src/state/colorStore.ts — the pure color/tool state for the Color & Palette
 * panel (master-spec §4.2 "Tool store": fg/bg color, recent colors, active
 * palette, indexed flag).
 *
 * PURE and deterministic (no DOM): a reducer + helpers so the behavior is unit
 * testable in isolation. The React binding (context/provider) and persistence
 * side-effects live in src/ui and src/platform respectively.
 */
import { BUILTIN_PALETTES, snapColorToPalette } from '../core/palette';
import type { Palette, RGBA } from '../core/types';

/** How many recent colors are retained (dedup + cap; design §3.3). */
export const RECENT_CAP = 24;

/** Black/white fg/bg reset targets (spec §3.3: "D reset to black/white"). */
export const RESET_FG: RGBA = [0, 0, 0, 255];
export const RESET_BG: RGBA = [255, 255, 255, 255];

/**
 * The active *drawing* palette on first load (L-2 — a deliberate choice, not an
 * accidental deviation). Master-spec §3.3/§4.4 labels **Forge Ramp** the "default
 * UI"/"UI default theme" ramp — i.e. the chrome/theme accent ramp (the 13 design
 * tokens), not a drawing palette; the first-load *theme* is Arcade CRT per the
 * constitution. For the drawing grid we default to **PICO-8**: a versatile,
 * artist-friendly 16-color classic that is far more useful to paint with than a
 * 13-swatch UI accent ramp. Indexed mode is off (free-color default, §3.3), so
 * this palette seeds the grid without restricting drawing. The first-run New
 * dialog (U-011/U-012) lets the user pick a different palette.
 */
export const DEFAULT_ACTIVE_PALETTE: Palette = BUILTIN_PALETTES.pico8;

export interface ColorState {
  /** Foreground (primary) paint color. */
  readonly fg: RGBA;
  /** Background (secondary) paint color. */
  readonly bg: RGBA;
  /** Recently used colors, most-recent first, deduped and capped. */
  readonly recent: readonly RGBA[];
  /** The active palette shown in the grid (built-in or imported/edited). */
  readonly palette: Palette;
  /** Indexed / palette-lock mode. Off by default (free color). */
  readonly indexed: boolean;
}

export type ColorAction =
  | { readonly type: 'setFg'; readonly color: RGBA; readonly remember?: boolean }
  | { readonly type: 'setBg'; readonly color: RGBA; readonly remember?: boolean }
  | { readonly type: 'swap' }
  | { readonly type: 'reset' }
  | { readonly type: 'remember'; readonly color: RGBA }
  | { readonly type: 'hydrateRecent'; readonly recent: readonly RGBA[] }
  | { readonly type: 'loadPalette'; readonly palette: Palette }
  | { readonly type: 'setPalette'; readonly palette: Palette }
  | { readonly type: 'toggleIndexed' }
  | { readonly type: 'setIndexed'; readonly value: boolean };

function cloneColor(c: RGBA): RGBA {
  return [c[0], c[1], c[2], c[3]];
}

/** Pack an RGBA into an unsigned 32-bit key (for dedup). */
function packRgba(c: RGBA): number {
  return (
    (((c[0] & 0xff) << 24) | ((c[1] & 0xff) << 16) | ((c[2] & 0xff) << 8) | (c[3] & 0xff)) >>> 0
  );
}

/**
 * Prepend `color` to the recents, de-duplicating (an existing entry moves to the
 * front) and capping at `cap`. Returns a NEW array; inputs are never mutated.
 */
export function pushRecent(list: readonly RGBA[], color: RGBA, cap: number = RECENT_CAP): RGBA[] {
  const key = packRgba(color);
  const next: RGBA[] = [cloneColor(color)];
  for (const c of list) {
    if (packRgba(c) !== key && next.length < cap) {
      next.push(cloneColor(c));
    }
  }
  return next;
}

/** A fully transparent color — the eraser / "draw nothing" value. */
const TRANSPARENT: RGBA = [0, 0, 0, 0];

/**
 * The color the pencil actually paints with, given the store state. In free-color
 * mode this is the foreground verbatim; in indexed / palette-lock mode it is the
 * foreground snapped to the nearest active-palette entry, so an off-palette color
 * is impossible to draw while the lock is on (master-spec §3.3). An empty active
 * palette while locked yields transparent (nothing is drawable — strict lock). A
 * fully transparent foreground (eraser) is preserved by `snapColorToPalette`.
 * Pure: always returns a fresh tuple and never mutates the input.
 */
export function effectivePaintColor(state: ColorState): RGBA {
  if (!state.indexed) {
    return cloneColor(state.fg);
  }
  if (state.palette.colors.length === 0) {
    return cloneColor(TRANSPARENT);
  }
  return snapColorToPalette(state.palette, state.fg);
}

/** The initial store state (free-color mode, default palette, empty recents). */
export function initialColorState(palette: Palette = DEFAULT_ACTIVE_PALETTE): ColorState {
  return {
    fg: cloneColor(RESET_FG),
    bg: cloneColor(RESET_BG),
    recent: [],
    palette,
    indexed: false,
  };
}

/** Pure reducer for the color/palette store. */
export function colorReducer(state: ColorState, action: ColorAction): ColorState {
  switch (action.type) {
    case 'setFg':
      return {
        ...state,
        fg: cloneColor(action.color),
        recent: action.remember ? pushRecent(state.recent, action.color) : state.recent,
      };
    case 'setBg':
      return {
        ...state,
        bg: cloneColor(action.color),
        recent: action.remember ? pushRecent(state.recent, action.color) : state.recent,
      };
    case 'swap':
      return { ...state, fg: cloneColor(state.bg), bg: cloneColor(state.fg) };
    case 'reset':
      return { ...state, fg: cloneColor(RESET_FG), bg: cloneColor(RESET_BG) };
    case 'remember':
      return { ...state, recent: pushRecent(state.recent, action.color) };
    case 'hydrateRecent':
      return { ...state, recent: action.recent.slice(0, RECENT_CAP).map(cloneColor) };
    case 'loadPalette':
    case 'setPalette':
      return { ...state, palette: action.palette };
    case 'toggleIndexed':
      return { ...state, indexed: !state.indexed };
    case 'setIndexed':
      return { ...state, indexed: action.value };
    default:
      return state;
  }
}
