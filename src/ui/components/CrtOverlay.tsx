import '../../styles/crt.css';
import type { CrtLevel } from '../theme/crt';

export interface CrtOverlayProps {
  readonly level: CrtLevel;
}

/**
 * The CRT display layer — a real, always-mounted, non-interactive overlay
 * composited ABOVE all content (`position: fixed`, `pointer-events: none`,
 * `aria-hidden`). It never intercepts input, never enters the a11y tree, and
 * never changes content DOM geometry (U-002 criterion 6). `level` drives the
 * scanlines / glow / vignette / flicker / sweep via CSS in crt.css; the element
 * stays mounted at every level (Off just hides its sub-layers) so toggling can
 * never reflow the page. It touches no pixel buffer and appears in no export.
 */
export function CrtOverlay({ level }: CrtOverlayProps) {
  return (
    <div className="pf-crt" data-level={level} aria-hidden="true" data-testid="crt-overlay">
      <div className="pf-crt__layer pf-crt__scanlines" />
      <div className="pf-crt__layer pf-crt__glow" />
      <div className="pf-crt__layer pf-crt__vignette" />
      <div className="pf-crt__layer pf-crt__sweep" />
    </div>
  );
}
