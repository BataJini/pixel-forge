import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { rgbaToHex } from '../../core/color';
import { onionGhosts } from '../../core/frames';
import type { RGBA } from '../../core/types';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { Slider } from '../components/Slider';
import { LayerCanvas } from '../layers';
import { FramesProvider, useFrameStore } from './FramesProvider';
import { FrameThumb } from './FrameThumb';
import { OnionGhosts } from './OnionGhosts';
import { useFramePlayback } from './useFramePlayback';
import './frames-panel.css';

const TRANSPARENT: RGBA = [0, 0, 0, 0];

// Demo paint colors for the active (Spark) layer — the user's true artwork colors,
// never the chrome theme tokens (the canvas is never tinted by the UI palette).
const PAINTS: readonly RGBA[] = [
  [255, 224, 138, 255],
  [255, 176, 58, 255],
  [255, 106, 26, 255],
];

function TimelineBody() {
  const { stack, snapshot } = useFrameStore();
  const playback = useFramePlayback(stack);
  const [paintIdx, setPaintIdx] = useState(0);
  const [erasing, setErasing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  const { w, h } = stack.getSize();
  const { onion } = snapshot;

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot.version re-derives the live composite whenever any pixel changes (in-place strokes share the buffer reference).
  const current = useMemo(() => stack.getActiveComposite(), [stack, snapshot.version]);

  // Ghosts are hidden while playing (the animation itself conveys motion).
  const ghosts = useMemo(
    () =>
      onion.enabled && !playback.playing
        ? onionGhosts(
            snapshot.frames,
            snapshot.activeIndex,
            { before: onion.before, after: onion.after },
            onion.opacity,
          )
        : [],
    [onion, playback.playing, snapshot.frames, snapshot.activeIndex],
  );

  const paintAt = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = previewRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
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

  const count = snapshot.frameCount;

  return (
    <Panel
      title="Frames"
      className="pf-frames"
      data-playing={playback.playing ? 'true' : undefined}
    >
      {/* ── live preview: onion ghosts under the current (paintable) frame ── */}
      <div
        className="pf-fpreview pf-checker"
        ref={previewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      >
        {ghosts.length > 0 && (
          <OnionGhosts
            className="pf-fpreview__onion"
            ghosts={ghosts}
            getComposite={(frame) => stack.getFrameComposite(frame)}
            w={w}
            h={h}
            version={snapshot.version}
          />
        )}
        <LayerCanvas
          buffer={current}
          version={snapshot.version}
          className="pf-fpreview__canvas"
          ariaLabel={`Frame ${snapshot.activeIndex + 1} of ${count}, live preview`}
        />
      </div>

      {/* ── transport ── */}
      <div className="pf-transport" role="toolbar" aria-label="Playback">
        <Button
          size="sm"
          aria-label="Previous frame"
          title="Previous frame"
          onClick={playback.prev}
        >
          <span aria-hidden="true">⏮</span>
        </Button>
        <Button
          size="sm"
          variant="primary"
          active={playback.playing}
          aria-pressed={playback.playing}
          aria-label={playback.playing ? 'Pause' : 'Play'}
          title={playback.playing ? 'Pause' : 'Play'}
          onClick={playback.toggle}
        >
          <span aria-hidden="true">{playback.playing ? '⏸' : '▶'}</span>
        </Button>
        <Button
          size="sm"
          aria-label="Stop"
          title="Stop (return to first frame)"
          onClick={playback.stop}
        >
          <span aria-hidden="true">⏹</span>
        </Button>
        <Button size="sm" aria-label="Next frame" title="Next frame" onClick={playback.next}>
          <span aria-hidden="true">⏭</span>
        </Button>
        <Button
          size="sm"
          active={snapshot.loop}
          aria-pressed={snapshot.loop}
          aria-label="Loop"
          title="Loop playback"
          onClick={() => stack.setLoop(!snapshot.loop)}
        >
          Loop
        </Button>
        <Button
          size="sm"
          active={snapshot.pingPong}
          aria-pressed={snapshot.pingPong}
          aria-label="Ping-pong"
          title="Bounce back and forth"
          onClick={() => stack.setPingPong(!snapshot.pingPong)}
        >
          Ping-pong
        </Button>
      </div>

      <Slider
        className="pf-frames__fps"
        label="FPS"
        min={1}
        max={60}
        step={1}
        value={snapshot.fps}
        valueLabel={`${snapshot.fps} fps`}
        aria-label="Frames per second"
        onChange={(e) => stack.setFps(Number(e.target.value))}
      />

      {/* ── onion skin ── */}
      <fieldset className="pf-onion" aria-label="Onion skin">
        <div className="pf-onion__head">
          <span className="pf-label">Onion skin</span>
          <Button
            size="sm"
            active={onion.enabled}
            aria-pressed={onion.enabled}
            aria-label={onion.enabled ? 'Disable onion skin' : 'Enable onion skin'}
            onClick={() => stack.toggleOnion()}
          >
            {onion.enabled ? 'On' : 'Off'}
          </Button>
        </div>
        <div className="pf-onion__ranges" data-disabled={onion.enabled ? undefined : 'true'}>
          <Slider
            label="Prev"
            min={0}
            max={4}
            step={1}
            value={onion.before}
            valueLabel={String(onion.before)}
            disabled={!onion.enabled}
            aria-label="Onion previous frames"
            onChange={(e) => stack.setOnion({ before: Number(e.target.value) })}
          />
          <Slider
            label="Next"
            min={0}
            max={4}
            step={1}
            value={onion.after}
            valueLabel={String(onion.after)}
            disabled={!onion.enabled}
            aria-label="Onion next frames"
            onChange={(e) => stack.setOnion({ after: Number(e.target.value) })}
          />
          <Slider
            label="Opacity"
            min={10}
            max={90}
            step={5}
            value={Math.round(onion.opacity * 100)}
            valueLabel={`${Math.round(onion.opacity * 100)}%`}
            disabled={!onion.enabled}
            aria-label="Onion opacity"
            onChange={(e) => stack.setOnion({ opacity: Number(e.target.value) / 100 })}
          />
        </div>
      </fieldset>

      {/* ── paint the active layer (to demo per-frame edits + onion) ── */}
      <fieldset className="pf-fpaint" aria-label="Preview paint color">
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
        <span className="pf-frames__hint pf-readout">
          Paints the <b>Spark</b> layer of frame {snapshot.activeIndex + 1}
        </span>
      </fieldset>

      {/* ── frame ops ── */}
      <div className="pf-frames__ops" role="toolbar" aria-label="Frame actions">
        <Button size="sm" onClick={() => stack.addFrame()}>
          Add frame
        </Button>
        <Button size="sm" onClick={() => stack.duplicateFrame()}>
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!snapshot.canDeleteFrame}
          title={
            snapshot.canDeleteFrame ? 'Delete the active frame' : 'Cannot delete the last frame'
          }
          onClick={() => stack.deleteFrame()}
        >
          Delete
        </Button>
        <Button
          size="sm"
          title="Add a layer to every frame (layers stay aligned)"
          onClick={() => stack.addLayer()}
        >
          + Layer (all frames)
        </Button>
      </div>

      {/* ── history ── */}
      <div className="pf-frames__ops" role="toolbar" aria-label="Frame history">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Revert last frame change"
          disabled={!snapshot.canUndo}
          title={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : 'Undo last frame change'}
          onClick={() => stack.undo()}
        >
          <span aria-hidden="true">↶</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Reapply last frame change"
          disabled={!snapshot.canRedo}
          title={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : 'Reapply last frame change'}
          onClick={() => stack.redo()}
        >
          <span aria-hidden="true">↷</span>
        </Button>
      </div>

      {/* ── timeline strip ── */}
      <ol className="pf-frames__strip" aria-label="Timeline, first to last">
        {snapshot.frames.map((frame, index) => (
          <FrameThumb
            key={frame.id}
            stack={stack}
            frame={frame}
            index={index}
            total={count}
            active={index === snapshot.activeIndex}
            version={snapshot.version}
            onReorder={(from, to) => stack.moveFrame(from, to)}
          />
        ))}
      </ol>

      <p className="pf-frames__status pf-readout">
        {count} frame{count === 1 ? '' : 's'} · {snapshot.layerCount} layer
        {snapshot.layerCount === 1 ? '' : 's'} · Frame <b>{snapshot.activeIndex + 1}</b>/{count}
      </p>
    </Panel>
  );
}

/**
 * The Frames / timeline workbench panel (master-spec §3.5): a live preview that plays
 * the composite and shows onion-skin ghosts (previous warm, next cool) under the
 * current frame; transport (play/pause/stop/step, loop, ping-pong); global FPS;
 * onion toggle + range + opacity; and a reorderable timeline strip of frame
 * thumbnails with per-frame durations, add/duplicate/delete, an add-layer-to-all-
 * frames action, and undo/redo — all wired to the undoable {@link FrameStack}.
 * Provides its own store when standalone; pass `standalone={false}` to share a
 * `FramesProvider` mounted higher up.
 */
export function TimelinePanel({ standalone = true }: { standalone?: boolean }) {
  if (!standalone) {
    return <TimelineBody />;
  }
  return (
    <FramesProvider>
      <TimelineBody />
    </FramesProvider>
  );
}

export default TimelinePanel;
