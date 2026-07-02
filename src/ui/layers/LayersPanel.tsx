import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { rgbaToHex } from '../../core/color';
import type { RGBA } from '../../core/types';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Panel } from '../components/Panel';
import { LayerCanvas } from './LayerCanvas';
import { LayerRow } from './LayerRow';
import { LayersProvider, useLayerStore } from './LayersProvider';
import './layers-panel.css';

const TRANSPARENT: RGBA = [0, 0, 0, 0];

// Demo paint colors — the user's true artwork colors, never the chrome theme
// tokens (the canvas is never tinted by the UI palette; constitution).
const PAINTS: readonly RGBA[] = [
  [255, 106, 26, 255],
  [255, 224, 138, 255],
  [47, 168, 196, 255],
  [232, 223, 210, 255],
  [18, 16, 14, 255],
];

function PanelBody() {
  const { stack, snapshot } = useLayerStore();
  const [paintIdx, setPaintIdx] = useState(0);
  const [erasing, setErasing] = useState(false);
  const [flattenOpen, setFlattenOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot.version intentionally re-derives the composite whenever any layer's pixels change (incl. in-place paint strokes on the same buffer reference).
  const composite = useMemo(() => stack.getComposite(), [stack, snapshot.version]);
  const activeLayer = snapshot.layers[snapshot.activeIndex];
  const activeLocked = activeLayer?.locked ?? false;
  const count = snapshot.layers.length;

  const paintAt = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = previewRef.current;
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
    previewRef.current?.setPointerCapture(e.pointerId);
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

  const confirmFlatten = (): void => {
    stack.flatten();
    setFlattenOpen(false);
  };

  return (
    <Panel title="Layers" className="pf-layers">
      <div
        className="pf-lpreview pf-checker"
        ref={previewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      >
        <LayerCanvas
          buffer={composite}
          version={snapshot.version}
          className="pf-lpreview__canvas"
          ariaLabel="Live composite of all visible layers"
        />
      </div>

      <fieldset className="pf-lpaint" aria-label="Preview paint color">
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
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          aria-pressed={erasing}
          onClick={() => setErasing((v) => !v)}
        >
          Erase
        </button>
      </fieldset>
      <p className="pf-layers__hint pf-readout">
        {activeLocked ? (
          <span role="status">Active layer is locked — unlock it to paint.</span>
        ) : (
          <>
            Drag on the preview to paint the active layer (<b>{activeLayer?.name ?? '—'}</b>).
          </>
        )}
      </p>

      <div className="pf-layers__ops" role="toolbar" aria-label="Layer actions">
        <Button size="sm" onClick={() => stack.addLayer()}>
          Add
        </Button>
        <Button size="sm" onClick={() => stack.duplicateLayer()}>
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!snapshot.canDelete}
          title={
            activeLocked
              ? 'Unlock this layer to delete it'
              : snapshot.canDelete
                ? 'Delete the active layer'
                : 'Cannot delete the last layer'
          }
          onClick={() => stack.deleteLayer()}
        >
          Delete
        </Button>
        <Button
          size="sm"
          disabled={!snapshot.canMergeDown}
          title={
            !snapshot.canMergeDown &&
            (activeLocked || snapshot.layers[snapshot.activeIndex - 1]?.locked)
              ? 'Unlock both layers to merge them'
              : 'Merge the active layer onto the one below'
          }
          onClick={() => stack.mergeDown()}
        >
          Merge ↓
        </Button>
        <Button
          size="sm"
          disabled={!snapshot.canFlatten}
          title={
            !snapshot.canFlatten && snapshot.anyLocked
              ? 'Unlock all layers to flatten'
              : 'Flatten all layers into one'
          }
          onClick={() => setFlattenOpen(true)}
        >
          Flatten
        </Button>
      </div>

      <div className="pf-layers__ops" role="toolbar" aria-label="Layer history">
        {/* Distinct accessible names ("Revert/Reapply last layer change") so this
            panel's history controls never clash with the canvas toolbar's Undo/Redo
            on the shared preview page; U-012 unifies them into one timeline. */}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Revert last layer change"
          disabled={!snapshot.canUndo}
          title={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : 'Undo last layer change'}
          onClick={() => stack.undo()}
        >
          <span aria-hidden="true">↶</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Reapply last layer change"
          disabled={!snapshot.canRedo}
          title={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : 'Reapply last layer change'}
          onClick={() => stack.redo()}
        >
          <span aria-hidden="true">↷</span>
        </Button>
      </div>

      <ul className="pf-layers__list" aria-label="Layers, top to bottom">
        {Array.from({ length: count }, (_, k) => count - 1 - k).map((index) => (
          <LayerRow
            key={snapshot.layers[index].id}
            stack={stack}
            layer={snapshot.layers[index]}
            index={index}
            total={count}
            active={index === snapshot.activeIndex}
            version={snapshot.version}
            onReorder={(from, to) => stack.moveLayer(from, to)}
          />
        ))}
      </ul>

      <p className="pf-layers__status pf-readout">
        {count} layer{count === 1 ? '' : 's'} · Active <b>{activeLayer?.name ?? '—'}</b>
      </p>

      <Dialog
        open={flattenOpen}
        title="Flatten"
        onClose={() => setFlattenOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setFlattenOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmFlatten}>
              Flatten all
            </Button>
          </>
        }
      >
        <p>
          Flatten merges all {count} layers into a single layer. You can undo it, but the individual
          layers will otherwise be gone. Continue?
        </p>
      </Dialog>
    </Panel>
  );
}

/**
 * The Layers workbench panel (master-spec §3.4): a live composite preview you can
 * paint on, and a reorderable layer list where each layer has a live thumbnail,
 * visibility eye, editable name, lock, and opacity. Add / duplicate / delete
 * (last-layer guarded) / merge-down / flatten (confirmed) and undo/redo are wired
 * to the undoable {@link LayerStack}. Provides its own store when standalone;
 * pass `standalone={false}` to share a `LayersProvider` mounted higher up.
 */
export function LayersPanel({ standalone = true }: { standalone?: boolean }) {
  if (!standalone) {
    return <PanelBody />;
  }
  return (
    <LayersProvider>
      <PanelBody />
    </LayersProvider>
  );
}

export default LayersPanel;
