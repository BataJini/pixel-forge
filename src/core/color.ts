/**
 * src/core/color.ts — lossless hex <-> RGBA conversion at the UI/import boundary.
 *
 * PURE and deterministic (no DOM). `hexToRgba` throws on malformed input
 * (programmer error); `tryHexToRgba` returns the client-only result envelope for
 * untrusted input (imports, pasted values). Round-trip is exact for 8-bit colors.
 */
import { err, ok, type Result, type RGBA } from './types';

const HEX_BODY = /^[0-9a-fA-F]+$/;
const CHANNEL_MAX = 255;

function clampChannel(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  const r = Math.round(n);
  if (r < 0) {
    return 0;
  }
  if (r > CHANNEL_MAX) {
    return CHANNEL_MAX;
  }
  return r;
}

function toHexByte(n: number): string {
  return clampChannel(n).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Parse a `#RGB`, `#RRGGBB`, or `#RRGGBBAA` string to RGBA (alpha defaults to
 * 255). Returns a result envelope; never throws. Whitespace is trimmed.
 */
export function tryHexToRgba(hex: string): Result<RGBA> {
  if (typeof hex !== 'string') {
    return err('COLOR_INVALID', 'Expected a hex color string.');
  }
  const trimmed = hex.trim();
  if (trimmed.length === 0 || trimmed[0] !== '#') {
    return err('COLOR_INVALID', `Hex color must start with '#': "${hex}".`);
  }
  const body = trimmed.slice(1);
  if (!HEX_BODY.test(body)) {
    return err('COLOR_INVALID', `Hex color has non-hex digits: "${hex}".`);
  }
  if (body.length === 3) {
    const r = Number.parseInt(body[0] + body[0], 16);
    const g = Number.parseInt(body[1] + body[1], 16);
    const b = Number.parseInt(body[2] + body[2], 16);
    return ok([r, g, b, CHANNEL_MAX]);
  }
  if (body.length === 6 || body.length === 8) {
    const r = Number.parseInt(body.slice(0, 2), 16);
    const g = Number.parseInt(body.slice(2, 4), 16);
    const b = Number.parseInt(body.slice(4, 6), 16);
    const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) : CHANNEL_MAX;
    return ok([r, g, b, a]);
  }
  return err('COLOR_INVALID', `Hex color must be #RGB, #RRGGBB, or #RRGGBBAA: "${hex}".`);
}

/**
 * Parse hex to RGBA, throwing on malformed input. Use at trusted call sites
 * (constants, tests); use `tryHexToRgba` for anything external.
 */
export function hexToRgba(hex: string): RGBA {
  const result = tryHexToRgba(hex);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Format RGBA as an uppercase `#RRGGBB` (or `#RRGGBBAA` when `withAlpha`).
 * Channels are clamped to 0–255 and rounded. Inverse of `hexToRgba`.
 */
export function rgbaToHex(c: RGBA, withAlpha = false): string {
  const base = `#${toHexByte(c[0])}${toHexByte(c[1])}${toHexByte(c[2])}`;
  return withAlpha ? `${base}${toHexByte(c[3])}` : base;
}
