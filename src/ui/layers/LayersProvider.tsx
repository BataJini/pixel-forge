import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type LayerSnapshot, LayerStack } from '../../state';
import { MOTIF_H, MOTIF_W, seedForgeLayers } from './motif';

export interface LayerStoreValue {
  readonly stack: LayerStack;
  readonly snapshot: LayerSnapshot;
}

const LayerContext = createContext<LayerStoreValue | null>(null);

export interface LayersProviderProps {
  readonly children: ReactNode;
  /**
   * Factory for the stack instance — tests inject a seeded/known stack. Defaults
   * to the forge-native demo stack (Anvil / Heat / Sparks) so the panel shows real
   * overlapping artwork to demonstrate the layer semantics.
   */
  readonly createStack?: () => LayerStack;
}

function defaultStack(): LayerStack {
  const layers = seedForgeLayers();
  return new LayerStack(MOTIF_W, MOTIF_H, {
    initial: { layers, activeId: layers[layers.length - 1].id },
  });
}

/**
 * Provides a single {@link LayerStack} instance and its live snapshot to the panel
 * via `useSyncExternalStore`, so any change (structural, metadata, or an in-place
 * pixel stroke — the snapshot version bumps every time) re-renders consumers
 * without tearing. The stack is created once per provider instance.
 */
export function LayersProvider({ children, createStack }: LayersProviderProps) {
  const stackRef = useRef<LayerStack | null>(null);
  if (stackRef.current === null) {
    stackRef.current = createStack ? createStack() : defaultStack();
  }
  const stack = stackRef.current;
  const snapshot = useSyncExternalStore(stack.subscribe, stack.getSnapshot, stack.getSnapshot);
  const value = useMemo<LayerStoreValue>(() => ({ stack, snapshot }), [stack, snapshot]);
  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>;
}

/** Access the layer stack. Throws outside a `LayersProvider` (programmer error). */
export function useLayerStore(): LayerStoreValue {
  const value = useContext(LayerContext);
  if (value === null) {
    throw new Error('useLayerStore must be used within a <LayersProvider>.');
  }
  return value;
}
