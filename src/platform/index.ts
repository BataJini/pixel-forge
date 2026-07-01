/**
 * src/platform — browser glue (Canvas 2D, File System Access / browser-fs-access,
 * IndexedDB via idb-keyval, WebAudio, Web Workers). Isolates all side effects
 * from the pure engine (src/core) and UI (src/ui). Populated in later units.
 */
export const PLATFORM_MODULE = 'pixel-forge/platform' as const;
