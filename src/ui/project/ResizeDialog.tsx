import { useEffect, useId, useState } from 'react';
import { MAX_CANVAS, type ResizeAnchor } from '../../core';
import { Button, Dialog } from '../components';
import { useProject } from './ProjectProvider';

export interface ResizeDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const ANCHORS: readonly { readonly value: ResizeAnchor; readonly glyph: string }[] = [
  { value: 'top-left', glyph: '↖' },
  { value: 'top', glyph: '↑' },
  { value: 'top-right', glyph: '↗' },
  { value: 'left', glyph: '←' },
  { value: 'center', glyph: '·' },
  { value: 'right', glyph: '→' },
  { value: 'bottom-left', glyph: '↙' },
  { value: 'bottom', glyph: '↓' },
  { value: 'bottom-right', glyph: '↘' },
];

function clampInput(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_CANVAS, Math.trunc(value)));
}

/**
 * Resize the canvas (master-spec §3.7 Canvas ▸ Resize): set a new W×H (clamped to
 * 512 — the field refuses larger) and an anchor for where existing pixels land.
 * The op is undoable through the document's history. Initializes to the current
 * size whenever the dialog opens.
 */
export function ResizeDialog({ open, onClose }: ResizeDialogProps) {
  const { doc, snapshot } = useProject();
  const [w, setW] = useState(snapshot.w);
  const [h, setH] = useState(snapshot.h);
  const [anchor, setAnchor] = useState<ResizeAnchor>('top-left');
  const wId = useId();
  const hId = useId();
  const anchorName = useId();

  // Sync the fields to the live size each time the dialog opens.
  useEffect(() => {
    if (open) {
      setW(snapshot.w);
      setH(snapshot.h);
    }
  }, [open, snapshot.w, snapshot.h]);

  const apply = (): void => {
    doc.resizeCanvas(w, h, anchor);
    onClose();
  };

  const unchanged = w === snapshot.w && h === snapshot.h;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Resize Canvas"
      className="pf-resize"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={unchanged}>
            Resize
          </Button>
        </>
      }
    >
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

      <fieldset className="pf-resize__anchor">
        <legend className="pf-label">Anchor</legend>
        <div className="pf-resize__grid">
          {ANCHORS.map((a) => (
            <label
              key={a.value}
              className="pf-anchor-cell"
              data-active={anchor === a.value ? 'true' : undefined}
            >
              <input
                type="radio"
                name={anchorName}
                className="pf-visually-hidden"
                value={a.value}
                checked={anchor === a.value}
                aria-label={a.value}
                onChange={() => setAnchor(a.value)}
              />
              <span aria-hidden="true">{a.glyph}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="pf-readout" aria-live="polite">
        {snapshot.w}×{snapshot.h} →{' '}
        <b>
          {w}×{h}
        </b>{' '}
        px
      </p>
    </Dialog>
  );
}

export default ResizeDialog;
