import { describe, expect, it } from 'vitest';
import { createBuffer, getPixel, setPixel } from '../../core/buffer';
import { scaleToCanvas } from '../../core/exporters/png';
import type { PixelBuffer, RGBA } from '../../core/types';
import { bufferToPngBlob, bufferToSvgBlob } from './encode';

// Real Chromium via Vitest Browser Mode (`npm run test:browser`). Automates the
// U-009 "PNG (Browser Mode)" + "Effect-free" acceptance items: nearest-neighbor
// scale dims, exact block mapping, no intermediate colors, transparent/matte
// PNG round-trip, and proof that exports read the buffer (never the screen).

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const GREEN: RGBA = [0, 128, 0, 255];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function distinctBuffer(): PixelBuffer {
  let b = createBuffer(3, 2);
  b = setPixel(b, 0, 0, RED);
  b = setPixel(b, 1, 0, BLUE);
  b = setPixel(b, 2, 0, GREEN);
  b = setPixel(b, 0, 1, [10, 20, 30, 255]);
  b = setPixel(b, 1, 1, [200, 100, 50, 255]);
  // (2,1) stays fully transparent.
  return b;
}

function offscreenData(canvas: OffscreenCanvas): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no offscreen 2d context');
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function pixelOf(img: ImageData, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function colorSet(img: ImageData): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) {
    set.add(
      ((img.data[i] * 256 + img.data[i + 1]) * 256 + img.data[i + 2]) * 256 + img.data[i + 3],
    );
  }
  return set;
}

async function decodePng(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no 2d context');
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

describe('scaleToCanvas — nearest-neighbor in a real canvas', () => {
  it('produces exact scale×scale blocks and NO new colors for scales 1,2,4,8', () => {
    const src = distinctBuffer();
    for (const scale of [1, 2, 4, 8]) {
      const canvas = scaleToCanvas(src, scale);
      expect(canvas.width).toBe(src.w * scale);
      expect(canvas.height).toBe(src.h * scale);
      const img = offscreenData(canvas);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const expected = getPixel(src, Math.floor(x / scale), Math.floor(y / scale));
          expect(pixelOf(img, x, y)).toEqual(expected);
        }
      }
      // Compare against the source's own color set (read via a 1× canvas).
      const srcImg = offscreenData(scaleToCanvas(src, 1));
      expect(colorSet(img)).toEqual(colorSet(srcImg));
    }
  });

  it('scales a 512×512 buffer to a 2048×2048 canvas at 4× (max canvas)', () => {
    const canvas = scaleToCanvas(createBuffer(512, 512), 4);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
  });
});

describe('bufferToPngBlob — encode & decode', () => {
  it('emits a valid PNG whose pixels equal the source (transparent, effect-free)', async () => {
    const src = distinctBuffer();
    const blob = await bufferToPngBlob(src, { scale: 4 });
    expect(blob.type).toBe('image/png');
    const head = [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())];
    expect(head).toEqual(PNG_SIGNATURE);

    const img = await decodePng(blob);
    expect(img.width).toBe(12);
    expect(img.height).toBe(8);
    // Every decoded pixel maps back to its source block — no checkerboard leak.
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        expect(pixelOf(img, x, y)).toEqual(getPixel(src, Math.floor(x / 4), Math.floor(y / 4)));
      }
    }
    // The transparent source pixel stays transparent (alpha 0), not grey checker.
    expect(pixelOf(img, 10, 6)[3]).toBe(0);
  });

  it('flattens onto a matte, making formerly-transparent pixels opaque', async () => {
    const src = setPixel(createBuffer(2, 2), 0, 0, RED);
    const white: RGBA = [255, 255, 255, 255];
    const img = await decodePng(await bufferToPngBlob(src, { scale: 3, matte: white }));
    expect(pixelOf(img, 0, 0)).toEqual(RED); // drawn pixel unchanged
    expect(pixelOf(img, 5, 5)).toEqual(white); // transparent → matte, fully opaque
  });

  it('is byte-identical regardless of CRT display state (reads buffer, not screen)', async () => {
    const src = distinctBuffer();
    const root = document.documentElement;
    const before = root.getAttribute('data-crt');

    root.setAttribute('data-crt', 'full');
    const withCrt = new Uint8Array(await (await bufferToPngBlob(src, { scale: 4 })).arrayBuffer());
    root.setAttribute('data-crt', 'off');
    const noCrt = new Uint8Array(await (await bufferToPngBlob(src, { scale: 4 })).arrayBuffer());

    if (before === null) {
      root.removeAttribute('data-crt');
    } else {
      root.setAttribute('data-crt', before);
    }
    expect([...withCrt]).toEqual([...noCrt]);
  });
});

describe('bufferToSvgBlob — valid, parseable vector', () => {
  it('produces an svg blob that parses with the art viewBox and crispEdges', async () => {
    const svg = await bufferToSvgBlob(setPixel(createBuffer(4, 4), 1, 1, RED)).text();
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName.toLowerCase()).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 4 4');
    expect(root.getAttribute('shape-rendering')).toBe('crispEdges');
  });
});
