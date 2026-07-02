/** Frames / timeline panel (U-008) — public surface for the app shell + tests. */

export {
  type FrameStoreValue,
  FramesProvider,
  type FramesProviderProps,
  useFrameStore,
} from './FramesProvider';
export { FrameThumb, type FrameThumbProps } from './FrameThumb';
export { MOTIF_FPS, MOTIF_H, MOTIF_W, seedForgeFrames } from './motif';
export { OnionGhosts, type OnionGhostsProps } from './OnionGhosts';
export { TimelinePanel } from './TimelinePanel';
export { type FramePlayback, useFramePlayback } from './useFramePlayback';
