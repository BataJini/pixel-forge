import { type KeyboardEvent, useState } from 'react';
import { rgbaToHex } from '../../core/color';
import { addSwatch, moveSwatch, removeSwatchAt, setSwatchAt } from '../../core/palette';
import type { RGBA } from '../../core/types';
import { effectivePaintColor } from '../../state/colorStore';
import { Panel } from '../components/Panel';
import { ColorProvider, useColorStore } from './ColorProvider';
import { FgBgSlots } from './FgBgSlots';
import { HsvPicker } from './HsvPicker';
import { PaletteGrid } from './PaletteGrid';
import { PaletteMenu } from './PaletteMenu';
import { PaletteSwapPreview } from './PaletteSwapPreview';
import { RecentColors } from './RecentColors';
import { swatchStyle } from './swatchStyle';
import './color-panel.css';

type Slot = 'fg' | 'bg';

function PanelBody() {
  const { state, actions } = useColorStore();
  const [slot, setSlot] = useState<Slot>('fg');
  const [selected, setSelected] = useState<number | null>(null);

  // The exact color the pencil will draw with — snapped to the palette while the
  // indexed/palette-lock is on (shown to the user so the lock is never silent).
  const drawColor = effectivePaintColor(state);
  const editing = slot === 'fg' ? state.fg : state.bg;
  const setEditing = (color: RGBA, remember = false): void => {
    if (slot === 'fg') {
      actions.setFg(color, remember);
    } else {
      actions.setBg(color, remember);
    }
  };

  const pickFg = (color: RGBA): void => {
    setSlot('fg');
    actions.setFg(color, true);
  };

  const editSelected = (mutate: (index: number) => void): void => {
    if (selected !== null && selected >= 0 && selected < state.palette.colors.length) {
      mutate(selected);
    }
  };

  // Panel-scoped shortcuts (X swap, D reset) when not typing into a field.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }
    if (e.key === 'x' || e.key === 'X') {
      actions.swap();
    } else if (e.key === 'd' || e.key === 'D') {
      actions.reset();
    }
  };

  return (
    <Panel title="Color / Palette" className="pf-color" onKeyDown={onKeyDown}>
      <FgBgSlots
        fg={state.fg}
        bg={state.bg}
        onSwap={actions.swap}
        onReset={actions.reset}
        onPickFg={() => setSlot('fg')}
        onPickBg={() => setSlot('bg')}
      />

      <p className="pf-color__editing pf-readout">
        Editing <b>{slot === 'fg' ? 'foreground' : 'background'}</b>
      </p>

      {state.indexed && (
        <p className="pf-color__lock pf-readout" role="status">
          <span
            className="pf-color__lockswatch pf-checker"
            style={swatchStyle(drawColor)}
            aria-hidden="true"
          />
          Palette-locked — drawing as <b>{rgbaToHex(drawColor, drawColor[3] !== 255)}</b>
        </p>
      )}

      <HsvPicker
        value={editing}
        onChange={(c) => setEditing(c)}
        onCommit={(c) => setEditing(c, true)}
      />

      <RecentColors
        colors={state.recent}
        onPick={pickFg}
        onPickBg={(c) => actions.setBg(c, true)}
      />

      <div className="pf-color__section">
        <PaletteGrid
          palette={state.palette}
          selectedIndex={selected}
          onPickFg={(i) => pickFg(state.palette.colors[i])}
          onPickBg={(i) => actions.setBg(state.palette.colors[i], true)}
          onSelect={setSelected}
        />
        <fieldset className="pf-color__swatchbar">
          <legend className="pf-visually-hidden">Edit swatches</legend>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            onClick={() => {
              actions.setPalette(addSwatch(state.palette, state.fg));
              setSelected(state.palette.colors.length);
            }}
          >
            + Add fg
          </button>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={selected === null}
            onClick={() =>
              editSelected((i) => actions.setPalette(setSwatchAt(state.palette, i, state.fg)))
            }
          >
            Set
          </button>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={selected === null}
            onClick={() =>
              editSelected((i) => {
                actions.setPalette(removeSwatchAt(state.palette, i));
                setSelected(null);
              })
            }
          >
            Remove
          </button>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={selected === null || selected === 0}
            aria-label="Move swatch left"
            onClick={() =>
              editSelected((i) => {
                actions.setPalette(moveSwatch(state.palette, i, i - 1));
                setSelected(i - 1);
              })
            }
          >
            ◀
          </button>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={selected === null || selected >= state.palette.colors.length - 1}
            aria-label="Move swatch right"
            onClick={() =>
              editSelected((i) => {
                actions.setPalette(moveSwatch(state.palette, i, i + 1));
                setSelected(i + 1);
              })
            }
          >
            ▶
          </button>
        </fieldset>
      </div>

      <PaletteMenu
        palette={state.palette}
        indexed={state.indexed}
        onLoadPalette={(p) => {
          actions.loadPalette(p);
          setSelected(null);
        }}
        onToggleIndexed={actions.toggleIndexed}
      />

      <PaletteSwapPreview palette={state.palette} />
    </Panel>
  );
}

/**
 * The full Color & Palette workbench panel (master-spec §3.3): fg/bg slots with
 * swap/reset, an HSV+hue+alpha+hex picker, a persisted recent-colors strip, the
 * active palette grid with swatch editing, the palette menu (load/import/export/
 * new + indexed toggle), and a live indexed palette-swap preview.
 *
 * When used standalone it provides its own store; when the app already mounts a
 * `ColorProvider` higher up, pass `standalone={false}` to share that store.
 */
export function ColorPalettePanel({ standalone = true }: { standalone?: boolean }) {
  if (!standalone) {
    return <PanelBody />;
  }
  return (
    <ColorProvider>
      <PanelBody />
    </ColorProvider>
  );
}

export default ColorPalettePanel;
