import { type KeyboardEvent, useRef } from 'react';
import { rgbaToHex } from '../../core/color';
import type { Palette } from '../../core/types';
import { swatchStyle } from './swatchStyle';

const LONG_PRESS_MS = 450;

/** Shift+Enter (or Alt+Enter) on a swatch assigns the background — the keyboard
 * equivalent of right-click / long-press, so a keyboard-only user can set bg
 * (WCAG 2.1.1). Enter-only (not Space) so `preventDefault` cleanly cancels the
 * native button activation and plain Enter still sets the foreground. */
function isSetBgKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.shiftKey || e.altKey);
}

export interface PaletteGridProps {
  readonly palette: Palette;
  readonly selectedIndex: number | null;
  readonly onPickFg: (index: number) => void;
  readonly onPickBg: (index: number) => void;
  readonly onSelect: (index: number) => void;
}

interface Press {
  index: number;
  timer: ReturnType<typeof setTimeout>;
  long: boolean;
}

/**
 * The active palette swatch grid. Click sets the foreground and selects the
 * swatch; right-click or a touch long-press sets the background. The selected
 * swatch is highlighted for the edit toolbar. Fully keyboard-focusable.
 */
export function PaletteGrid({
  palette,
  selectedIndex,
  onPickFg,
  onPickBg,
  onSelect,
}: PaletteGridProps) {
  const press = useRef<Press | null>(null);

  const start = (index: number): void => {
    const timer = setTimeout(() => {
      if (press.current) {
        press.current.long = true;
        onPickBg(index);
      }
    }, LONG_PRESS_MS);
    press.current = { index, timer, long: false };
  };
  const end = (): void => {
    if (press.current) {
      clearTimeout(press.current.timer);
    }
  };
  const click = (index: number): void => {
    if (press.current?.long) {
      press.current = null;
      return;
    }
    onSelect(index);
    onPickFg(index);
    press.current = null;
  };

  if (palette.colors.length === 0) {
    return <p className="pf-palette__empty pf-readout">Empty palette — add a swatch below.</p>;
  }

  return (
    <ul className="pf-palette__grid" aria-label={`${palette.name} palette`}>
      {palette.colors.map((c, i) => {
        const hex = rgbaToHex(c, c[3] !== 255);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: palette swatches can duplicate and reorder; the position index is the stable key.
          <li key={`${hex}-${i}`}>
            <button
              type="button"
              className="pf-palette__swatch pf-checker"
              data-selected={selectedIndex === i ? 'true' : undefined}
              style={swatchStyle(c)}
              aria-label={`Palette color ${i + 1}: ${hex}. Enter sets foreground, Shift+Enter sets background.`}
              aria-pressed={selectedIndex === i}
              title={hex}
              onPointerDown={() => start(i)}
              onPointerUp={end}
              onPointerLeave={end}
              onPointerCancel={end}
              onClick={() => click(i)}
              onKeyDown={(e) => {
                if (isSetBgKey(e)) {
                  e.preventDefault();
                  onPickBg(i);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onPickBg(i);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
