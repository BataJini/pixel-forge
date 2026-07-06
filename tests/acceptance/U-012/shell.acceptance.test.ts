// Held-out acceptance — U-012 App shell (command palette fuzzy search). Builder must NOT edit.
// Targets master-spec §3.7 command palette. Runner: Vitest (the menu/shortcut wiring
// is additionally exercised by e2e/shell.spec.ts under Playwright).
import { describe, expect, it } from 'vitest';
import { fuzzyRank } from '../../../src/ui/shell/fuzzy';

interface Cmd {
  readonly id: string;
  readonly group: string;
  readonly title: string;
}

const COMMANDS: readonly Cmd[] = [
  { id: 'file.export', group: 'File', title: 'Export…' },
  { id: 'file.clear', group: 'File', title: 'Clear Canvas' },
  { id: 'edit.undo', group: 'Edit', title: 'Undo' },
  { id: 'edit.redo', group: 'Edit', title: 'Redo' },
  { id: 'view.zoomIn', group: 'View', title: 'Zoom In' },
  { id: 'view.zoomFit', group: 'View', title: 'Fit to Screen' },
  { id: 'tool.pencil', group: 'Tools', title: 'Tool: Pencil' },
  { id: 'tool.eraser', group: 'Tools', title: 'Tool: Eraser' },
  { id: 'help.shortcuts', group: 'Help', title: 'Keyboard Shortcuts' },
];

const text = (c: Cmd): string => `${c.group} ${c.title}`;

describe('U-012 held-out acceptance — command palette fuzzy search', () => {
  it('typing "export" ranks the Export command first', () => {
    const ranked = fuzzyRank('export', COMMANDS, text);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].item.id).toBe('file.export');
  });

  it('a fuzzy subsequence ("fit") ranks Fit to Screen first', () => {
    const ranked = fuzzyRank('fit', COMMANDS, text);
    expect(ranked[0].item.id).toBe('view.zoomFit');
  });

  it('acronym-style query narrows to the intended tool', () => {
    const ranked = fuzzyRank('pencil', COMMANDS, text);
    expect(ranked[0].item.id).toBe('tool.pencil');
  });

  it('a non-matching query returns no commands (palette shows empty state)', () => {
    const ranked = fuzzyRank('zzqqxx', COMMANDS, text);
    expect(ranked.length).toBe(0);
  });

  it('an empty query preserves the full command list in order', () => {
    const ranked = fuzzyRank('', COMMANDS, text);
    expect(ranked.map((r) => r.item.id)).toEqual(COMMANDS.map((c) => c.id));
  });
});
