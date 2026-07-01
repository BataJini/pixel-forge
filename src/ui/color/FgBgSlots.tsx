import { rgbaToHex } from '../../core/color';
import type { RGBA } from '../../core/types';
import { swatchStyle } from './swatchStyle';

export interface FgBgSlotsProps {
  readonly fg: RGBA;
  readonly bg: RGBA;
  readonly onSwap: () => void;
  readonly onReset: () => void;
  readonly onPickFg: () => void;
  readonly onPickBg: () => void;
}

/**
 * The foreground / background color slots with swap (X) and reset (D) controls.
 * The two swatches overlap like a classic paint program; the fg sits on top.
 * Selecting a slot focuses it in the picker (the panel scrolls/updates picker).
 */
export function FgBgSlots({ fg, bg, onSwap, onReset, onPickFg, onPickBg }: FgBgSlotsProps) {
  return (
    <div className="pf-slots">
      <div className="pf-slots__stack">
        <button
          type="button"
          className="pf-slots__swatch pf-slots__swatch--bg pf-checker"
          style={swatchStyle(bg)}
          onClick={onPickBg}
          aria-label={`Background color ${rgbaToHex(bg, bg[3] !== 255)}. Select to edit.`}
        />
        <button
          type="button"
          className="pf-slots__swatch pf-slots__swatch--fg pf-checker"
          style={swatchStyle(fg)}
          onClick={onPickFg}
          aria-label={`Foreground color ${rgbaToHex(fg, fg[3] !== 255)}. Select to edit.`}
        />
      </div>
      <div className="pf-slots__actions">
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          onClick={onSwap}
          title="Swap foreground and background (X)"
          aria-label="Swap foreground and background"
        >
          Swap ⇄
        </button>
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          onClick={onReset}
          title="Reset to black and white (D)"
          aria-label="Reset foreground and background to black and white"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
