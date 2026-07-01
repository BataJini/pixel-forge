import { Frame } from '../components/Frame';

/**
 * The signature moment: the "anvil well" — a recessed canvas well over the
 * theme-independent transparency checkerboard, framed by the carved pixel frame,
 * with a purpose-drawn pixel anvil + a spark that glows the active theme accent.
 * This is chrome/empty-state art; the real user canvas (U-003) is never tinted
 * by theme colors. Rendered crisp via shape-rendering="crispEdges".
 */
export function AnvilPreview() {
  return (
    <Frame className="pf-anvil">
      <div className="pf-anvil__well">
        <svg
          className="pf-anvil__art"
          viewBox="0 0 32 24"
          width={192}
          height={144}
          shapeRendering="crispEdges"
          role="img"
          aria-label="An anvil with a glowing spark — PixelForge"
        >
          {/* Anvil body (steel) */}
          <rect x="7" y="14" width="18" height="3" fill="var(--c-steel)" />
          <rect x="9" y="17" width="14" height="2" fill="var(--c-ash)" />
          <rect x="13" y="19" width="6" height="3" fill="var(--c-steel)" />
          <rect x="5" y="13" width="6" height="1" fill="var(--c-steel)" />
          <rect x="4" y="12" width="3" height="1" fill="var(--c-ash)" />
          {/* Hot ingot on the face (theme accent) */}
          <rect x="15" y="11" width="4" height="3" fill="var(--c-ember)" />
          <rect x="16" y="10" width="2" height="1" fill="var(--c-flame)" />
          {/* Sparks flying (spark → flame) */}
          <rect x="18" y="6" width="2" height="2" fill="var(--c-spark)" />
          <rect x="21" y="4" width="1" height="1" fill="var(--c-flame)" />
          <rect x="14" y="5" width="1" height="1" fill="var(--c-flame)" />
        </svg>
      </div>
    </Frame>
  );
}
