/** src/ui/shell — app shell (U-012): menu bar, command palette, help overlay. */
export { CommandPalette } from './CommandPalette';
export { HelpOverlay } from './HelpOverlay';
export { MenuBar } from './MenuBar';
export { type CommandGroup, MENU_ORDER, type PfCommand } from './commands';
export { type FuzzyResult, fuzzyMatch, fuzzyRank, type RankedItem } from './fuzzy';
