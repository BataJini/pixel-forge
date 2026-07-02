import { useEffect, useRef, useState } from 'react';
import type { CommandGroup, PfCommand } from './commands';
import { MENU_ORDER } from './commands';
import './menu-bar.css';

interface MenuBarProps {
  readonly commands: readonly PfCommand[];
}

/**
 * File / Edit / View / Canvas / Tools / Help menu bar (U-012). Every item is a
 * `PfCommand` shared with the palette, so no menu entry is dead. Click a label to
 * open; click outside or Escape to close.
 */
export function MenuBar({ commands }: MenuBarProps) {
  const [open, setOpen] = useState<CommandGroup | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const groups = MENU_ORDER.filter((g) => commands.some((c) => c.group === g));

  return (
    <nav className="pf-menubar" aria-label="Main menu" ref={ref}>
      {groups.map((g) => (
        <div className="pf-menubar__group" key={g}>
          <button
            type="button"
            className={`pf-menubar__label${open === g ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === g}
            onClick={() => setOpen((cur) => (cur === g ? null : g))}
          >
            {g}
          </button>
          {open === g && (
            <ul className="pf-menubar__menu" role="menu" aria-label={g}>
              {commands
                .filter((c) => c.group === g)
                .map((c) => (
                  <li key={c.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="pf-menubar__item"
                      disabled={c.disabled}
                      onClick={() => {
                        setOpen(null);
                        c.run();
                      }}
                    >
                      <span className="pf-menubar__item-title">{c.title}</span>
                      {c.shortcut && <kbd className="pf-menubar__kbd">{c.shortcut}</kbd>}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

export default MenuBar;
