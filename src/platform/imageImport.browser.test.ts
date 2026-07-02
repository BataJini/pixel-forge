import { describe, expect, it } from 'vitest';
import { getPixel } from '../core/buffer';
import { decodeImageFile } from './imageImport';

const RED: [number, number, number, number] = [255, 0, 0, 255];

/** Render a solid + single-pixel test PNG File of the given size. */
async function pngFile(w: number, h: number, paint = false): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  if (paint) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('no ctx');
    }
    ctx.fillStyle = 'rgba(255,0,0,1)';
    ctx.fillRect(1, 1, 1, 1);
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) {
    throw new Error('toBlob failed');
  }
  return new File([blob], 'img.png', { type: 'image/png' });
}

describe('decodeImageFile — real browser', () => {
  it('decodes a valid PNG into a pixel buffer of matching size', async () => {
    const res = await decodeImageFile(await pngFile(4, 4, true));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.w).toBe(4);
    expect(res.value.h).toBe(4);
    expect(getPixel(res.value, 1, 1)).toEqual(RED);
  });

  it('rejects an image over the 512 cap with a friendly, actionable message', async () => {
    const res = await decodeImageFile(await pngFile(600, 2));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('IMAGE_TOO_LARGE');
    expect(res.error.message).toMatch(/512/);
  });

  it('rejects a non-image file without throwing', async () => {
    const res = await decodeImageFile(new File(['not an image'], 'x.png', { type: 'image/png' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('IMAGE_DECODE');
  });

  it('rejects an empty file', async () => {
    const res = await decodeImageFile(new File([], 'x.png', { type: 'image/png' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('IMAGE_EMPTY');
  });
});
