/**
 * WCAG 2.2 relative-luminance & contrast-ratio math — pure and DOM-free.
 *
 * Used to *prove* the design tokens meet AA (constitution: WCAG 2.2 AA, state
 * never conveyed by hue alone). Self-contained (its own tiny hex parser) so it
 * does not depend on the engine `src/core/color.ts` that lands in U-003.
 *
 * Reference: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

/** An sRGB triple, 0..255 per channel. */
export type Rgb = readonly [number, number, number];

const HEX3 = /^#?([0-9a-fA-F]{3})$/;
const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX8 = /^#?([0-9a-fA-F]{8})$/;

/**
 * Parse `#RGB`, `#RRGGBB`, or `#RRGGBBAA` to an [r,g,b] triple (alpha ignored —
 * contrast is computed against opaque backgrounds). Throws on malformed input:
 * these are our own compile-time tokens, so a bad value is a programmer error.
 */
export function parseHex(hex: string): Rgb {
  const s = hex.trim();
  const m3 = HEX3.exec(s);
  if (m3) {
    const h = m3[1];
    const r = Number.parseInt(h[0] + h[0], 16);
    const g = Number.parseInt(h[1] + h[1], 16);
    const b = Number.parseInt(h[2] + h[2], 16);
    return [r, g, b];
  }
  const m6 = HEX6.exec(s) ?? HEX8.exec(s);
  if (m6) {
    const h = m6[1];
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`contrast.parseHex: invalid hex color "${hex}"`);
}

/** Linearize one 0..255 sRGB channel per the WCAG transfer function. */
function channelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0..1) of an sRGB color. */
export function relativeLuminance(color: Rgb): number {
  const r = channelToLinear(color[0]);
  const g = channelToLinear(color[1]);
  const b = channelToLinear(color[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colors, from 1 (identical) to 21 (black on white).
 * Accepts hex strings or already-parsed triples; order-independent.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? parseHex(b) : b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA for normal-size text (≥ 4.5:1). */
export function meetsAA(a: string | Rgb, b: string | Rgb): boolean {
  return contrastRatio(a, b) >= 4.5;
}

/** AA for large text / bold ≥ 18.66px (≥ 3:1). */
export function meetsAALarge(a: string | Rgb, b: string | Rgb): boolean {
  return contrastRatio(a, b) >= 3;
}

/**
 * AA for non-text UI components & graphical objects (≥ 3:1) — e.g. the focus
 * ring and bevel edges (WCAG 2.2 SC 1.4.11 Non-text Contrast).
 */
export function meetsNonTextContrast(a: string | Rgb, b: string | Rgb): boolean {
  return contrastRatio(a, b) >= 3;
}
