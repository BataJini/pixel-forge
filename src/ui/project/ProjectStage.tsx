import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type RGBA, rgbaToHex } from '../../core';
import { Button } from '../components';
import { LayerCanvas } from '../layers';
import { useProject } from './ProjectProvider';

const TRANSPARENT: RGBA = [0, 0, 0, 0];

// Artwork paints — the user's true colors, never the chrome theme (constitution:
// the canvas is never tinted by the UI palette).
const PAINTS: readonly RGBA[] = [
  [255, 106, 26, 255],
  [255, 224, 138, 255],
  [47, 168, 196, 255],
  [95, 158, 90, 255],
  [232, 223, 210, 255],
  [18, 16, 14, 255],
];

/**
 * The project canvas surface: a live, paintable composite of the document's layer
 * stack. Painting here edits the active layer of the CURRENT document, so the
 * round-trip is real — draw, and it autosaves and survives a reload. Distinct from
 * the U-004 tool preview and the U-007 layers demo (own classes) so it composes
 * additively; U-012 unifies these into the single editor. Drawing writes through
 * the buffer module (constitution) and the checkerboard is CSS only (clean-export).
 */
export function ProjectStage() {
  const { doc, snapshot } = useProject();
  const stack = doc.getStack();
  const stackSnap = useSyncExternalStore(stack.subscribe, stack.getSnapshot, stack.getSnapshot);
  const [paintIdx, setPaintIdx] = useState(0);
  const [erasing, setErasing] = useState(false);
  const wellRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive the composite whenever any layer's pixels change (incl. in-place strokes on the same buffer reference), tracked by the snapshot version.
  const composite = useMemo(() => stack.getComposite(), [stack, stackSnap.version]);
  const activeLayer = stackSnap.layers[stackSnap.activeIndex];
  const activeLocked = activeLayer?.locked ?? false;

  const paintAt = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = wellRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const { w, h } = stack.getSize();
    const ax = Math.floor(((e.clientX - rect.left) / rect.width) * w);
    const ay = Math.floor(((e.clientY - rect.top) / rect.height) * h);
    stack.paint(ax, ay, erasing ? TRANSPARENT : PAINTS[paintIdx]);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeLocked) {
      return;
    }
    wellRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    stack.beginStroke();
    paintAt(e);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drawing.current) {
      paintAt(e);
    }
  };
  const endStroke = (): void => {
    if (drawing.current) {
      stack.endStroke(erasing ? 'Erase' : 'Paint');
      drawing.current = false;
    }
  };

  return (
    <section className="pf-project__stage" aria-label="Project canvas">
      <div
        ref={wellRef}
        className="pf-project__well pf-checker"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      >
        <LayerCanvas
          buffer={composite}
          version={stackSnap.version}
          className="pf-project__canvas"
          ariaLabel={`Project canvas, ${snapshot.w} by ${snapshot.h} pixels`}
        />
      </div>

      <div className="pf-project__paint" role="toolbar" aria-label="Paint color">
        {PAINTS.map((rgba, i) => (
          <button
            key={rgbaToHex(rgba)}
            type="button"
            className="pf-swatch"
            style={{ background: rgbaToHex(rgba) }}
            aria-label={`Paint ${rgbaToHex(rgba)}`}
            aria-pressed={!erasing && paintIdx === i}
            onClick={() => {
              setPaintIdx(i);
              setErasing(false);
            }}
          />
        ))}
        <Button size="sm" aria-pressed={erasing} onClick={() => setErasing((v) => !v)}>
          Erase
        </Button>
        <Button size="sm" onClick={() => stack.addLayer()}>
          Add layer
        </Button>
        {/* Distinct accessible names ("Revert/Reapply last project change") so
            these controls never collide with the canvas toolbar's or Layers
            panel's undo/redo on the shared preview page; U-012 unifies them. */}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Revert last project change"
          title="Undo (resize / crop / trim / paint)"
          disabled={!stackSnap.canUndo}
          onClick={() => stack.undo()}
        >
          <span aria-hidden="true">↶</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Reapply last project change"
          title="Redo"
          disabled={!stackSnap.canRedo}
          onClick={() => stack.redo()}
        >
          <span aria-hidden="true">↷</span>
        </Button>
      </div>

      <p className="pf-project__status pf-readout">
        {activeLocked ? (
          <span role="status">Active layer locked — unlock to paint.</span>
        ) : (
          <>
            Drag to paint <b>{activeLayer?.name ?? '—'}</b> · {snapshot.w}×{snapshot.h} ·{' '}
            {stackSnap.layers.length} layer{stackSnap.layers.length === 1 ? '' : 's'}
            {snapshot.hasExtraFrames ? ` · ${snapshot.frameCount} frames` : ''}
          </>
        )}
      </p>
    </section>
  );
}

export default ProjectStage;
