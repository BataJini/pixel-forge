import type { KeyboardEvent } from 'react';
import { rgbaToHex } from '../../core/color';
import type { RGBA } from '../../core/types';
import { swatchStyle } from './swatchStyle';

/** Shift+Enter (or Alt+Enter) on a recent swatch assigns the background — the
 * keyboard equivalent of right-click, so bg is reachable without a pointer.
 * Enter-only so `preventDefault` cleanly cancels the native button activation. */
function isSetBgKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.shiftKey || e.altKey);
}

export interface RecentColorsProps {
  readonly colors: readonly RGBA[];
  readonly onPick: (color: RGBA) => void;
  readonly onPickBg: (color: RGBA) => void;
}

/**
 * The recent-colors strip. Click sets the foreground; right-click sets the
 * background (matching the palette grid). Empty until the user picks a color.
 */
export function RecentColors({ colors, onPick, onPickBg }: RecentColorsProps) {
  return (
    <div className="pf-recent">
      <span className="pf-label pf-recent__label">Recent</span>
      {colors.length === 0 ? (
        <p className="pf-recent__empty pf-readout">No colors yet</p>
      ) : (
        <ul className="pf-recent__grid" aria-label="Recently used colors">
          {colors.map((c) => {
            const hex = rgbaToHex(c, c[3] !== 255);
            return (
              // Recents are de-duplicated, so the alpha-hex is a stable unique key.
              <li key={hex}>
                <button
                  type="button"
                  className="pf-recent__swatch pf-checker"
                  style={swatchStyle(c)}
                  aria-label={`Recent color ${hex}. Enter sets foreground, Shift+Enter sets background.`}
                  title={hex}
                  onClick={() => onPick(c)}
                  onKeyDown={(e) => {
                    if (isSetBgKey(e)) {
                      e.preventDefault();
                      onPickBg(c);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onPickBg(c);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
