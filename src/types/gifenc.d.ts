/**
 * Ambient type declarations for `gifenc` (mattdesl/gifenc v1) — the library ships
 * no `.d.ts`. Only the surface PixelForge uses is declared. gifenc is pure JS
 * (no DOM), so it is safe to import from the pure engine (`src/core`) and from a
 * Web Worker alike.
 *
 * `delay` is milliseconds (gifenc rounds to GIF centisecond resolution).
 * `repeat`: `0` = loop forever (default), `-1` = play once, `n > 0` = n repeats;
 * honored only on the first frame's `writeFrame`.
 */
declare module 'gifenc' {
  /** A palette color: `[r,g,b]` or `[r,g,b,a]`, each channel 0–255. */
  export type GifencColor = number[];
  /** A palette is an ordered list of colors (≤ maxColors entries). */
  export type GifencPalette = GifencColor[];

  /** Pixel format used by {@link quantize}/{@link applyPalette}. */
  export type GifencFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    readonly format?: GifencFormat;
    /** Snap alpha to 0x00/0xFF; a number sets a custom threshold. */
    readonly oneBitAlpha?: boolean | number;
    readonly clearAlpha?: boolean;
    readonly clearAlphaThreshold?: number;
    readonly clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray | number[],
    maxColors: number,
    options?: QuantizeOptions,
  ): GifencPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray | number[],
    palette: GifencPalette,
    format?: GifencFormat,
  ): Uint8Array;

  export interface WriteFrameOptions {
    readonly palette?: GifencPalette;
    readonly first?: boolean;
    readonly transparent?: boolean;
    readonly transparentIndex?: number;
    readonly delay?: number;
    readonly repeat?: number;
    readonly dispose?: number;
    readonly colorDepth?: number;
  }

  export interface GifencEncoder {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
    writeHeader(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export interface GifencEncoderOptions {
    readonly auto?: boolean;
    readonly initialCapacity?: number;
  }

  export function GIFEncoder(options?: GifencEncoderOptions): GifencEncoder;
}
