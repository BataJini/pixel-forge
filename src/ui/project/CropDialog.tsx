import { useEffect, useId, useState } from 'react';
import { Button, Dialog } from '../components';
import { useProject } from './ProjectProvider';

export interface CropDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function clampInt(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

/**
 * Crop the canvas to a rectangular region (master-spec §3.7 Canvas ▸ Crop). The
 * region is entered as X/Y/W/H (clamped to the canvas) and applied as an undoable
 * op. Selection-marquee-driven "crop to selection" wires to this same op in the
 * app shell (U-012) once the marquee is app-global; here the region is explicit so
 * the operation is fully exercisable. Defaults to the whole canvas on open.
 */
export function CropDialog({ open, onClose }: CropDialogProps) {
  const { doc, snapshot } = useProject();
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(snapshot.w);
  const [h, setH] = useState(snapshot.h);
  const [error, setError] = useState<string | null>(null);
  const xId = useId();
  const yId = useId();
  const wId = useId();
  const hId = useId();

  useEffect(() => {
    if (open) {
      setX(0);
      setY(0);
      setW(snapshot.w);
      setH(snapshot.h);
      setError(null);
    }
  }, [open, snapshot.w, snapshot.h]);

  const apply = (): void => {
    const res = doc.cropCanvas({ x, y, w, h });
    if (res.ok) {
      onClose();
    } else {
      setError(res.error.message);
    }
  };

  const field = (
    id: string,
    label: string,
    value: number,
    set: (n: number) => void,
    max: number,
  ) => (
    <label className="pf-field" htmlFor={id}>
      <span className="pf-label pf-label--sm">{label}</span>
      <input
        id={id}
        className="pf-input pf-input--num"
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => set(clampInt(Number(e.target.value), max))}
      />
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Crop Canvas"
      className="pf-crop"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply}>
            Crop
          </Button>
        </>
      }
    >
      <div className="pf-crop__fields">
        {field(xId, 'X', x, setX, snapshot.w - 1)}
        {field(yId, 'Y', y, setY, snapshot.h - 1)}
        {field(wId, 'W', w, setW, snapshot.w)}
        {field(hId, 'H', h, setH, snapshot.h)}
      </div>
      <p className="pf-readout" aria-live="polite">
        Keep{' '}
        <b>
          {Math.min(w, snapshot.w - x)}×{Math.min(h, snapshot.h - y)}
        </b>{' '}
        px from ({x},{y})
      </p>
      {error && (
        <p className="pf-project__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export default CropDialog;
