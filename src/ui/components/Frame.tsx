import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import './frame.css';

export interface FrameProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

/**
 * A carved pixel frame with notched corners and a hard pixel outline — the
 * design's `clip-path` notched-corner variant. Every notch edge is axis-aligned
 * so it stays crisp (zero anti-aliasing on chrome), and because the outline is
 * drawn from theme tokens the frame re-tempers with the active theme (unlike a
 * fixed-color 9-slice PNG). No radius, no blur.
 */
export function Frame({ className, children, ...rest }: FrameProps) {
  return (
    <div className={cx('pf-frame', className)} {...rest}>
      <div className="pf-frame__inner">{children}</div>
    </div>
  );
}
