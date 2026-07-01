/**
 * Theme token source of truth (machine-readable).
 *
 * The 13 named PixelForge tokens for every chrome theme. Component styles read
 * these ONLY through the CSS custom properties in `src/styles/tokens.css`; this
 * TS mirror exists so tests can assert exact hexes, contrast ratios, and drift
 * against the stylesheet. Same token *names* across themes — only values swap —
 * so components are theme-agnostic (design-direction.md).
 *
 * `arcade` (Arcade CRT) is the DEFAULT on first load. `forge` is the bespoke
 * workshop identity. `gameboy` and `amber` are spec-grounded hardware re-tempers
 * (design-direction.md gives the Amber ramp and the Game Boy olive-monochrome
 * direction). Additional hardware chrome themes (PICO-8/NES/C64/CGA) are layered
 * in with the palette data unit (U-005) and Settings UI (U-012).
 */

/** The 13 token keys (camelCase); map to `--c-*` custom properties below. */
export const TOKEN_KEYS = [
  'anvil',
  'iron',
  'ironHi',
  'slag',
  'ash',
  'steel',
  'ember',
  'emberDeep',
  'spark',
  'flame',
  'quench',
  'patina',
  'warning',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type ThemeTokens = Readonly<Record<TokenKey, string>>;

/** camelCase token key → CSS custom property name. */
export const CSS_VAR: Readonly<Record<TokenKey, string>> = {
  anvil: '--c-anvil',
  iron: '--c-iron',
  ironHi: '--c-iron-hi',
  slag: '--c-slag',
  ash: '--c-ash',
  steel: '--c-steel',
  ember: '--c-ember',
  emberDeep: '--c-ember-deep',
  spark: '--c-spark',
  flame: '--c-flame',
  quench: '--c-quench',
  patina: '--c-patina',
  warning: '--c-warning',
};

export type ThemeId = 'arcade' | 'forge' | 'gameboy' | 'amber';

export interface ThemeMeta {
  readonly id: ThemeId;
  readonly label: string;
  /** One-line vibe used in tooltips / settings. */
  readonly blurb: string;
  readonly tokens: ThemeTokens;
}

/**
 * Arcade CRT — neon on black. DEFAULT theme. EXACT hexes are contractual
 * (docs/acceptance/U-002 + design-direction.md); do not alter.
 */
const ARCADE: ThemeTokens = {
  anvil: '#06070C',
  iron: '#10131E',
  ironHi: '#232A3E',
  slag: '#020308',
  ash: '#7C86A8',
  steel: '#E8F0FF',
  ember: '#00F0FF',
  emberDeep: '#0090C4',
  spark: '#FF2E88',
  flame: '#FFD300',
  quench: '#39FF14',
  patina: '#39FF14',
  warning: '#FF3B30',
};

/**
 * Forge — the bespoke ember-on-iron workshop. EXACT hexes are contractual
 * (docs/acceptance/U-002 + design-direction.md); do not alter.
 */
const FORGE: ThemeTokens = {
  anvil: '#12100E',
  iron: '#2A2622',
  ironHi: '#4A423A',
  slag: '#0C0A08',
  ash: '#8A7E70',
  steel: '#E8DFD2',
  ember: '#FF6A1A',
  emberDeep: '#C24A12',
  spark: '#FFB03A',
  flame: '#FFE08A',
  quench: '#2FA8C4',
  patina: '#5F9E5A',
  warning: '#E23B2E',
};

/**
 * Game Boy — olive-monochrome re-temper (DMG family greens). Semantic success/
 * error stay green/red-brick so state is never signalled by the accent hue alone.
 * All text/accents AA-verified against `anvil` in themes.contrast.test.ts.
 */
const GAMEBOY: ThemeTokens = {
  anvil: '#0B1A0B',
  iron: '#12240F',
  ironHi: '#2C4C1E',
  slag: '#050D05',
  ash: '#8FB52E',
  steel: '#C3E24E',
  ember: '#9BBC0F',
  emberDeep: '#306230',
  spark: '#D3EC24',
  flame: '#DCF08C',
  quench: '#6BA53A',
  patina: '#9BBC0F',
  warning: '#DA6A2E',
};

/**
 * Amber Terminal — monochrome amber on near-black (design-direction ramp
 * #1A0E05 → #5A2E0A → #C9741A → #FFB84D). Semantic success/error retain
 * green/red for legibility. AA-verified against `anvil`.
 */
const AMBER: ThemeTokens = {
  anvil: '#1A0E05',
  iron: '#241405',
  ironHi: '#4A2A0E',
  slag: '#0A0602',
  ash: '#D0923E',
  steel: '#FFDCA8',
  ember: '#F59A2E',
  emberDeep: '#C9741A',
  spark: '#FFB84D',
  flame: '#FFE6BE',
  quench: '#E0A657',
  patina: '#7BB03A',
  warning: '#E2503A',
};

export const THEMES: Readonly<Record<ThemeId, ThemeMeta>> = {
  arcade: {
    id: 'arcade',
    label: 'Arcade CRT',
    blurb: 'Neon on black — scanlines & glow forward. The default.',
    tokens: ARCADE,
  },
  forge: {
    id: 'forge',
    label: 'Forge',
    blurb: 'Ember on iron — the bespoke blacksmith workshop.',
    tokens: FORGE,
  },
  gameboy: {
    id: 'gameboy',
    label: 'Game Boy',
    blurb: 'Olive monochrome — DMG dot-matrix greens.',
    tokens: GAMEBOY,
  },
  amber: {
    id: 'amber',
    label: 'Amber Terminal',
    blurb: 'Warm amber phosphor on near-black.',
    tokens: AMBER,
  },
};

export const THEME_IDS: readonly ThemeId[] = ['arcade', 'forge', 'gameboy', 'amber'];

/** Default theme on first load (Arcade CRT). Contractual. */
export const DEFAULT_THEME: ThemeId = 'arcade';

/** Type guard for untrusted persisted/URL theme values. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}
