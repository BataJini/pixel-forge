/**
 * CRT display-layer level model (design-direction.md · CRT atmospherics).
 * Pure constants + guards, DOM-free so they are unit-testable and shared by the
 * ThemeProvider and the CrtOverlay component.
 */

export type CrtLevel = 'off' | 'subtle' | 'full';

export const CRT_LEVELS: readonly CrtLevel[] = ['off', 'subtle', 'full'];

/** Arcade CRT is the default theme, so the layer defaults to Subtle on first load. */
export const DEFAULT_CRT_LEVEL: CrtLevel = 'subtle';

/** Type guard for untrusted persisted CRT-level values. */
export function isCrtLevel(value: unknown): value is CrtLevel {
  return typeof value === 'string' && (CRT_LEVELS as readonly string[]).includes(value);
}

/**
 * The level actually rendered: clean mode is a one-click escape hatch that
 * removes scanlines + glow entirely WITHOUT discarding the user's chosen level,
 * so toggling clean mode off restores it.
 */
export function effectiveCrtLevel(level: CrtLevel, cleanMode: boolean): CrtLevel {
  return cleanMode ? 'off' : level;
}
