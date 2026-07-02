import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type FrameSnapshot, FrameStack } from '../../state';
import { MOTIF_FPS, MOTIF_H, MOTIF_W, seedForgeFrames } from './motif';

export interface FrameStoreValue {
  readonly stack: FrameStack;
  readonly snapshot: FrameSnapshot;
}

const FrameContext = createContext<FrameStoreValue | null>(null);

export interface FramesProviderProps {
  readonly children: ReactNode;
  /**
   * Factory for the stack instance — tests inject a seeded/known stack. Defaults to
   * the forge-native four-frame hammer-strike animation so the timeline shows real
   * per-frame artwork to demonstrate playback + onion skinning.
   */
  readonly createStack?: () => FrameStack;
}

function defaultStack(): FrameStack {
  const frames = seedForgeFrames();
  return new FrameStack(MOTIF_W, MOTIF_H, {
    initial: { frames, activeFrameId: frames[0].id, activeLayerId: 'layer-2', fps: MOTIF_FPS },
  });
}

/**
 * Provides a single {@link FrameStack} instance and its live snapshot to the timeline
 * via `useSyncExternalStore`, so any change (structural, config, playback, or an
 * in-place pixel stroke — the snapshot version bumps every time) re-renders consumers
 * without tearing. The stack is created once per provider instance.
 */
export function FramesProvider({ children, createStack }: FramesProviderProps) {
  const stackRef = useRef<FrameStack | null>(null);
  if (stackRef.current === null) {
    stackRef.current = createStack ? createStack() : defaultStack();
  }
  const stack = stackRef.current;
  const snapshot = useSyncExternalStore(stack.subscribe, stack.getSnapshot, stack.getSnapshot);
  const value = useMemo<FrameStoreValue>(() => ({ stack, snapshot }), [stack, snapshot]);
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

/** Access the frame stack. Throws outside a `FramesProvider` (programmer error). */
export function useFrameStore(): FrameStoreValue {
  const value = useContext(FrameContext);
  if (value === null) {
    throw new Error('useFrameStore must be used within a <FramesProvider>.');
  }
  return value;
}
