/**
 * src/ui — React UI layer (design system, components, panels, dialogs, shell).
 * May use the DOM and app state; MUST NOT contain pure engine logic (that lives
 * in src/core). U-002 populates the design system + retro chrome.
 */
export const UI_MODULE = 'pixel-forge/ui' as const;

export { App, default as AppDefault } from './App';
export * from './color';
export * from './components';
export { useReducedMotion, useUiSound } from './hooks';
export * from './theme';
