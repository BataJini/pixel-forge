/**
 * src/state — application state stores (Zustand + Immer for metadata).
 * Holds the document/tool/view/history stores. Pure engine logic stays in
 * src/core; browser side effects stay in src/platform. Populated in later units.
 */
export const STATE_MODULE = 'pixel-forge/state' as const;

export {
  type ColorAction,
  type ColorState,
  colorReducer,
  DEFAULT_ACTIVE_PALETTE,
  effectivePaintColor,
  initialColorState,
  pushRecent,
  RECENT_CAP,
  RESET_BG,
  RESET_FG,
} from './colorStore';
export {
  DEFAULT_ONION,
  type FrameSnapshot,
  FrameStack,
  type FrameStackOptions,
  frameFromLayers,
  type OnionConfig,
} from './frameStore';
export {
  History,
  type HistoryEntry,
  type HistoryOptions,
  type HistorySink,
  type HistorySnapshot,
  PREVIEW_FRAME_ID,
  PREVIEW_LAYER_ID,
  patchEntry,
} from './historyStore';
export {
  type LayerSnapshot,
  LayerStack,
  type LayerStackOptions,
  layerFromBuffer,
} from './layerStore';
export {
  type PointerMods,
  type RenderTarget,
  type ToolId,
  ToolSession,
  type ToolState,
} from './toolSession';
