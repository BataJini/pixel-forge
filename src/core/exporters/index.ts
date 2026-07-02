/**
 * src/core/exporters — pure artifact encoders (master-spec §5, §3.8).
 *
 * Each exporter takes a COMPOSITED pixel buffer and returns a portable artifact
 * (SVG string, scaled canvas/buffer). They never read the display checkerboard
 * or CRT layer, so every export is structurally effect-free (constitution:
 * clean-export invariant). PNG/SVG land in U-009; GIF/spritesheet in U-010.
 */

export {
  encodeGif,
  encodeGifFromFrames,
  type GifCel,
  type GifInfo,
  type GifOptions,
  parseGifInfo,
} from './gif';
export { flattenOnColor, scaleBufferNearest, scaleToCanvas } from './png';
export {
  type AtlasJsonExtra,
  atlasToJson,
  type FrameRect,
  nextPowerOfTwo,
  type PackOptions,
  type PackResult,
  packCels,
  packFrames,
  type SheetCel,
  type SpritesheetLayout,
  type SpritesheetMeta,
  scaleMeta,
  sliceCel,
} from './spritesheet';
export { bufferToSvg, type SvgOptions } from './svg';
