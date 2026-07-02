/**
 * src/ui/shell/commands.ts — the command model shared by the menu bar and the
 * Ctrl/Cmd+K command palette (master-spec §3.7). A command is a titled, grouped,
 * runnable action; the SAME `PfCommand[]` feeds both surfaces, so a menu item and
 * its palette entry always invoke identical behavior (no dead or divergent items).
 */
export type CommandGroup = 'File' | 'Edit' | 'View' | 'Canvas' | 'Tools' | 'Help';

export interface PfCommand {
  /** Stable unique id (also the React key). */
  readonly id: string;
  /** Human label shown in the menu / palette. */
  readonly title: string;
  /** Which top-level menu the command belongs to. */
  readonly group: CommandGroup;
  /** Optional shortcut hint (display only; the real binding lives on the canvas). */
  readonly shortcut?: string;
  /** When true the item renders disabled and cannot run. */
  readonly disabled?: boolean;
  /** The action. */
  readonly run: () => void;
}

/** Fixed left-to-right order of the menu bar. */
export const MENU_ORDER: readonly CommandGroup[] = [
  'File',
  'Edit',
  'View',
  'Canvas',
  'Tools',
  'Help',
];
