import { useEffect, useMemo, useRef, useState } from 'react';
import type { PfCommand } from './commands';
import { fuzzyRank } from './fuzzy';
import './command-palette.css';

interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly PfCommand[];
  readonly onClose: () => void;
}

/**
 * Ctrl/Cmd+K command palette (master-spec §3.7). Fuzzy-filters the shared
 * command list and runs the selection, so "Export…" from here fires exactly the
 * action its menu item does. Arrow keys move, Enter runs, Escape / backdrop close.
 */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ranked = useMemo(
    () =>
      fuzzyRank(
        query,
        commands.filter((c) => !c.disabled),
        (c) => `${c.group} ${c.title}`,
      ),
    [query, commands],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, ranked.length - 1)));
  }, [ranked.length]);

  if (!open) {
    return null;
  }

  const run = (cmd: PfCommand | undefined): void => {
    if (!cmd) {
      return;
    }
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, ranked.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(ranked[active]?.item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="pf-cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="pf-cmdk__box">
        <input
          ref={inputRef}
          className="pf-cmdk__input"
          type="text"
          placeholder="Type a command…"
          aria-label="Search commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="pf-cmdk__list" role="listbox" aria-label="Commands">
          {ranked.length === 0 && <div className="pf-cmdk__empty">No matching command</div>}
          {ranked.map(({ item }, i) => (
            <div
              key={item.id}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={`pf-cmdk__item${i === active ? ' is-active' : ''}`}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(item);
              }}
            >
              <span className="pf-cmdk__group">{item.group}</span>
              <span className="pf-cmdk__title">{item.title}</span>
              {item.shortcut && <kbd className="pf-cmdk__kbd">{item.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
