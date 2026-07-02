import { useCallback, useEffect, useRef, useState } from 'react';
import { buildTimeline, cycleDurationMs, frameIndexAtTime } from '../../core/frames';
import type { FrameStack } from '../../state';

/** The transport surface returned by {@link useFramePlayback}. */
export interface FramePlayback {
  readonly playing: boolean;
  /** Start (or resume) playback from the current frame. No-op for a single frame. */
  play(): void;
  /** Pause on the current frame. */
  pause(): void;
  /** Stop and return to the first frame. */
  stop(): void;
  /** Toggle play/pause. */
  toggle(): void;
  /** Step to the next frame (wraps), pausing playback. */
  next(): void;
  /** Step to the previous frame (wraps), pausing playback. */
  prev(): void;
}

/**
 * Drives live animation playback for a {@link FrameStack} with a rAF clock, mapping
 * elapsed time to the active frame via the pure `frameIndexAtTime` (honoring per-
 * frame durations, global fps, loop and ping-pong). Playback is USER-INITIATED
 * (never autoplay), so it is exempt from the reduced-motion ambient-motion rule; the
 * honest frame swap is the app's core function, not decoration. Stepping (`next`/
 * `prev`) is deterministic for keyboard use and testing.
 */
export function useFramePlayback(stack: FrameStack): FramePlayback {
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);
  const clockRef = useRef({ t0: 0, elapsed0: 0 });

  const stepBy = useCallback(
    (delta: number): void => {
      setPlaying(false);
      const count = stack.getFrames().length;
      if (count <= 1) {
        return;
      }
      const nextIndex = (stack.getActiveIndex() + delta + count) % count;
      stack.setActiveFrameIndex(nextIndex);
    },
    [stack],
  );

  const play = useCallback((): void => {
    const frames = stack.getFrames();
    if (frames.length <= 1) {
      return;
    }
    // Resume from the active frame's forward start offset so play continues in place.
    const timeline = buildTimeline(frames, stack.getFps());
    const step = timeline.steps[stack.getActiveIndex()];
    clockRef.current = { t0: performance.now(), elapsed0: step ? step.startMs : 0 };
    setPlaying(true);
  }, [stack]);

  const pause = useCallback((): void => setPlaying(false), []);

  const stop = useCallback((): void => {
    setPlaying(false);
    stack.setActiveFrameIndex(0);
  }, [stack]);

  const toggle = useCallback((): void => {
    setPlaying((p) => {
      if (p) {
        return false;
      }
      const frames = stack.getFrames();
      if (frames.length <= 1) {
        return false;
      }
      const timeline = buildTimeline(frames, stack.getFps());
      const step = timeline.steps[stack.getActiveIndex()];
      clockRef.current = { t0: performance.now(), elapsed0: step ? step.startMs : 0 };
      return true;
    });
  }, [stack]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    let active = true;
    const tick = (): void => {
      if (!active) {
        return;
      }
      const frames = stack.getFrames();
      const fps = stack.getFps();
      const snap = stack.getSnapshot();
      const elapsed = clockRef.current.elapsed0 + (performance.now() - clockRef.current.t0);
      if (!snap.loop) {
        const total = cycleDurationMs(frames, { fps, pingPong: snap.pingPong });
        if (elapsed >= total) {
          stack.setActiveFrameIndex(frames.length - 1);
          setPlaying(false);
          return;
        }
      }
      const idx = frameIndexAtTime(frames, elapsed, {
        fps,
        loop: snap.loop,
        pingPong: snap.pingPong,
      });
      if (idx !== stack.getActiveIndex()) {
        stack.setActiveFrameIndex(idx);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [playing, stack]);

  const next = useCallback((): void => stepBy(1), [stepBy]);
  const prev = useCallback((): void => stepBy(-1), [stepBy]);

  return { playing, play, pause, stop, toggle, next, prev };
}
