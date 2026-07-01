import { useId, useState } from 'react';
import { hexToRgba, type PixelBuffer, type Result, type RGBA } from '../../core';
import { exportPngFile, exportSvgFile, PNG_SCALES, type SaveOutcome } from '../../platform';
import { Button, Dialog } from '../components';
import './export-dialog.css';

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Reads the current composited buffer to export (null when nothing to export). */
  readonly getSource: () => PixelBuffer | null;
  /** Project title used for the download file name. */
  readonly title?: string;
}

type Background = 'transparent' | 'matte';
type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string };

const DEFAULT_SCALE = 8;
const DEFAULT_MATTE = '#12100E';
const IDLE: Status = { kind: 'idle' };

/**
 * Export dialog for PNG (integer nearest-neighbor scale, transparent or matte
 * background) and SVG (crisp, rect-merged, vector). Reads the composited buffer
 * — never the on-screen canvas — so the CRT layer and transparency checkerboard
 * can never leak into an export (constitution: clean-export invariant). Built
 * from the Forge design system: hard bevels, `steps()` press, Spark focus ring,
 * no radius/blur.
 */
export function ExportDialog({
  open,
  onClose,
  getSource,
  title = 'pixelforge',
}: ExportDialogProps) {
  const [scale, setScale] = useState<number>(DEFAULT_SCALE);
  const [background, setBackground] = useState<Background>('transparent');
  const [matte, setMatte] = useState<string>(DEFAULT_MATTE);
  const [status, setStatus] = useState<Status>(IDLE);
  const scaleName = useId();
  const bgName = useId();
  const statusId = useId();

  const source = open ? getSource() : null;
  const outW = source ? source.w * scale : 0;
  const outH = source ? source.h * scale : 0;

  const resolveMatte = (): RGBA | null => (background === 'matte' ? hexToRgba(matte) : null);

  const runExport = async (
    action: (buf: PixelBuffer) => Promise<Result<SaveOutcome>>,
    label: string,
  ): Promise<void> => {
    const buf = getSource();
    if (!buf) {
      setStatus({ kind: 'error', text: 'Nothing to export yet — draw something first.' });
      return;
    }
    setStatus({ kind: 'working' });
    const res = await action(buf);
    if (res.ok) {
      setStatus(res.value === 'cancelled' ? IDLE : { kind: 'done', text: `${label} exported.` });
    } else {
      setStatus({ kind: 'error', text: res.error.message });
    }
  };

  const onExportPng = (): Promise<void> =>
    runExport(
      (buf) => exportPngFile(buf, { scale, matte: resolveMatte(), fileName: title }),
      'PNG',
    );

  const onExportSvg = (): Promise<void> =>
    runExport((buf) => exportSvgFile(buf, { fileName: title }), 'SVG');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export"
      className="pf-export"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onExportSvg} disabled={status.kind === 'working'}>
            Export SVG
          </Button>
          <Button variant="primary" onClick={onExportPng} disabled={status.kind === 'working'}>
            Export PNG
          </Button>
        </>
      }
    >
      <fieldset className="pf-export__field">
        <legend className="pf-label">PNG scale</legend>
        <div className="pf-export__seg" role="radiogroup" aria-label="PNG scale">
          {PNG_SCALES.map((s) => (
            <label key={s} className="pf-seg">
              <input
                type="radio"
                name={scaleName}
                value={s}
                checked={scale === s}
                onChange={() => setScale(s)}
              />
              <span className="pf-seg__face pf-ui pf-ui-sm">{s}×</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="pf-export__field">
        <legend className="pf-label">Background</legend>
        <div className="pf-export__bg">
          <label className="pf-seg">
            <input
              type="radio"
              name={bgName}
              value="transparent"
              checked={background === 'transparent'}
              onChange={() => setBackground('transparent')}
            />
            <span className="pf-seg__face pf-ui pf-ui-sm">Transparent</span>
          </label>
          <label className="pf-seg">
            <input
              type="radio"
              name={bgName}
              value="matte"
              checked={background === 'matte'}
              onChange={() => setBackground('matte')}
            />
            <span className="pf-seg__face pf-ui pf-ui-sm">Matte</span>
          </label>
          <label className={`pf-export__matte${background === 'matte' ? '' : ' is-disabled'}`}>
            <span className="pf-visually-hidden">Matte color</span>
            <input
              type="color"
              value={matte}
              disabled={background !== 'matte'}
              onChange={(e) => setMatte(e.target.value)}
              aria-label="Matte color"
            />
          </label>
        </div>
      </fieldset>

      <p className="pf-export__readout pf-readout" aria-live="polite">
        {source ? (
          <>
            Output{' '}
            <b>
              {outW}×{outH}
            </b>{' '}
            px · SVG is vector (crisp at any size)
          </>
        ) : (
          <>No canvas to export yet.</>
        )}
      </p>

      <p
        id={statusId}
        className={`pf-export__status pf-export__status--${status.kind} pf-ui pf-ui-sm`}
        role="status"
        aria-live="polite"
      >
        {status.kind === 'working' && 'Rendering…'}
        {status.kind === 'done' && status.text}
        {status.kind === 'error' && status.text}
      </p>
    </Dialog>
  );
}

export default ExportDialog;
