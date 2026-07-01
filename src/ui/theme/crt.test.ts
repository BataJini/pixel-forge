import { describe, expect, it } from 'vitest';
import { CRT_LEVELS, DEFAULT_CRT_LEVEL, effectiveCrtLevel, isCrtLevel } from './crt';

describe('CRT level model', () => {
  it('offers exactly Off / Subtle / Full', () => {
    expect(CRT_LEVELS).toEqual(['off', 'subtle', 'full']);
  });

  it('defaults to Subtle (Arcade CRT hero vibe)', () => {
    expect(DEFAULT_CRT_LEVEL).toBe('subtle');
  });

  it('guards untrusted values', () => {
    expect(isCrtLevel('subtle')).toBe(true);
    expect(isCrtLevel('full')).toBe(true);
    expect(isCrtLevel('ultra')).toBe(false);
    expect(isCrtLevel(null)).toBe(false);
  });

  it('clean mode forces Off without discarding the chosen level', () => {
    expect(effectiveCrtLevel('full', false)).toBe('full');
    expect(effectiveCrtLevel('full', true)).toBe('off');
    expect(effectiveCrtLevel('subtle', true)).toBe('off');
  });
});
