import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_DIM, validateImageDimensions } from './imageImport';

describe('validateImageDimensions', () => {
  it('accepts sizes within the 1..512 cap', () => {
    expect(validateImageDimensions(1, 1).ok).toBe(true);
    expect(validateImageDimensions(512, 512).ok).toBe(true);
    expect(validateImageDimensions(32, 200).ok).toBe(true);
  });

  it('rejects an oversize image with a friendly, actionable message', () => {
    const r = validateImageDimensions(513, 400);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('IMAGE_TOO_LARGE');
    expect(r.error.message).toContain(String(MAX_IMPORT_DIM));
  });

  it('rejects both dimensions over the cap', () => {
    expect(validateImageDimensions(1000, 1000).ok).toBe(false);
    expect(validateImageDimensions(100, 999).ok).toBe(false);
  });

  it('rejects empty or non-integer dimensions', () => {
    expect(validateImageDimensions(0, 10).ok).toBe(false);
    expect(validateImageDimensions(10, 0).ok).toBe(false);
    expect(validateImageDimensions(-4, 4).ok).toBe(false);
    expect(validateImageDimensions(8.5, 8).ok).toBe(false);
  });
});
