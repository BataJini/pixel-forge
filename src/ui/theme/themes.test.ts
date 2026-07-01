import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, meetsNonTextContrast } from './contrast';
import { CSS_VAR, DEFAULT_THEME, isThemeId, THEME_IDS, THEMES, TOKEN_KEYS } from './themes';

// Criterion 1 (held-out): the token source defines the 13 tokens for BOTH
// contractual themes with the EXACT design-direction hexes.
const ARCADE_EXPECTED: Record<string, string> = {
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
const FORGE_EXPECTED: Record<string, string> = {
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

describe('U-002 criterion 1 — exact token hexes', () => {
  it('defines all 13 tokens per theme', () => {
    expect(TOKEN_KEYS).toHaveLength(13);
    for (const id of THEME_IDS) {
      for (const key of TOKEN_KEYS) {
        expect(THEMES[id].tokens[key]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
  it('Arcade CRT ramp matches design-direction exactly', () => {
    for (const key of TOKEN_KEYS) {
      expect(THEMES.arcade.tokens[key]).toBe(ARCADE_EXPECTED[key]);
    }
  });
  it('Forge ramp matches design-direction exactly', () => {
    for (const key of TOKEN_KEYS) {
      expect(THEMES.forge.tokens[key]).toBe(FORGE_EXPECTED[key]);
    }
  });
});

describe('U-002 criterion 2 — default theme', () => {
  it('defaults to Arcade CRT with electric-cyan ember', () => {
    expect(DEFAULT_THEME).toBe('arcade');
    expect(THEMES[DEFAULT_THEME].tokens.ember).toBe('#00F0FF');
  });
});

describe('CSS var mapping', () => {
  it('maps every token key to a --c-* property', () => {
    for (const key of TOKEN_KEYS) {
      expect(CSS_VAR[key]).toMatch(/^--c-/);
    }
    expect(CSS_VAR.ironHi).toBe('--c-iron-hi');
    expect(CSS_VAR.emberDeep).toBe('--c-ember-deep');
  });
});

// Constitution: WCAG 2.2 AA on ALL base tokens, for every switchable theme —
// so re-tempering the chrome never drops legibility below AA.
describe('every theme meets WCAG AA on its base tokens', () => {
  for (const id of THEME_IDS) {
    const t = THEMES[id].tokens;
    it(`${id}: primary text (steel) on anvil >= 7:1`, () => {
      expect(contrastRatio(t.steel, t.anvil)).toBeGreaterThanOrEqual(7);
    });
    it(`${id}: muted text (ash) on anvil >= 4.5:1`, () => {
      expect(meetsAA(t.ash, t.anvil)).toBe(true);
    });
    it(`${id}: dark text on the ember CTA face >= 4.5:1`, () => {
      expect(meetsAA(t.anvil, t.ember)).toBe(true);
    });
    it(`${id}: focus ring (spark) on anvil >= 3:1 (non-text)`, () => {
      expect(meetsNonTextContrast(t.spark, t.anvil)).toBe(true);
    });
    it(`${id}: steel on iron panel surface >= 4.5:1`, () => {
      expect(meetsAA(t.steel, t.iron)).toBe(true);
    });
  }
});

describe('isThemeId guard', () => {
  it('accepts known ids and rejects junk', () => {
    expect(isThemeId('arcade')).toBe(true);
    expect(isThemeId('forge')).toBe(true);
    expect(isThemeId('nope')).toBe(false);
    expect(isThemeId(42)).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });
});
