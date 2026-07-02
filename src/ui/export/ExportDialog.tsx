import { useId, useState } from 'react';
import { hexToRgba, type PixelBuffer, type Result, type RGBA } from '../../core';
import type { SpritesheetLayout } from '../../core/exporters/spritesheet';
import {
  exportGifFile,
  exportPngFile,
  exportSpritesheetFile,
  exportSvgFile,
  PNG_SCALES,
  type SaveOutcome,
} from '../../platform';
import { Button, Dialog } from '../components';
import './export-dialog.css';

/** One composited animation frame handed to the GIF / spritesheet exporters. */
export interface ExportFrame {
  readonly buffer: PixelBuffer;
  readonly durationMs: number;
  readonly name?: string;
}

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Reads the current composited buffer to export (null when nothing to export). */
  readonly getSource: () => PixelBuffer | null;
  /**
   * Reads the animation frames (composited, in order) for GIF / spritesheet export.
   * When omitted, the single {@link getSource} buffer is used as a one-frame set.
   */
  readonly getFrames?: () => readonly ExportFrame[];
  /** Global playback FPS (fallback delay + recorded in the atlas JSON). */
  readonly fps?: number;
  /** Project title used for the download file name. */
  readonly title?: string;
}

type Background = 'transparent' | 'matte';
type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly text: string }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string };

const DEFAULT_SCALE = 8;
const DEFAULT_MATTE = '#12100E';
const IDLE: Status = { kind: 'idle' };
const LAYOUTS: ReadonlyArray<{ readonly value: SpritesheetLayout; readonly label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'horizontal', label: 'Row' },
  { value: 'vertical', label: 'Column' },
];

/**
 * Export dialog for PNG (integer nearest-neighbor scale, transparent or matte
 * background), SVG (crisp, rect-merged, vector), animated GIF (encoded off the main
 * thread in a Web Worker), and a spritesheet PNG + companion JSON atlas. Every
 * exporter reads the composited buffers — never the on-screen canvas — so the CRT
 * layer and transparency checkerboard can never leak into an export (constitution:
 * clean-export invariant). Built from the Forge design system: hard bevels,
 * `steps()` press, Spark focus ring, no radius/blur.
 */
export function ExportDialog({
  open,
  onClose,
  getSource,
  getFrames,
  fps = 12,
  title = 'pixelforge',
}: ExportDialogProps) {
  const [scale, setScale] = useState<number>(DEFAULT_SCALE);
  const [background, setBackground] = useState<Background>('transparent');
  const [matte, setMatte] = useState<string>(DEFAULT_MATTE);
  const [loopForever, setLoopForever] = useState<boolean>(true);
  const [layout, setLayout] = useState<SpritesheetLayout>('grid');
  const [padding, setPadding] = useState<number>(0);
  const [margin, setMargin] = useState<number>(0);
  const [powerOfTwo, setPowerOfTwo] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const scaleName = useId();
  const bgName = useId();
  const layoutName = useId();
  const statusId = useId();

  const source = open ? getSource() : null;
  const frameCount = open ? collectFrames(getFrames, getSource).length : 0;
  const outW = source ? source.w * scale : 0;
  const outH = source ? source.h * scale : 0;
  const busy = status.kind === 'working';

  const resolveMatte = (): RGBA | null => (background === 'matte' ? hexToRgba(matte) : null);

  const applyResult = (res: Result<SaveOutcome>, label: string): void => {
    if (res.ok) {
      setStatus(res.value === 'cancelled' ? IDLE : { kind: 'done', text: `${label} exported.` });
    } else {
      setStatus({ kind: 'error', text: res.error.message });
    }
  };

  const runExport = async (
    action: (buf: PixelBuffer) => Promise<Result<SaveOutcome>>,
    label: string,
  ): Promise<void> => {
    const buf = getSource();
    if (!buf) {
      setStatus({ kind: 'error', text: 'Nothing to export yet — draw something first.' });
      return;
    }
    setStatus({ kind: 'working', text: `Rendering ${label}…` });
    applyResult(await action(buf), label);
  };

  const onExportPng = (): Promise<void> =>
    runExport(
      (buf) => exportPngFile(buf, { scale, matte: resolveMatte(), fileName: title }),
      'PNG',
    );

  const onExportSvg = (): Promise<void> =>
    runExport((buf) => exportSvgFile(buf, { fileName: title }), 'SVG');

  const onExportGif = async (): Promise<void> => {
    const frames = collectFrames(getFrames, getSource);
    if (frames.length === 0) {
      setStatus({ kind: 'error', text: 'Nothing to export yet — draw something first.' });
      return;
    }
    setStatus({ kind: 'working', text: `Encoding GIF… 0/${frames.length}` });
    const res = await exportGifFile(
      frames.map((f) => ({ buffer: f.buffer, delayMs: f.durationMs })),
      {
        scale,
        loop: loopForever ? 0 : 1,
        fps,
        fileName: title,
        onProgress: (done, total) =>
          setStatus({ kind: 'working', text: `Encoding GIF… ${done}/${total}` }),
      },
    );
    applyResult(res, 'GIF');
  };

  const onExportSpritesheet = async (): Promise<void> => {
    const frames = collectFrames(getFrames, getSource);
    if (frames.length === 0) {
      setStatus({ kind: 'error', text: 'Nothing to export yet — draw something first.' });
      return;
    }
    setStatus({ kind: 'working', text: 'Packing spritesheet…' });
    const res = await exportSpritesheetFile(
      frames.map((f, i) => ({
        buffer: f.buffer,
        durationMs: f.durationMs,
        name: f.name ?? `frame_${i}`,
      })),
      { layout, padding, margin, powerOfTwo, fps, fileName: title },
    );
    applyResult(res, 'Spritesheet');
  };

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
          <Button onClick={onExportSvg} disabled={busy}>
            Export SVG
          </Button>
          <Button variant="primary" onClick={onExportPng} disabled={busy}>
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

      <fieldset className="pf-export__field pf-export__anim">
        <legend className="pf-label">
          Animation{frameCount > 0 ? ` · ${frameCount} frame${frameCount === 1 ? '' : 's'}` : ''}
        </legend>

        <div className="pf-export__anim-row">
          <label className="pf-check">
            <input
              type="checkbox"
              checked={loopForever}
              onChange={(e) => setLoopForever(e.target.checked)}
            />
            <span className="pf-ui pf-ui-sm">GIF loops forever</span>
          </label>
        </div>

        <div className="pf-export__anim-row">
          <span className="pf-label pf-export__anim-key">Layout</span>
          <div className="pf-export__seg" role="radiogroup" aria-label="Spritesheet layout">
            {LAYOUTS.map((l) => (
              <label key={l.value} className="pf-seg">
                <input
                  type="radio"
                  name={layoutName}
                  value={l.value}
                  checked={layout === l.value}
                  onChange={() => setLayout(l.value)}
                />
                <span className="pf-seg__face pf-ui pf-ui-sm">{l.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="pf-export__anim-row">
          <label className="pf-num">
            <span className="pf-ui pf-ui-sm">Padding</span>
            <input
              type="number"
              min={0}
              max={64}
              value={padding}
              onChange={(e) => setPadding(clampInt(e.target.value))}
              aria-label="Spritesheet padding"
            />
          </label>
          <label className="pf-num">
            <span className="pf-ui pf-ui-sm">Margin</span>
            <input
              type="number"
              min={0}
              max={64}
              value={margin}
              onChange={(e) => setMargin(clampInt(e.target.value))}
              aria-label="Spritesheet margin"
            />
          </label>
          <label className="pf-check">
            <input
              type="checkbox"
              checked={powerOfTwo}
              onChange={(e) => setPowerOfTwo(e.target.checked)}
            />
            <span className="pf-ui pf-ui-sm">Power of two</span>
          </label>
        </div>

        <div className="pf-export__anim-actions">
          <Button onClick={onExportGif} disabled={busy || frameCount === 0}>
            Export GIF
          </Button>
          <Button onClick={onExportSpritesheet} disabled={busy || frameCount === 0}>
            Export Spritesheet
          </Button>
        </div>
        <p className="pf-export__anim-note pf-readout">
          GIF &amp; spritesheet use the {scale}× scale · encode runs off the main thread.
        </p>
      </fieldset>

      <p
        id={statusId}
        className={`pf-export__status pf-export__status--${status.kind} pf-ui pf-ui-sm`}
        role="status"
        aria-live="polite"
      >
        {status.kind === 'working' && status.text}
        {status.kind === 'done' && status.text}
        {status.kind === 'error' && status.text}
      </p>
    </Dialog>
  );
}

/** Frames for animation export: the provided set, else the single source buffer. */
function collectFrames(
  getFrames: (() => readonly ExportFrame[]) | undefined,
  getSource: () => PixelBuffer | null,
): ExportFrame[] {
  if (getFrames) {
    const frames = getFrames();
    if (frames.length > 0) {
      return [...frames];
    }
  }
  const buf = getSource();
  return buf ? [{ buffer: buf, durationMs: 100 }] : [];
}

/** Parse a number input into a clamped non-negative integer. */
function clampInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(64, n);
}

export default ExportDialog;
