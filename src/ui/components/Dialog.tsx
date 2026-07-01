import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from '../lib/cx';
import './dialog.css';

export interface DialogProps {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly onClose: () => void;
  /** Footer actions (buttons), right-aligned. */
  readonly actions?: ReactNode;
  /** Close when the backdrop is clicked (default true). */
  readonly closeOnBackdrop?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

/**
 * Modal dialog built on the native `<dialog>` element for free focus-trapping,
 * top-layer stacking, `::backdrop`, and Esc handling. `showModal()`/`close()`
 * are guarded against the "already open"/"not open" throw. Title is Press Start
 * 2P; the frame is a hard bevel with an offset drop-shadow; the backdrop is a
 * dither veil (never a soft gradient).
 */
export function Dialog({
  open,
  title,
  onClose,
  actions,
  closeOnBackdrop = true,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const handleCancel = (event: Event) => {
      // Route the native Esc/cancel through our controlled onClose.
      event.preventDefault();
      onClose();
    };
    node.addEventListener('cancel', handleCancel);
    return () => node.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (closeOnBackdrop && event.target === ref.current) {
      onClose();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is pointer-only; keyboard dismissal is handled by the native <dialog> Esc/cancel event wired to onClose.
    <dialog
      ref={ref}
      className={cx('pf-dialog', className)}
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      <div className="pf-dialog__frame">
        <header className="pf-dialog__header">
          <h2 id={titleId} className="pf-dialog__title pf-display pf-display-sm">
            {title}
          </h2>
          <button
            type="button"
            className="pf-dialog__close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="pf-dialog__body">{children}</div>
        {actions !== undefined && <footer className="pf-dialog__actions">{actions}</footer>}
      </div>
    </dialog>
  );
}
