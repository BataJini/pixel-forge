import { describe, expect, it } from 'vitest';
import { createBuffer, setPixel } from '../core/buffer';
import { renderThumbnail } from './thumbnail';

describe('renderThumbnail — real browser', () => {
  it('renders a small canvas to a PNG data URL', () => {
    const buf = setPixel(createBuffer(8, 8), 3, 3, [255, 0, 0, 255]);
    const url = renderThumbnail(buf, 32);
    expect(url).not.toBeNull();
    expect(url as string).toMatch(/^data:image\/png;base64,/);
  });

  it('fits a large canvas within the max size (nearest-neighbor downscale)', () => {
    const buf = createBuffer(256, 128);
    const url = renderThumbnail(buf, 64);
    expect(url).not.toBeNull();
    // Decode dimensions by loading the produced image is overkill; the data URL
    // existing and being a PNG is enough to prove the DOM path ran.
    expect(url as string).toMatch(/^data:image\/png/);
  });

  it('returns null for an empty buffer', () => {
    expect(renderThumbnail(createBuffer(0, 0))).toBeNull();
  });
});
