/**
 * src/platform — browser glue (Canvas 2D, File System Access / browser-fs-access,
 * IndexedDB via idb-keyval, WebAudio, Web Workers). Isolates all side effects
 * from the pure engine (src/core) and UI (src/ui).
 */
export const PLATFORM_MODULE = 'pixel-forge/platform' as const;

export {
  bufferToPngBlob,
  bufferToSvgBlob,
  buildSpritesheet,
  type EncodeGifOptions,
  type ExportGifRequest,
  type ExportPngRequest,
  type ExportSpritesheetRequest,
  type ExportSvgRequest,
  encodeGifInWorker,
  exportGifFile,
  exportPngFile,
  exportSpritesheetFile,
  exportSvgFile,
  fileSaveSupported,
  type GifProgress,
  PNG_SCALES,
  type PngEncodeOptions,
  type PngScale,
  type SaveOptions,
  type SaveOutcome,
  sanitizeFileName,
  saveBlob,
  withExtension,
} from './exporters';
export {
  downloadText,
  paletteFormatFromFilename,
  readTextFile,
} from './files';
export {
  decodeImageFile,
  IMPORT_EXTENSIONS,
  IMPORT_MIME_TYPES,
  MAX_IMPORT_DIM,
  validateImageDimensions,
} from './imageImport';
export {
  CHECKER_COLORS,
  drawCheckerboard,
  drawPixelGrid,
  drawTileGrid,
} from './overlays';
export {
  createProjectStore,
  deriveGalleryEntry,
  estimateStorage,
  type GalleryEntry,
  idbKeyValStore,
  type KeyValStore,
  ProjectStore,
  requestPersistentStorage,
  type StorageEstimate,
} from './persistence';
export { exportProjectFile, openProjectFile } from './projectFile';
export { loadRecentColors, RECENT_COLORS_KEY, saveRecentColors } from './recentColors';
export {
  createRenderer,
  type GridConfig,
  PixelRenderer,
  type RendererCanvases,
  type RendererConfig,
} from './renderer';
export { renderThumbnail } from './thumbnail';
