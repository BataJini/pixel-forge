import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer } from 'react';
import type { Palette, RGBA } from '../../core/types';
import { loadRecentColors, saveRecentColors } from '../../platform/recentColors';
import { type ColorState, colorReducer, initialColorState } from '../../state/colorStore';

/** Imperative action creators exposed to the panel components. */
export interface ColorActions {
  setFg(color: RGBA, remember?: boolean): void;
  setBg(color: RGBA, remember?: boolean): void;
  swap(): void;
  reset(): void;
  remember(color: RGBA): void;
  loadPalette(palette: Palette): void;
  setPalette(palette: Palette): void;
  setIndexed(value: boolean): void;
  toggleIndexed(): void;
}

export interface ColorContextValue {
  readonly state: ColorState;
  readonly actions: ColorActions;
}

export const ColorContext = createContext<ColorContextValue | null>(null);

export interface ColorProviderProps {
  readonly children: ReactNode;
  /** Optional seed (tests); defaults to the free-color initial state. */
  readonly initial?: ColorState;
}

/**
 * Provides the color/palette store to the panel. Hydrates the recent-colors
 * strip from persistent storage on mount and writes it back whenever it changes
 * (both guarded in the platform layer). The reducer itself is pure (src/state).
 */
export function ColorProvider({ children, initial }: ColorProviderProps) {
  const [state, dispatch] = useReducer(
    colorReducer,
    initial,
    (seed) => seed ?? initialColorState(),
  );

  // Hydrate persisted recents once on mount (skipped when a test seed is given).
  useEffect(() => {
    if (initial !== undefined) {
      return;
    }
    const stored = loadRecentColors();
    if (stored.length > 0) {
      dispatch({ type: 'hydrateRecent', recent: stored });
    }
  }, [initial]);

  // Persist recents (best-effort) whenever they change.
  useEffect(() => {
    saveRecentColors(state.recent);
  }, [state.recent]);

  const actions = useMemo<ColorActions>(
    () => ({
      setFg: (color, remember) => dispatch({ type: 'setFg', color, remember }),
      setBg: (color, remember) => dispatch({ type: 'setBg', color, remember }),
      swap: () => dispatch({ type: 'swap' }),
      reset: () => dispatch({ type: 'reset' }),
      remember: (color) => dispatch({ type: 'remember', color }),
      loadPalette: (palette) => dispatch({ type: 'loadPalette', palette }),
      setPalette: (palette) => dispatch({ type: 'setPalette', palette }),
      setIndexed: (value) => dispatch({ type: 'setIndexed', value }),
      toggleIndexed: () => dispatch({ type: 'toggleIndexed' }),
    }),
    [],
  );

  const value = useMemo<ColorContextValue>(() => ({ state, actions }), [state, actions]);
  return <ColorContext.Provider value={value}>{children}</ColorContext.Provider>;
}

/** Access the color/palette store. Throws outside a `ColorProvider` (programmer error). */
export function useColorStore(): ColorContextValue {
  const value = useContext(ColorContext);
  if (value === null) {
    throw new Error('useColorStore must be used within a <ColorProvider>.');
  }
  return value;
}
