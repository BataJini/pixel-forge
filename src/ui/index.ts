/**
 * src/ui — React UI layer (components, panels, dialogs, app shell).
 * May use the DOM and app state; MUST NOT contain pure engine logic (that lives
 * in src/core). Concrete workbench UI is built in later units.
 */
export const UI_MODULE = 'pixel-forge/ui' as const;

export { App, default as AppDefault } from './App';
