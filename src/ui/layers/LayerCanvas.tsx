import { type CSSProperties, useEffect, useRef } from 'react';
import type { PixelBuffer } from '../../core/types';

export interface LayerCanvasProps {
  /** The pixel buffer to display at its native resolution (scaled up by CSS). */
  readonly buffer: PixelBuffer;
  /** A value that changes whenever `buffer`'s pixels change, to trigger a redraw. */
  readonly version?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ariaLabel?: string;
  readonly role?: string;
}

/**
 * Draws a {@link PixelBuffer} onto a canvas at its native resolution and lets CSS
 * scale it up with `image-rendering: pixelated`, so pixels stay crisp (never
 * anti-aliased — constitution: pixel-correctness). `putImageData` writes the exact
 * RGBA, alpha included, so transparent pixels reveal the checkerboard behind the
 * canvas (the checker is CSS, never baked into the buffer — clean-export invariant).
 */
export function LayerCanvas({
  buffer,
  version,
  className,
  style,
  ariaLabel,
  role,
}: LayerCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` intentionally forces a redraw when the buffer's pixels change in place (same buffer reference, mutated during a live stroke).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    if (canvas.width !== buffer.w || canvas.height !== buffer.h) {
      canvas.width = buffer.w;
      canvas.height = buffer.h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, buffer.w, buffer.h);
    if (buffer.w > 0 && buffer.h > 0) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.w, buffer.h), 0, 0);
    }
  }, [buffer, version]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ imageRendering: 'pixelated', ...style }}
      aria-label={ariaLabel}
      role={ariaLabel ? (role ?? 'img') : role}
    />
  );
}
