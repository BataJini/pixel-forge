import { useId, useState } from 'react';
import {
  BUILTIN_PALETTE_IDS,
  BUILTIN_PALETTES,
  clampDim,
  isBuiltinPaletteId,
  MAX_CANVAS,
  type Palette,
} from '../../core';
import { Button, Dialog } from '../components';
import { useProject } from './ProjectProvider';

const PRESETS = [8, 16, 32, 64, 128] as const;
const HARDWARE: readonly { readonly label: string; readonly w: number; readonly h: number }[] = [
  { label: 'Game Boy', w: 160, h: 144 },
  { label: 'NES tile', w: 8, h: 8 },
];
const FREE = 'free';

export interface WelcomeDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** When true, the dialog cannot be dismissed without creating (true first run). */
  readonly mandatory?: boolean;
}

/** Clamp typed dimensions to the 1..512 cap as the user types (refuses > 512). */
function clampInput(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_CANVAS, Math.trunc(value)));
}

/**
 * First-run / New-Canvas dialog (master-spec §2, §3): choose a size (presets,
 * hardware presets, or custom W×H clamped to 512) and a palette (free color or a
 * built-in classic), name it, and forge a fresh document. Dotpict-style onboarding
 * — small, focused, keyboard-operable. Built from the Forge design system.
 */
export function WelcomeDialog({ open, onClose, mandatory = false }: WelcomeDialogProps) {
  const { doc } = useProject();
  const [name, setName] = useState('Untitled');
  const [w, setW] = useState(32);
  const [h, setH] = useState(32);
  const [paletteId, setPaletteId] = useState<string>(FREE);
  const nameId = useId();
  const wId = useId();
  const hId = useId();
  const palId = useId();

  const create = (): void => {
    const palette: Palette | null = isBuiltinPaletteId(paletteId)
      ? BUILTIN_PALETTES[paletteId]
      : null;
    doc.newProject({
      w: clampDim(w),
      h: clampDim(h),
      name: name.trim() || 'Untitled',
      palette,
      indexed: false,
    });
    onClose();
  };

  const isSquarePreset = (p: number): boolean => w === p && h === p;

  return (
    <Dialog
      open={open}
      onClose={mandatory ? () => {} : onClose}
      closeOnBackdrop={!mandatory}
      title="New Canvas"
      className="pf-welcome"
      actions={
        <>
          {!mandatory && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={create}>
            Forge it
          </Button>
        </>
      }
    >
      <label className="pf-field pf-field--stack" htmlFor={nameId}>
        <span className="pf-label">Name</span>
        <input
          id={nameId}
          className="pf-input"
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <fieldset className="pf-welcome__sizes">
        <legend className="pf-label">Size</legend>
        <div className="pf-welcome__presets">
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              active={isSquarePreset(p)}
              aria-pressed={isSquarePreset(p)}
              onClick={() => {
                setW(p);
                setH(p);
              }}
            >
              {p}²
            </Button>
          ))}
          {HARDWARE.map((hw) => (
            <Button
              key={hw.label}
              size="sm"
              active={w === hw.w && h === hw.h}
              aria-pressed={w === hw.w && h === hw.h}
              onClick={() => {
                setW(hw.w);
                setH(hw.h);
              }}
            >
              {hw.label}
            </Button>
          ))}
        </div>
        <div className="pf-welcome__custom">
          <label className="pf-field" htmlFor={wId}>
            <span className="pf-label pf-label--sm">W</span>
            <input
              id={wId}
              className="pf-input pf-input--num"
              type="number"
              min={1}
              max={MAX_CANVAS}
              value={w}
              onChange={(e) => setW(clampInput(Number(e.target.value)))}
            />
          </label>
          <span className="pf-welcome__x" aria-hidden="true">
            ×
          </span>
          <label className="pf-field" htmlFor={hId}>
            <span className="pf-label pf-label--sm">H</span>
            <input
              id={hId}
              className="pf-input pf-input--num"
              type="number"
              min={1}
              max={MAX_CANVAS}
              value={h}
              onChange={(e) => setH(clampInput(Number(e.target.value)))}
            />
          </label>
          <span className="pf-readout pf-welcome__cap">max {MAX_CANVAS}</span>
        </div>
      </fieldset>

      <label className="pf-field pf-field--stack" htmlFor={palId}>
        <span className="pf-label">Palette</span>
        <select
          id={palId}
          className="pf-select"
          value={paletteId}
          onChange={(e) => setPaletteId(e.target.value)}
        >
          <option value={FREE}>Free color (any RGB)</option>
          {BUILTIN_PALETTE_IDS.map((id) => (
            <option key={id} value={id}>
              {BUILTIN_PALETTES[id].name}
            </option>
          ))}
        </select>
      </label>
    </Dialog>
  );
}

export default WelcomeDialog;
