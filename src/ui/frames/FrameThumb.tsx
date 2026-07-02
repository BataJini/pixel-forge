import { type ChangeEvent, type DragEvent, useMemo } from 'react';
import { clampDuration } from '../../core/frames';
import type { Frame } from '../../core/types';
import type { FrameStack } from '../../state';
import { LayerCanvas } from '../layers';

export interface FrameThumbProps {
  readonly stack: FrameStack;
  readonly frame: Frame;
  /** Timeline index (0 = first). */
  readonly index: number;
  readonly total: number;
  readonly active: boolean;
  readonly version: number;
  /** Called with the dragged/target indices when a drop completes. */
  readonly onReorder: (from: number, to: number) => void;
}

const DRAG_MIME = 'application/x-pf-frame-index';

/**
 * One cell of the timeline strip: a live composite thumbnail, the frame number, an
 * editable per-frame duration (ms), and keyboard-accessible move-left/right buttons
 * (native drag is pointer-only). The active cell is marked with `aria-current` and a
 * shape/weight cue, never hue alone (WCAG 2.2).
 */
export function FrameThumb({
  stack,
  frame,
  index,
  total,
  active,
  version,
  onReorder,
}: FrameThumbProps) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-derives the composite when this frame's pixels change (cached by frame identity in the store).
  const composite = useMemo(() => stack.getFrameComposite(frame), [stack, frame, version]);

  const select = (): void => stack.setActiveFrameIndex(index);

  const onDuration = (e: ChangeEvent<HTMLInputElement>): void => {
    stack.setFrameDuration(index, Number(e.target.value));
  };

  const onDragStart = (e: DragEvent<HTMLLIElement>): void => {
    e.dataTransfer.setData(DRAG_MIME, String(index));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent<HTMLLIElement>): void => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  const onDrop = (e: DragEvent<HTMLLIElement>): void => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData(DRAG_MIME));
    if (Number.isInteger(from) && from !== index) {
      onReorder(from, index);
    }
  };

  return (
    <li
      className="pf-frame"
      data-frame-id={frame.id}
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="pf-frame__thumbbtn pf-checker"
        aria-label={`Select frame ${index + 1}`}
        onClick={select}
      >
        <LayerCanvas
          buffer={composite}
          version={version}
          className="pf-frame__thumb"
          ariaLabel={`Frame ${index + 1} thumbnail`}
        />
        <span className="pf-frame__num pf-readout" aria-hidden="true">
          {index + 1}
        </span>
      </button>
      <label className="pf-frame__dur">
        <span className="pf-visually-hidden">Frame {index + 1} duration (ms)</span>
        <input
          className="pf-frame__durinput pf-readout"
          type="number"
          min={10}
          max={60000}
          step={10}
          value={frame.durationMs}
          aria-label={`Frame ${index + 1} duration in milliseconds`}
          onChange={onDuration}
          onFocus={select}
          onBlur={(e) => {
            // Snap a stray value back into bounds on commit.
            const clamped = clampDuration(Number(e.target.value));
            if (clamped !== frame.durationMs) {
              stack.setFrameDuration(index, clamped);
            }
          }}
        />
        <span className="pf-frame__durunit pf-readout" aria-hidden="true">
          ms
        </span>
      </label>
      <span className="pf-frame__move">
        <button
          type="button"
          className="pf-iconbtn"
          aria-label={`Move frame ${index + 1} earlier`}
          title="Move earlier"
          disabled={isFirst}
          onClick={() => onReorder(index, index - 1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="pf-iconbtn"
          aria-label={`Move frame ${index + 1} later`}
          title="Move later"
          disabled={isLast}
          onClick={() => onReorder(index, index + 1)}
        >
          ▶
        </button>
      </span>
    </li>
  );
}
