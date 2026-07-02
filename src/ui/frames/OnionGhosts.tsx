import { useEffect, useRef } from 'react';
import type { OnionGhost } from '../../core/frames';
import type { PixelBuffer, RGBA } from '../../core/types';

/** Theme-independent, functional ghost tints (like the checkerboard): previous
 * frames read warm/red (the past), next frames cool/blue (the future). §3.5. */
const WARM: RGBA = [255, 74, 42, 255];
const COOL: RGBA = [42, 140, 220, 255];
const TINT_STRENGTH = 0.55;

export interface OnionGhostsProps {
  readonly ghosts: readonly OnionGhost[];
  /** Resolve a frame to its composited pixels (cached upstream for perf). */
  readonly getComposite: (frame: OnionGhost['frame']) => PixelBuffer;
  readonly w: number;
  readonly h: number;
  /** Bumps when any source pixels change, forcing a redraw. */
  readonly version: number;
  readonly className?: string;
}

/** Build tinted RGBA bytes for one ghost: opaque pixels blend toward `tint`, alpha
 * preserved (opacity is applied at draw time via globalAlpha). Pure; new array. */
function tintBytes(buffer: PixelBuffer, tint: RGBA): Uint8ClampedArray<ArrayBuffer> {
  const src = buffer.data;
  const out = new Uint8ClampedArray(src.length);
  const k = TINT_STRENGTH;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a === 0) {
      continue; // leave transparent
    }
    out[i] = Math.round(src[i] * (1 - k) + tint[0] * k);
    out[i + 1] = Math.round(src[i + 1] * (1 - k) + tint[1] * k);
    out[i + 2] = Math.round(src[i + 2] * (1 - k) + tint[2] * k);
    out[i + 3] = a;
  }
  return out;
}

/**
 * Renders onion-skin ghosts (previous = warm, next = cool) at reduced opacity onto a
 * single native-resolution canvas that CSS scales up with `image-rendering:
 * pixelated`. Each ghost is tinted then blitted with its falloff opacity; nearer
 * ghosts paint on top (the `ghosts` array is pre-ordered farthest→nearest per side).
 * This is a DISPLAY-only aid — it never touches pixel buffers and never exports.
 */
export function OnionGhosts({ ghosts, getComposite, w, h, version, className }: OnionGhostsProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` forces a redraw when any source frame's pixels change in place (same buffer reference).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    if (w <= 0 || h <= 0 || ghosts.length === 0) {
      return;
    }
    if (!scratchRef.current) {
      scratchRef.current = document.createElement('canvas');
    }
    const scratch = scratchRef.current;
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext('2d');
    if (!sctx) {
      return;
    }
    for (const ghost of ghosts) {
      const buffer = getComposite(ghost.frame);
      if (buffer.w !== w || buffer.h !== h) {
        continue;
      }
      const bytes = tintBytes(buffer, ghost.tint === 'warm' ? WARM : COOL);
      sctx.clearRect(0, 0, w, h);
      sctx.putImageData(new ImageData(bytes, w, h), 0, 0);
      ctx.globalAlpha = Math.min(1, Math.max(0, ghost.opacity));
      ctx.drawImage(scratch, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, [ghosts, getComposite, w, h, version]);

  // Decorative overlay: an unlabeled canvas has no accessible name, so assistive tech
  // ignores it — no role/aria-hidden needed (both are flagged on this element).
  return <canvas ref={ref} className={className} style={{ imageRendering: 'pixelated' }} />;
}
