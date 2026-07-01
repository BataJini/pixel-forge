/**
 * src/platform/recentColors.ts — persist the recent-colors strip across reloads
 * (master-spec §3.3: "recent-colors strip ... persisted").
 *
 * Browser glue (src/platform): a thin, defensive wrapper over `localStorage`.
 * All access is guarded so the pure state/UI never throws when storage is
 * unavailable, private-mode, quota-full, or the payload is corrupt. Colors are
 * stored as `#RRGGBBAA` strings and re-validated on load through the engine's
 * `tryHexToRgba`, so untrusted persisted data can never inject a bad color.
 */
import { rgbaToHex, tryHexToRgba } from '../core/color';
import type { RGBA } from '../core/types';

const STORAGE_KEY = 'pixelforge.recentColors.v1';
const MAX_STORED = 24;

function getStore(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') {
      return null;
    }
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/**
 * Load persisted recent colors, or `[]` when storage is absent/corrupt. Each
 * entry is re-validated; anything malformed is dropped rather than trusted.
 */
export function loadRecentColors(): RGBA[] {
  const store = getStore();
  if (store === null) {
    return [];
  }
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const colors: RGBA[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') {
        continue;
      }
      const result = tryHexToRgba(entry);
      if (result.ok) {
        colors.push(result.value);
      }
      if (colors.length >= MAX_STORED) {
        break;
      }
    }
    return colors;
  } catch {
    return [];
  }
}

/**
 * Persist recent colors (best-effort). Failures (quota, private mode) are
 * swallowed — losing the recents cache must never surface as an error or lose
 * the user's artwork (constitution: data safety).
 */
export function saveRecentColors(colors: readonly RGBA[]): void {
  const store = getStore();
  if (store === null) {
    return;
  }
  try {
    const hexes = colors.slice(0, MAX_STORED).map((c) => rgbaToHex(c, true));
    store.setItem(STORAGE_KEY, JSON.stringify(hexes));
  } catch {
    // Ignore persistence failures (quota / disabled storage).
  }
}

/** The storage key, exported for tests and Settings "wipe data". */
export const RECENT_COLORS_KEY = STORAGE_KEY;
