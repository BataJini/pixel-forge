/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSS_VAR, THEME_IDS, THEMES, TOKEN_KEYS } from './themes';

/**
 * Cross-check the applied stylesheet (src/styles/tokens.css) against the TS token
 * source (themes.ts). Because themes.ts is asserted equal to the design-direction
 * hexes in themes.test.ts, matching the CSS to themes.ts transitively proves the
 * CSS carries the EXACT contractual hexes for every theme — and guards against
 * the two drifting apart (U-002 criterion 1).
 */
const css = readFileSync(
  fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)),
  'utf8',
);

function themeBlock(id: string): string {
  const re = new RegExp(`\\[data-theme="${id}"\\][^{]*\\{([^}]*)\\}`);
  const match = re.exec(css);
  if (!match) {
    throw new Error(`tokens.css has no block for theme "${id}"`);
  }
  return match[1];
}

function parseVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--c-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let m = re.exec(block);
  while (m !== null) {
    out[m[1]] = m[2].toLowerCase();
    m = re.exec(block);
  }
  return out;
}

describe('tokens.css matches the theme source exactly', () => {
  for (const id of THEME_IDS) {
    it(`${id} block defines all 13 tokens with the source hexes`, () => {
      const vars = parseVars(themeBlock(id));
      for (const key of TOKEN_KEYS) {
        expect(vars[CSS_VAR[key]]).toBe(THEMES[id].tokens[key].toLowerCase());
      }
    });
  }

  it('the default :root block resolves ember to Arcade electric-cyan', () => {
    // The arcade block is the combined `:root, :root[data-theme="arcade"]`.
    const vars = parseVars(themeBlock('arcade'));
    expect(vars['--c-ember']).toBe('#00f0ff');
  });

  it('declares no border-radius and no blur() on chrome tokens', () => {
    // Strip comments so prose ("No border-radius on chrome") is not matched.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/border-radius/);
    expect(code).not.toMatch(/blur\(/);
  });
});
