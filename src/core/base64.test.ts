import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

/** Deterministic pseudo-random byte fill (no Math.random → reproducible). */
function fill(len: number, seed: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = seed >>> 0;
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

describe('base64 codec', () => {
  it('matches known RFC 4648 vectors', () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('round-trips every single byte value across all tail lengths', () => {
    for (let len = 0; len <= 9; len++) {
      const bytes = fill(len, len * 97 + 3);
      const decoded = base64ToBytes(bytesToBase64(bytes));
      expect(decoded).not.toBeNull();
      expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(bytes));
    }
  });

  it('round-trips a large buffer of all 256 byte values', () => {
    const bytes = new Uint8Array(256 * 4);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i & 0xff;
    }
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(bytes));
  });

  it('encodes a run of zeros compactly (no ",0" number-array runs)', () => {
    const s = bytesToBase64(new Uint8Array(60)); // 60 % 3 === 0 → no padding
    expect(s).toBe('A'.repeat(80)); // every zero byte → 'A', 4 chars per 3 bytes
    expect(s).not.toContain(',');
    // 60 zero bytes as a JSON number array would be "0,0,0,..." ~120 chars.
    expect(s.length).toBeLessThan(60 * 2);
    expect(base64ToBytes(s)).toEqual(new Uint8Array(60));
  });

  it('accepts a Uint8ClampedArray directly', () => {
    const clamped = new Uint8ClampedArray([1, 2, 3, 250, 251, 252]);
    const decoded = base64ToBytes(bytesToBase64(clamped));
    expect(Array.from(decoded as Uint8Array)).toEqual([1, 2, 3, 250, 251, 252]);
  });

  it('ignores embedded whitespace when decoding', () => {
    const s = bytesToBase64(new TextEncoder().encode('foobar'));
    const spaced = `${s.slice(0, 4)}\n  ${s.slice(4)}`;
    const decoded = base64ToBytes(spaced);
    expect(new TextDecoder().decode(decoded as Uint8Array)).toBe('foobar');
  });

  it('rejects malformed input without throwing', () => {
    expect(base64ToBytes('!!!!')).toBeNull(); // non-alphabet
    expect(base64ToBytes('Zg=Z')).toBeNull(); // data after padding
    expect(base64ToBytes('Zm9vYg=A')).toBeNull(); // data after padding
    expect(base64ToBytes('A')).toBeNull(); // remainder of 1 is impossible
    expect(base64ToBytes('=====')).toBeNull(); // too much padding
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard on a non-string.
    expect(base64ToBytes(123 as any)).toBeNull();
  });
});
