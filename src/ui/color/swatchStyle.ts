import type { CSSProperties } from 'react';
import { rgbaToHex } from '../../core/color';
import type { RGBA } from '../../core/types';

/**
 * Build the inline style for a `.pf-checker` swatch: the color rides on the
 * `--swatch` custom property so CSS can composite it OVER the transparency
 * checkerboard (alpha shows through), with no soft gradients on chrome.
 */
export function swatchStyle(color: RGBA): CSSProperties {
  return { ['--swatch' as string]: rgbaToHex(color, true) } as CSSProperties;
}
