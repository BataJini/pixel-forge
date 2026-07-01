/**
 * src/platform — browser glue (Canvas 2D, File System Access / browser-fs-access,
 * IndexedDB via idb-keyval, WebAudio, Web Workers). Isolates all side effects
 * from the pure engine (src/core) and UI (src/ui).
 */
export const PLATFORM_MODULE = 'pixel-forge/platform' as const;

export {
  downloadText,
  paletteFormatFromFilename,
  readTextFile,
} from './files';
export {
  CHECKER_COLORS,
  drawCheckerboard,
  drawPixelGrid,
  drawTileGrid,
} from './overlays';
export { loadRecentColors, RECENT_COLORS_KEY, saveRecentColors } from './recentColors';
export {
  createRenderer,
  type GridConfig,
  PixelRenderer,
  type RendererCanvases,
  type RendererConfig,
} from './renderer';
