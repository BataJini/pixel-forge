import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { type CrtLevel, DEFAULT_CRT_LEVEL, effectiveCrtLevel, isCrtLevel } from './crt';
import { DEFAULT_THEME, isThemeId, type ThemeId } from './themes';

/**
 * Theme + display-settings provider.
 *
 * Owns the switchable chrome theme, the CRT display level, the clean-mode escape
 * hatch, and the (muted-by-default) sound preference. It writes `data-theme` and
 * `data-crt` to the document element so the token layer re-tempers, and persists
 * choices to localStorage defensively (private mode / disabled storage never
 * throws). Defaults: Arcade CRT + Subtle CRT + clean off + sound OFF.
 */

export interface ThemeContextValue {
  readonly theme: ThemeId;
  readonly setTheme: (theme: ThemeId) => void;
  readonly crtLevel: CrtLevel;
  readonly setCrtLevel: (level: CrtLevel) => void;
  /** Effective level after clean-mode is applied (what the overlay renders). */
  readonly renderedCrtLevel: CrtLevel;
  readonly cleanMode: boolean;
  readonly setCleanMode: (clean: boolean) => void;
  readonly toggleCleanMode: () => void;
  /** Sound is muted by default; this is the user's reduce-sound preference. */
  readonly soundEnabled: boolean;
  readonly setSoundEnabled: (enabled: boolean) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEYS = {
  theme: 'pixelforge.theme',
  crt: 'pixelforge.crtLevel',
  clean: 'pixelforge.cleanMode',
  sound: 'pixelforge.soundEnabled',
} as const;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorage(key: string): string | null {
  if (!canUseStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / quota / locked-down browser).
    // Persistence is best-effort; the in-memory state remains authoritative.
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = readStorage(key);
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return fallback;
}

export interface ThemeProviderProps {
  readonly children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = readStorage(STORAGE_KEYS.theme);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  });
  const [crtLevel, setCrtLevelState] = useState<CrtLevel>(() => {
    const stored = readStorage(STORAGE_KEYS.crt);
    return isCrtLevel(stored) ? stored : DEFAULT_CRT_LEVEL;
  });
  const [cleanMode, setCleanModeState] = useState<boolean>(() =>
    readBoolean(STORAGE_KEYS.clean, false),
  );
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() =>
    readBoolean(STORAGE_KEYS.sound, false),
  );

  const renderedCrtLevel = effectiveCrtLevel(crtLevel, cleanMode);

  // Reflect theme + effective CRT level onto <html> so the token layer swaps.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.crt = renderedCrtLevel;
  }, [theme, renderedCrtLevel]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    writeStorage(STORAGE_KEYS.theme, next);
  }, []);

  const setCrtLevel = useCallback((next: CrtLevel) => {
    setCrtLevelState(next);
    writeStorage(STORAGE_KEYS.crt, next);
  }, []);

  const setCleanMode = useCallback((next: boolean) => {
    setCleanModeState(next);
    writeStorage(STORAGE_KEYS.clean, String(next));
  }, []);

  const toggleCleanMode = useCallback(() => {
    setCleanModeState((prev) => {
      const next = !prev;
      writeStorage(STORAGE_KEYS.clean, String(next));
      return next;
    });
  }, []);

  const setSoundEnabled = useCallback((next: boolean) => {
    setSoundEnabledState(next);
    writeStorage(STORAGE_KEYS.sound, String(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      crtLevel,
      setCrtLevel,
      renderedCrtLevel,
      cleanMode,
      setCleanMode,
      toggleCleanMode,
      soundEnabled,
      setSoundEnabled,
    }),
    [
      theme,
      setTheme,
      crtLevel,
      setCrtLevel,
      renderedCrtLevel,
      cleanMode,
      setCleanMode,
      toggleCleanMode,
      soundEnabled,
      setSoundEnabled,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
