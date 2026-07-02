/**
 * src/core/base64.ts — a PURE, dependency-free Base64 codec for raw bytes.
 *
 * The `.forge` project format stores each layer's pixels as Base64 of the raw
 * RGBA `Uint8ClampedArray` (master-spec §4.3) — never a JSON number array, which
 * would balloon a transparent 512² layer to megabytes of `,0`. This codec is
 * hand-rolled (no `btoa`/`atob`/`Buffer`) so `src/core` stays pure and
 * deterministic with no DOM/global dependency (constitution: determinism &
 * purity) and round-trips every byte losslessly.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = '=';

/** Reverse lookup: char code → 6-bit value, or -1 for a non-alphabet char. */
const DECODE = /* @__PURE__ */ (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Encode raw bytes to a standard Base64 string (`+`/`/` alphabet, `=` padding).
 * Deterministic and total: any `Uint8Array`/`Uint8ClampedArray` is accepted.
 */
export function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  const len = bytes.length;
  let out = '';
  let i = 0;
  // Full 3-byte groups → 4 chars.
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  // Tail: 1 or 2 remaining bytes.
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + PAD + PAD;
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + PAD;
  }
  return out;
}

/**
 * Decode a Base64 string to a `Uint8Array`, or `null` when the input is not
 * valid Base64. Whitespace is ignored; any other non-alphabet character (or a
 * malformed length) fails cleanly to `null` so callers stay on the result
 * envelope instead of throwing on untrusted `.forge`/imported data.
 */
export function base64ToBytes(text: string): Uint8Array | null {
  if (typeof text !== 'string') {
    return null;
  }
  // Collect 6-bit symbols, tolerating whitespace, tracking padding.
  const symbols: number[] = [];
  let pad = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      continue; // ignore spaces/tabs/newlines
    }
    if (code === 0x3d) {
      pad += 1; // '='
      continue;
    }
    if (pad > 0) {
      return null; // data after padding is malformed
    }
    const value = code < 128 ? DECODE[code] : -1;
    if (value < 0) {
      return null;
    }
    symbols.push(value);
  }
  if (pad > 2) {
    return null;
  }
  // Each 4 symbols → 3 bytes; the symbol count mod 4 must be 0 (with padding) or
  // 2/3 (a bare tail). A remainder of 1 is impossible in valid Base64.
  const rem = symbols.length % 4;
  if (rem === 1) {
    return null;
  }
  const fullGroups = Math.floor(symbols.length / 4);
  let outLen = fullGroups * 3;
  if (rem === 2) {
    outLen += 1;
  } else if (rem === 3) {
    outLen += 2;
  }
  const out = new Uint8Array(outLen);
  let o = 0;
  let s = 0;
  for (let g = 0; g < fullGroups; g++) {
    const n = (symbols[s] << 18) | (symbols[s + 1] << 12) | (symbols[s + 2] << 6) | symbols[s + 3];
    out[o] = (n >> 16) & 0xff;
    out[o + 1] = (n >> 8) & 0xff;
    out[o + 2] = n & 0xff;
    s += 4;
    o += 3;
  }
  if (rem === 2) {
    const n = (symbols[s] << 18) | (symbols[s + 1] << 12);
    out[o] = (n >> 16) & 0xff;
  } else if (rem === 3) {
    const n = (symbols[s] << 18) | (symbols[s + 1] << 12) | (symbols[s + 2] << 6);
    out[o] = (n >> 16) & 0xff;
    out[o + 1] = (n >> 8) & 0xff;
  }
  return out;
}
