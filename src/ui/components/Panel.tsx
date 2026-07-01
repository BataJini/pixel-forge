import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import './panel.css';

export type PanelTone = 'raised' | 'inset';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Optional title shown in a bevelled header bar (Silkscreen label). */
  readonly title?: ReactNode;
  /** Optional controls docked to the right of the header. */
  readonly actions?: ReactNode;
  /** `raised` = docked workbench panel; `inset` = a recessed well/groove. */
  readonly tone?: PanelTone;
  readonly children?: ReactNode;
}

/**
 * A workbench surface. `raised` panels carry the hard bevel + a non-blurred
 * offset drop-shadow (the design's floating-panel technique); `inset` panels are
 * recessed grooves (canvas well, sliders' tracks). No radius, no blur.
 */
export function Panel({
  title,
  actions,
  tone = 'raised',
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <section className={cx('pf-panel', `pf-panel--${tone}`, className)} {...rest}>
      {title !== undefined && (
        <header className="pf-panel__header pf-dither">
          <span className="pf-panel__title pf-label">{title}</span>
          {actions !== undefined && <span className="pf-panel__actions">{actions}</span>}
        </header>
      )}
      <div className="pf-panel__body">{children}</div>
    </section>
  );
}
