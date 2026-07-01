import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import './button.css';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Marks a toggle/tool button as the active one — it glows the accent (Ember). */
  readonly active?: boolean;
  readonly children?: ReactNode;
}

/**
 * Bevelled push-button. Raised outset bevel → on `:active`/press it swaps to the
 * inset bevel and translates by `--px` (physical press). Hard-edged, no radius,
 * no blur; hover/focus/active states are all deliberately designed. `type`
 * defaults to `button` so it never submits a form by accident.
 */
export function Button({
  variant = 'default',
  size = 'md',
  active = false,
  type,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx('pf-btn', `pf-btn--${variant}`, `pf-btn--${size}`, className)}
      data-active={active ? 'true' : undefined}
      {...rest}
    >
      <span className="pf-btn__label">{children}</span>
    </button>
  );
}
