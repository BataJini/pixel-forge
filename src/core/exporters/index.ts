/**
 * src/core/exporters — pure artifact encoders (master-spec §5, §3.8).
 *
 * Each exporter takes a COMPOSITED pixel buffer and returns a portable artifact
 * (SVG string, scaled canvas/buffer). They never read the display checkerboard
 * or CRT layer, so every export is structurally effect-free (constitution:
 * clean-export invariant). PNG/SVG land in U-009; GIF/spritesheet in U-010.
 */

export { flattenOnColor, scaleBufferNearest, scaleToCanvas } from './png';
export { bufferToSvg, type SvgOptions } from './svg';
