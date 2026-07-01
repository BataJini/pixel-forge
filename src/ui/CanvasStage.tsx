import { useEffect, useRef, useState } from 'react';
import {
  createBuffer,
  fillRectMut,
  fitToScreen,
  nextZoom,
  type Palette,
  type PixelBuffer,
  paletteSwap,
  panBy,
  type RGBA,
  rgbaToHex,
  setPixelMut,
  snapBufferToPalette,
  snapColorToPalette,
  zoomAt,
} from '../core';
import { createRenderer, type PixelRenderer } from '../platform';
import './CanvasStage.css';

const ART_W = 32;
const ART_H = 32;
const FIT_PADDING = 16;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

// Demo *paint* colors — the user's artwork colors, deliberately NOT the chrome
// theme tokens (the canvas is never tinted by the UI palette; constitution).
const PAINTS: readonly { name: string; rgba: RGBA }[] = [
  { name: 'Ember', rgba: [255, 106, 26, 255] },
  { name: 'Coal', rgba: [24, 20, 16, 255] },
  { name: 'Steel', rgba: [201, 209, 224, 255] },
  { name: 'Cyan', rgba: [47, 168, 196, 255] },
  { name: 'Leaf', rgba: [95, 158, 90, 255] },
];

/** Seed a small forge-native motif (an anvil with a glowing ember) so the
 * preview shows real artwork over the transparency checker on first paint. */
function seedForgeMotif(buf: PixelBuffer): void {
  const iron: RGBA = [58, 52, 46, 255];
  const ironDark: RGBA = [36, 32, 28, 255];
  fillRectMut(buf, { x: 8, y: 23, w: 16, h: 3 }, ironDark); // base
  fillRectMut(buf, { x: 11, y: 15, w: 10, h: 8 }, iron); // body
  fillRectMut(buf, { x: 20, y: 16, w: 6, h: 3 }, iron); // horn
  fillRectMut(buf, { x: 9, y: 21, w: 14, h: 2 }, iron); // waist
  setPixelMut(buf, 15, 12, [255, 176, 58, 255]); // spark
  setPixelMut(buf, 16, 11, [255, 224, 138, 255]);
  setPixelMut(buf, 16, 13, [255, 106, 26, 255]);
}

interface StagePos {
  x: number;
  y: number;
}

type Interaction = { mode: 'idle' | 'draw' } | { mode: 'pan'; lastSx: number; lastSy: number };

interface EngineHandles {
  renderer: PixelRenderer;
  buffer: () => PixelBuffer;
  color: () => RGBA;
  onPos: (p: StagePos) => void;
}

function localPoint(container: HTMLElement, e: PointerEvent): StagePos {
  const rect = container.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** Wire pointer/wheel drawing + pan + zoom onto the well; returns a detacher. */
function attachInteractions(container: HTMLElement, h: EngineHandles): () => void {
  let interaction: Interaction = { mode: 'idle' };

  const paintAt = (sx: number, sy: number): void => {
    const { x, y } = h.renderer.screenToArt(sx, sy);
    if (setPixelMut(h.buffer(), x, y, h.color())) {
      h.renderer.updateRegion(h.buffer(), { x, y, w: 1, h: 1 });
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    container.setPointerCapture(e.pointerId);
    const { x: sx, y: sy } = localPoint(container, e);
    // Middle or right button pans; left button paints.
    if (e.button === 1 || e.button === 2) {
      interaction = { mode: 'pan', lastSx: sx, lastSy: sy };
    } else {
      interaction = { mode: 'draw' };
      paintAt(sx, sy);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    const { x: sx, y: sy } = localPoint(container, e);
    h.onPos(h.renderer.screenToArt(sx, sy));
    if (interaction.mode === 'draw') {
      paintAt(sx, sy);
    } else if (interaction.mode === 'pan') {
      const vp = h.renderer.getViewport();
      h.renderer.setViewport(panBy(vp, sx - interaction.lastSx, sy - interaction.lastSy));
      interaction = { mode: 'pan', lastSx: sx, lastSy: sy };
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (container.hasPointerCapture(e.pointerId)) {
      container.releasePointerCapture(e.pointerId);
    }
    interaction = { mode: 'idle' };
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const vp = h.renderer.getViewport();
    const zoom = nextZoom(vp.zoom, e.deltaY < 0 ? 1 : -1);
    h.renderer.setViewport(zoomAt(vp, zoom, e.clientX - rect.left, e.clientY - rect.top));
  };

  const onContextMenu = (e: Event): void => e.preventDefault();

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('contextmenu', onContextMenu);
  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('contextmenu', onContextMenu);
  };
}

export interface CanvasStageProps {
  /**
   * External paint color (U-005 Color panel). When provided it drives the
   * pencil and the internal demo swatches are hidden; when omitted, the stage is
   * self-contained with its own demo palette (U-003 standalone preview). In
   * indexed mode this is already the palette-snapped color (see `effectivePaintColor`).
   */
  readonly paintColor?: RGBA;
  /**
   * Indexed / palette-lock mode (U-005). When it turns on, the existing artwork is
   * quantized to `palette`; while on, drawing is restricted to the palette (the
   * caller passes a snapped `paintColor`) and changing `palette` palette-swaps the
   * artwork by index on the real canvas.
   */
  readonly indexed?: boolean;
  /** The active palette used for indexed-mode quantize / palette-swap. */
  readonly palette?: Palette;
}

/**
 * CanvasStage — a runnable preview of the U-003 render pipeline: three stacked
 * canvases (checkerboard backdrop, nearest-neighbor display, grid overlay) with
 * middle/right-drag pan, cursor-centered wheel zoom, and a single-pixel pencil
 * that repaints only its dirty rect. When a `paintColor` is supplied (by the
 * U-005 Color & Palette panel), the pencil uses it. The full tool belt/layers/
 * frames and the complete keyboard map arrive in later units; this proves the
 * engine draws, maps coordinates, and stays clean.
 */
export function CanvasStage({ paintColor, indexed, palette }: CanvasStageProps = {}) {
  const wellRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PixelRenderer | null>(null);
  const bufferRef = useRef<PixelBuffer | null>(null);
  // The palette currently baked into the buffer while indexed mode is on; `null`
  // when free-color, so re-entering indexed mode re-quantizes from scratch.
  const appliedPaletteRef = useRef<Palette | null>(null);

  const [pos, setPos] = useState<StagePos>({ x: 0, y: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const [paintIndex, setPaintIndex] = useState(0);
  const [erasing, setErasing] = useState(false);
  const [gridOn, setGridOn] = useState(true);

  const controlled = paintColor !== undefined;
  const rawColor = erasing ? TRANSPARENT : (paintColor ?? PAINTS[paintIndex].rgba);
  // Belt-and-suspenders palette lock: when indexed mode is on, the stage snaps the
  // pencil color to the active palette ITSELF, so off-palette pixels are impossible
  // to draw even if a caller forgets to pre-snap `paintColor` (defense in depth for
  // the H-1 criterion). Idempotent for `App`, which already passes the snapped
  // `effectivePaintColor`. A transparent color (eraser) is preserved by the snap.
  const locked = indexed === true && palette !== undefined && palette.colors.length > 0;
  const colorRef = useRef<RGBA>(PAINTS[0].rgba);
  colorRef.current = locked ? snapColorToPalette(palette, rawColor) : rawColor;

  // One-time engine setup: create renderer, seed art, fit, wire interactions.
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
    const buf = createBuffer(ART_W, ART_H);
    seedForgeMotif(buf);
    bufferRef.current = buf;
    // A freshly seeded buffer is not yet quantized to any palette, so clear the
    // applied-palette marker; the indexed effect (which runs right after this one)
    // then re-quantizes if the lock is on. Guards the StrictMode remount, where the
    // buffer is re-created but refs persist.
    appliedPaletteRef.current = null;
    renderer.setComposite(buf);

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

    const detach = attachInteractions(well, {
      renderer,
      buffer: () => bufferRef.current as PixelBuffer,
      color: () => colorRef.current,
      onPos: setPos,
    });

    return () => {
      observer.disconnect();
      detach();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setGrid({ pixel: gridOn, tile: null });
  }, [gridOn]);

  // Indexed / palette-lock: quantize the live artwork to the palette when the lock
  // turns on, and palette-swap it by index when the palette changes while locked —
  // so the killer retro feature runs on the REAL canvas, not just a preview. The
  // pencil is separately restricted via the snapped `paintColor` from App.
  useEffect(() => {
    const renderer = rendererRef.current;
    const buffer = bufferRef.current;
    if (!renderer || !buffer || palette === undefined) {
      return;
    }
    if (!indexed) {
      appliedPaletteRef.current = null;
      return;
    }
    const applied = appliedPaletteRef.current;
    appliedPaletteRef.current = palette;
    if (applied === palette || palette.colors.length === 0) {
      return; // no change, or nothing to snap to (empty palette)
    }
    const next =
      applied === null || applied.colors.length === 0
        ? snapBufferToPalette(buffer, palette) // entering lock: quantize existing art
        : // palette changed while locked: recolor by index, then scrub any pixel
          // whose index is absent from a shorter/edited target back into the palette.
          snapBufferToPalette(paletteSwap(buffer, applied, palette), palette);
    bufferRef.current = next;
    renderer.setComposite(next);
  }, [indexed, palette]);

  const applyViewport = (mapZoom: (currentZoom: number) => number): void => {
    const well = wellRef.current;
    const renderer = rendererRef.current;
    if (!well || !renderer) {
      return;
    }
    const rect = well.getBoundingClientRect();
    const vp = renderer.getViewport();
    const next = zoomAt(vp, mapZoom(vp.zoom), rect.width / 2, rect.height / 2);
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

  return (
    <section className="pf-stage" aria-label="Canvas engine preview">
      <p className="pf-visually-hidden">
        Interactive {ART_W} by {ART_H} pixel canvas preview. Use the toolbar to pick a paint color,
        zoom, and toggle the grid; drag on the canvas to draw and middle-drag to pan.
      </p>
      <div className="pf-stage__toolbar" role="toolbar" aria-label="Paint and view controls">
        <div className="pf-stage__group">
          {!controlled &&
            PAINTS.map((paint, i) => (
              <button
                key={paint.name}
                type="button"
                className="pf-swatch"
                style={{ background: rgbaToHex(paint.rgba) }}
                aria-label={`${paint.name} paint`}
                aria-pressed={!erasing && paintIndex === i}
                onClick={() => {
                  setErasing(false);
                  setPaintIndex(i);
                }}
              />
            ))}
          <button
            type="button"
            className="pf-btn"
            aria-pressed={erasing}
            onClick={() => setErasing((v) => !v)}
          >
            Erase
          </button>
        </div>
        <span className="pf-stage__spacer" />
        <div className="pf-stage__group">
          <button
            type="button"
            className="pf-btn"
            aria-label="Zoom out"
            onClick={() => applyViewport((z) => nextZoom(z, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-label="Reset zoom to 100%"
            onClick={() => applyViewport(() => 1)}
          >
            100%
          </button>
          <button
            type="button"
            className="pf-btn"
            aria-label="Zoom in"
            onClick={() => applyViewport((z) => nextZoom(z, 1))}
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
          aria-pressed={gridOn}
          onClick={() => setGridOn((v) => !v)}
        >
          Grid
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
          Tool <b>{erasing ? 'Eraser' : 'Pencil'}</b>
        </span>
      </p>
    </section>
  );
}

export default CanvasStage;
