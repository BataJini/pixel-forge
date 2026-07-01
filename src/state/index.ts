/**
 * src/state — application state stores (Zustand + Immer for metadata).
 * Holds the document/tool/view/history stores. Pure engine logic stays in
 * src/core; browser side effects stay in src/platform. Populated in later units.
 */
export const STATE_MODULE = 'pixel-forge/state' as const;
