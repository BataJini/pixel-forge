import { useEffect, useRef } from 'react';
import './help-overlay.css';

interface HelpOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const SHORTCUTS: readonly { readonly keys: string; readonly label: string }[] = [
  { keys: 'B', label: 'Pencil' },
  { keys: 'E', label: 'Eraser' },
  { keys: 'G', label: 'Fill / bucket' },
  { keys: 'L', label: 'Line' },
  { keys: 'U', label: 'Rectangle / Ellipse' },
  { keys: 'I', label: 'Eyedropper' },
  { keys: 'M', label: 'Select' },
  { keys: 'V', label: 'Move' },
  { keys: 'H / Space', label: 'Pan' },
  { keys: 'X', label: 'Swap fg / bg colors' },
  { keys: '[  ]', label: 'Brush size − / +' },
  { keys: '+  −', label: 'Zoom in / out' },
  { keys: 'Ctrl+Z', label: 'Undo' },
  { keys: 'Ctrl+Shift+Z · Ctrl+Y', label: 'Redo' },
  { keys: 'Ctrl+A · Esc', label: 'Select all · Deselect' },
  { keys: 'Ctrl+C · X · V', label: 'Copy · Cut · Paste' },
  { keys: 'Arrows · Enter', label: 'Nudge floating selection · Stamp' },
  { keys: 'Ctrl+K', label: 'Command palette' },
  { keys: '?', label: 'This help' },
];

/** Keyboard-shortcut help overlay (U-012). Opens on `?`, closes on Escape/backdrop. */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open (a11y + so its onKeyDown receives Escape).
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => boxRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="pf-help"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="pf-help__box" ref={boxRef} tabIndex={-1}>
        <header className="pf-help__head">
          <h2 className="pf-help__title">Keyboard Shortcuts</h2>
          <button type="button" className="pf-btn" onClick={onClose} aria-label="Close help">
            Close
          </button>
        </header>
        <dl className="pf-help__grid">
          {SHORTCUTS.map((s) => (
            <div className="pf-help__row" key={`${s.keys}-${s.label}`}>
              <dt className="pf-help__keys">
                <kbd>{s.keys}</kbd>
              </dt>
              <dd className="pf-help__label">{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default HelpOverlay;
