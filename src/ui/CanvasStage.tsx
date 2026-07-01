import { useEffect, useRef, useState } from 'react';
import {
  createBuffer,
  fitToScreen,
  getPixel,
  nextZoom,
  type PixelBuffer,
  panBy,
  type RGBA,
  rgbaToHex,
  zoomAt,
} from '../core';
import { createRenderer, type PixelRenderer } from '../platform';
import { type ToolId, ToolSession, type ToolState } from '../state';
import './CanvasStage.css';

const ART_W = 32;
const ART_H = 32;
const FIT_PADDING = 16;
const MIN_BRUSH = 1;
const MAX_BRUSH = 8;

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
}

// Tool rack (master-spec §3.2). Ellipse shares U with Rectangle (press U to toggle).
const TOOLS: readonly ToolDef[] = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'bucket', label: 'Fill', key: 'G' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rect', key: 'U' },
  { id: 'ellipse', label: 'Ellipse', key: 'U' },
  { id: 'eyedropper', label: 'Pick', key: 'I' },
  { id: 'select', label: 'Select', key: 'M' },
  { id: 'move', label: 'Move', key: 'V' },
  { id: 'hand', label: 'Pan', key: 'H' },
];

// Artwork paints — the user's true colors, deliberately NOT the chrome theme
// tokens (the canvas is never tinted by the UI palette; constitution).
const PAINTS: readonly RGBA[] = [
  [255, 106, 26, 255],
  [24, 20, 16, 255],
  [232, 223, 210, 255],
  [47, 168, 196, 255],
  [95, 158, 90, 255],
  [226, 59, 46, 255],
];

interface StagePos {
  x: number;
  y: number;
}

interface Snapshot extends ToolState {
  selection: string;
  floating: string | null;
  canPaste: boolean;
}

function readSnapshot(session: ToolSession): Snapshot {
  const sel = session.getSelection();
  const float = session.getFloatingBounds();
  return {
    ...session.getState(),
    selection: sel ? `${sel.bounds.w}×${sel.bounds.h}` : '—',
    floating: float ? `${float.w}×${float.h}` : null,
    canPaste: session.hasClipboard(),
  };
}

const isTextTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);

interface Wiring {
  renderer: PixelRenderer;
  session: ToolSession;
  onPos: (p: StagePos) => void;
}

function localPoint(container: HTMLElement, e: PointerEvent): StagePos {
  const rect = container.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** Wire pointer drawing + pan + wheel-zoom onto the well; returns a detacher. */
function attachPointer(container: HTMLElement, w: Wiring, spaceHeld: () => boolean): () => void {
  let drawing = false;
  let pan: { sx: number; sy: number } | null = null;

  const wantsPan = (e: PointerEvent): boolean =>
    e.button === 1 || e.button === 2 || spaceHeld() || w.session.getState().tool === 'hand';

  const onDown = (e: PointerEvent): void => {
    container.setPointerCapture(e.pointerId);
    const { x: sx, y: sy } = localPoint(container, e);
    if (wantsPan(e)) {
      pan = { sx, sy };
      return;
    }
    const { x, y } = w.renderer.screenToArt(sx, sy);
    drawing = true;
    w.session.pointerDown(x, y, { shift: e.shiftKey, alt: e.altKey });
  };

  const onMove = (e: PointerEvent): void => {
    const { x: sx, y: sy } = localPoint(container, e);
    const art = w.renderer.screenToArt(sx, sy);
    w.onPos(art);
    if (pan) {
      w.renderer.setViewport(panBy(w.renderer.getViewport(), sx - pan.sx, sy - pan.sy));
      pan = { sx, sy };
    } else if (drawing) {
      w.session.pointerMove(art.x, art.y, { shift: e.shiftKey, alt: e.altKey });
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (container.hasPointerCapture(e.pointerId)) {
      container.releasePointerCapture(e.pointerId);
    }
    if (drawing) {
      w.session.pointerUp({ shift: e.shiftKey, alt: e.altKey });
      drawing = false;
    }
    pan = null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const vp = w.renderer.getViewport();
    const zoom = nextZoom(vp.zoom, e.deltaY < 0 ? 1 : -1);
    w.renderer.setViewport(zoomAt(vp, zoom, e.clientX - rect.left, e.clientY - rect.top));
  };

  const onContext = (e: Event): void => e.preventDefault();

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('contextmenu', onContext);
  return () => {
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('contextmenu', onContext);
  };
}

const LETTER_TOOLS: Record<string, ToolId> = {
  b: 'pencil',
  e: 'eraser',
  g: 'bucket',
  l: 'line',
  i: 'eyedropper',
  m: 'select',
  v: 'move',
  h: 'hand',
};

/** Wire the keyboard map (window-level, ignoring form fields); returns detacher. */
function attachKeyboard(session: ToolSession, setSpace: (v: boolean) => void): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTextTarget(e.target)) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      session.selectAllPixels();
      return;
    }
    if ((mod && e.key.toLowerCase() === 'd') || e.key === 'Escape') {
      e.preventDefault();
      session.clearSelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      session.copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      session.cut();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      session.paste();
      return;
    }
    if (mod || e.altKey) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      session.commitFloatingSelection();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      setSpace(true);
      return;
    }
    if (
      e.key.startsWith('Arrow') &&
      (session.getState().tool === 'move' || session.getFloatingBounds() !== null)
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      session.nudge(dx, dy);
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'u') {
      session.setTool(session.getState().tool === 'rect' ? 'ellipse' : 'rect');
    } else if (key === 'x') {
      session.swapColors();
    } else if (key === '[' || key === ']') {
      const size = session.getState().brushSize + (key === ']' ? 1 : -1);
      session.update({ brushSize: Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, size)) });
    } else if (LETTER_TOOLS[key]) {
      session.setTool(LETTER_TOOLS[key]);
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      setSpace(false);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

/**
 * CanvasStage — the interactive workbench preview for U-004. Wires the full
 * drawing-tool belt (pencil, eraser, bucket, line, rect, ellipse, eyedropper,
 * rectangular select, move, pan) plus the global modifiers (brush size, mirror
 * X/Y, pixel-perfect, dither, fill, fill tolerance) to the pure engine via a
 * {@link ToolSession}, over the U-003 three-layer render pipeline. Fully
 * keyboard-operable; the marquee and grid live on the overlay and never touch
 * the pixel buffer (clean-export invariant). The complete workbench chrome —
 * menu bar, dockable panels, command palette — arrives in U-012.
 */
export function CanvasStage() {
  const wellRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PixelRenderer | null>(null);
  const sessionRef = useRef<ToolSession | null>(null);
  const spaceRef = useRef(false);

  const [pos, setPos] = useState<StagePos>({ x: 0, y: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    const well = wellRef.current;
    const backdrop = backdropRef.current;
    const display = displayRef.current;
    const overlay = overlayRef.current;
    if (!well || !backdrop || !display || !overlay) {
      return;
    }
    const renderer = createRenderer(
      { backdrop, display, overlay },
      { grid: { pixel: true, tile: null } },
    );
    rendererRef.current = renderer;
    const buffer = createBuffer(ART_W, ART_H);
    const session = new ToolSession(renderer, buffer, {}, () => setSnap(readSnapshot(session)));
    sessionRef.current = session;
    renderer.setComposite(buffer);
    setSnap(readSnapshot(session));

    const applyFit = (): void => {
      const rect = well.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      const vp = fitToScreen(ART_W, ART_H, rect.width, rect.height, FIT_PADDING);
      renderer.setViewport(vp);
      setZoomPct(Math.round(vp.zoom * 100));
    };
    applyFit();
    const observer = new ResizeObserver(applyFit);
    observer.observe(well);

    const detachPointer = attachPointer(
      well,
      { renderer, session, onPos: setPos },
      () => spaceRef.current,
    );
    const detachKeyboard = attachKeyboard(session, (v) => {
      spaceRef.current = v;
    });

    return () => {
      observer.disconnect();
      detachPointer();
      detachKeyboard();
      renderer.dispose();
      rendererRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  const session = sessionRef.current;

  const applyZoom = (map: (z: number) => number): void => {
    const well = wellRef.current;
    const renderer = rendererRef.current;
    if (!well || !renderer) {
      return;
    }
    const rect = well.getBoundingClientRect();
    const next = zoomAt(
      renderer.getViewport(),
      map(renderer.getViewport().zoom),
      rect.width / 2,
      rect.height / 2,
    );
    renderer.setViewport(next);
    setZoomPct(Math.round(next.zoom * 100));
  };

  const zoomFit = (): void => {
    const well = wellRef.current;
    const renderer = rendererRef.current;
    if (!well || !renderer) {
      return;
    }
    const rect = well.getBoundingClientRect();
    const vp = fitToScreen(ART_W, ART_H, rect.width, rect.height, FIT_PADDING);
    renderer.setViewport(vp);
    setZoomPct(Math.round(vp.zoom * 100));
  };

  const activeBuffer: PixelBuffer | null = session ? session.getBuffer() : null;
  const hoverColor =
    activeBuffer && pos.x >= 0 && pos.y >= 0 && pos.x < ART_W && pos.y < ART_H
      ? getPixel(activeBuffer, pos.x, pos.y)
      : null;

  const set = (patch: Partial<ToolState>): void => session?.update(patch);
  const isShape = snap?.tool === 'rect' || snap?.tool === 'ellipse';
  const canCopy = !!snap && (snap.selection !== '—' || snap.floating !== null);

  return (
    <section className="pf-stage" aria-label="Drawing tools preview">
      <p className="pf-visually-hidden">
        Interactive {ART_W} by {ART_H} pixel canvas. Choose a tool from the tool rack, pick a paint
        color, and drag on the canvas to draw. Keyboard: B pencil, E eraser, G fill, L line, U
        rectangle/ellipse, I eyedropper, M select, V move, H pan; X swaps colors; square brackets
        change brush size; Control-A selects all, Escape deselects; Control-C copies, Control-X
        cuts, and Control-V pastes the selection as a floating selection; arrow keys nudge the Move
        tool or the floating selection, and Enter stamps it down; hold Space to pan.
      </p>

      <div className="pf-stage__toolbar" role="toolbar" aria-label="Drawing tools">
        <div className="pf-stage__group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pf-btn"
              title={`${t.label} (${t.key})`}
              aria-pressed={snap?.tool === t.id}
              onClick={() => session?.setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pf-stage__toolbar" role="toolbar" aria-label="Colors and modifiers">
        <div className="pf-stage__group">
          <span className="pf-colorpair" aria-hidden="true">
            <span
              className="pf-colorpair__bg"
              style={{ background: snap ? rgbaToHex(snap.bg) : '#000' }}
            />
            <span
              className="pf-colorpair__fg"
              style={{ background: snap ? rgbaToHex(snap.fg) : '#000' }}
            />
          </span>
          <button
            type="button"
            className="pf-btn"
            title="Swap colors (X)"
            onClick={() => session?.swapColors()}
          >
            Swap
          </button>
          {PAINTS.map((rgba) => (
            <button
              key={rgbaToHex(rgba)}
              type="button"
              className="pf-swatch"
              style={{ background: rgbaToHex(rgba) }}
              title={`Set foreground ${rgbaToHex(rgba)} (Alt-click sets background)`}
              aria-label={`Paint ${rgbaToHex(rgba)}`}
              aria-pressed={snap ? rgbaToHex(snap.fg) === rgbaToHex(rgba) : false}
              onClick={(e) => set(e.altKey ? { bg: rgba } : { fg: rgba })}
            />
          ))}
        </div>

        <span className="pf-stage__spacer" />

        <div className="pf-stage__group">
          <label className="pf-field">
            <span>Brush</span>
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              value={snap?.brushSize ?? 1}
              onChange={(e) => set({ brushSize: Number(e.target.value) })}
            />
            <b>{snap?.brushSize ?? 1}</b>
          </label>
          <button
            type="button"
            className="pf-btn"
            aria-pressed={snap?.mirror.x}
            onClick={() => set({ mirror: { x: !snap?.mirror.x, y: snap?.mirror.y ?? false } })}
          >
            Mirror X
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-pressed={snap?.mirror.y}
            onClick={() => set({ mirror: { x: snap?.mirror.x ?? false, y: !snap?.mirror.y } })}
          >
            Mirror Y
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-pressed={snap?.pixelPerfect}
            onClick={() => set({ pixelPerfect: !snap?.pixelPerfect })}
          >
            Pixel-perfect
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-pressed={snap?.dither}
            onClick={() => set({ dither: !snap?.dither })}
          >
            Dither
          </button>
          {isShape && (
            <button
              type="button"
              className="pf-btn"
              aria-pressed={snap?.tool === 'rect' ? snap?.rectFilled : snap?.ellipseFilled}
              onClick={() => {
                if (snap?.tool === 'rect') {
                  set({ rectFilled: !snap.rectFilled });
                } else {
                  set({ ellipseFilled: !snap?.ellipseFilled });
                }
              }}
            >
              Fill
            </button>
          )}
          {snap?.tool === 'bucket' && (
            <>
              <button
                type="button"
                className="pf-btn"
                aria-pressed={!snap?.contiguous}
                onClick={() => set({ contiguous: !snap?.contiguous })}
              >
                {snap?.contiguous ? 'Contiguous' : 'Global'}
              </button>
              <label className="pf-field">
                <span>Tol</span>
                <input
                  type="range"
                  min={0}
                  max={128}
                  value={snap?.tolerance ?? 0}
                  onChange={(e) => set({ tolerance: Number(e.target.value) })}
                />
                <b>{snap?.tolerance ?? 0}</b>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="pf-stage__toolbar" role="toolbar" aria-label="Selection clipboard">
        <div className="pf-stage__group">
          <button
            type="button"
            className="pf-btn"
            title="Copy selection (Ctrl+C)"
            disabled={!canCopy}
            onClick={() => session?.copySelection()}
          >
            Copy
          </button>
          <button
            type="button"
            className="pf-btn"
            title="Cut selection (Ctrl+X)"
            disabled={!canCopy}
            onClick={() => session?.cut()}
          >
            Cut
          </button>
          <button
            type="button"
            className="pf-btn"
            title="Paste as a floating selection, placed with Move (Ctrl+V)"
            disabled={!snap?.canPaste}
            onClick={() => session?.paste()}
          >
            Paste
          </button>
          {snap?.floating && (
            <button
              type="button"
              className="pf-btn"
              title="Stamp the floating selection down (Enter)"
              onClick={() => session?.commitFloatingSelection()}
            >
              Stamp
            </button>
          )}
        </div>
      </div>

      <div className="pf-stage__toolbar" role="toolbar" aria-label="View controls">
        <div className="pf-stage__group">
          <button
            type="button"
            className="pf-btn"
            aria-label="Zoom out"
            onClick={() => applyZoom((z) => nextZoom(z, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-label="Reset zoom to 100%"
            onClick={() => applyZoom(() => 1)}
          >
            100%
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-label="Zoom in"
            onClick={() => applyZoom((z) => nextZoom(z, 1))}
          >
            +
          </button>
          <button type="button" className="pf-btn" onClick={zoomFit}>
            Fit
          </button>
        </div>
        <button
          type="button"
          className="pf-btn"
          onClick={() => session?.setBuffer(createBuffer(ART_W, ART_H))}
        >
          Clear
        </button>
      </div>

      <div ref={wellRef} className="pf-stage__well">
        <canvas ref={backdropRef} />
        <canvas ref={displayRef} />
        <canvas ref={overlayRef} />
      </div>

      <p className="pf-stage__status">
        <span>
          Pos{' '}
          <b>
            {pos.x},{pos.y}
          </b>
        </span>
        <span className="pf-stage__hex">
          Color <b>{hoverColor ? rgbaToHex(hoverColor, true) : '—'}</b>
        </span>
        <span>
          Zoom <b>{zoomPct}%</b>
        </span>
        <span>
          Size{' '}
          <b>
            {ART_W}×{ART_H}
          </b>
        </span>
        <span>
          Tool <b style={{ textTransform: 'capitalize' }}>{snap?.tool ?? 'pencil'}</b>
        </span>
        <span>
          Sel <b>{snap?.selection ?? '—'}</b>
        </span>
        {snap?.floating && (
          <span>
            Float <b>{snap.floating}</b>
          </span>
        )}
      </p>
    </section>
  );
}

export default CanvasStage;
