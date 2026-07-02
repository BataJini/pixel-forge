import { type ChangeEvent, type DragEvent, useState } from 'react';
import type { Layer } from '../../core/types';
import type { LayerStack } from '../../state';
import { Slider } from '../components/Slider';
import { LayerCanvas } from './LayerCanvas';

export interface LayerRowProps {
  readonly stack: LayerStack;
  readonly layer: Layer;
  /** Stack index (0 = bottom). Rows render top-first, but ops use this index. */
  readonly index: number;
  readonly total: number;
  readonly active: boolean;
  readonly version: number;
  /** Called with the dragged/target stack indices when a drop completes. */
  readonly onReorder: (from: number, to: number) => void;
}

const DRAG_MIME = 'application/x-pf-layer-index';

/**
 * One row of the Layers panel: drag handle, visibility eye, live thumbnail,
 * editable name, lock, and an opacity slider — plus keyboard-accessible move
 * up/down buttons (native drag-and-drop is pointer-only, so the buttons keep
 * reordering operable by keyboard, WCAG 2.2). The active row is marked with
 * `aria-current` and a shape/weight change, never by hue alone.
 */
export function LayerRow({
  stack,
  layer,
  index,
  total,
  active,
  version,
  onReorder,
}: LayerRowProps) {
  const [dragOver, setDragOver] = useState(false);
  const isTop = index === total - 1;
  const isBottom = index === 0;

  const activate = (): void => stack.setActive(layer.id);

  const onName = (e: ChangeEvent<HTMLInputElement>): void =>
    stack.renameLayer(index, e.target.value);

  const onOpacity = (e: ChangeEvent<HTMLInputElement>): void =>
    stack.setOpacity(index, Number(e.target.value));

  const onDragStart = (e: DragEvent<HTMLLIElement>): void => {
    e.dataTransfer.setData(DRAG_MIME, String(index));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent<HTMLLIElement>): void => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  };
  const onDrop = (e: DragEvent<HTMLLIElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const from = Number(e.dataTransfer.getData(DRAG_MIME));
    if (Number.isInteger(from) && from !== index) {
      onReorder(from, index);
    }
  };

  return (
    <li
      className="pf-layer"
      data-active={active ? 'true' : undefined}
      data-dragover={dragOver ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="pf-layer__main">
        <span className="pf-layer__grip" aria-hidden="true" title="Drag to reorder">
          ⠿
        </span>
        <button
          type="button"
          className="pf-iconbtn"
          aria-pressed={layer.visible}
          aria-label={`${layer.visible ? 'Hide' : 'Show'} layer ${layer.name}`}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          onClick={() => stack.toggleVisible(index)}
        >
          <span className="pf-eye" data-on={layer.visible ? 'true' : 'false'} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pf-layer__thumbbtn pf-checker"
          aria-label={`Select layer ${layer.name}`}
          onClick={activate}
        >
          <LayerCanvas
            buffer={layer.buffer}
            version={version}
            className="pf-layer__thumb"
            ariaLabel={`Thumbnail of layer ${layer.name}`}
          />
        </button>
        <input
          className="pf-layer__name"
          type="text"
          value={layer.name}
          aria-label={`Name of layer ${index + 1}`}
          onChange={onName}
          onFocus={activate}
        />
        <button
          type="button"
          className="pf-iconbtn"
          aria-pressed={layer.locked}
          aria-label={`${layer.locked ? 'Unlock' : 'Lock'} layer ${layer.name}`}
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={() => stack.toggleLocked(index)}
        >
          <span className="pf-lock" data-on={layer.locked ? 'true' : 'false'} aria-hidden="true" />
        </button>
      </div>
      <div className="pf-layer__foot">
        <Slider
          className="pf-layer__opacity"
          label="Opacity"
          min={0}
          max={100}
          step={1}
          value={layer.opacity}
          valueLabel={`${layer.opacity}%`}
          aria-label={`Opacity of layer ${layer.name}`}
          onChange={onOpacity}
          onFocus={activate}
        />
        <span className="pf-layer__nudge">
          <button
            type="button"
            className="pf-iconbtn"
            aria-label={`Move layer ${layer.name} up`}
            title="Move up"
            disabled={isTop}
            onClick={() => onReorder(index, index + 1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="pf-iconbtn"
            aria-label={`Move layer ${layer.name} down`}
            title="Move down"
            disabled={isBottom}
            onClick={() => onReorder(index, index - 1)}
          >
            ▼
          </button>
        </span>
      </div>
    </li>
  );
}
