import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { createBuffer, setPixelMut } from '../../core/buffer';
import { BUILTIN_PALETTE_IDS, BUILTIN_PALETTES, paletteSwap } from '../../core/palette';
import type { Palette, PixelBuffer, RGBA } from '../../core/types';

const SCALE = 8;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

// A tiny gem sprite as palette indices ('.' = transparent). Indices wrap to the
// active palette length so any built-in (even the 4-color Game Boy) reads well.
const SPRITE = [
  '............',
  '....1111....',
  '...122221...',
  '..12333321..',
  '.1233333321.',
  '.1233443321.',
  '.1233443321.',
  '.1233333321.',
  '.1223333221.',
  '..12222221..',
  '...112211...',
  '............',
];

function seedSprite(palette: Palette): PixelBuffer {
  const h = SPRITE.length;
  const w = SPRITE[0].length;
  const buf = createBuffer(w, h);
  const n = palette.colors.length || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = SPRITE[y][x];
      if (ch === '.') {
        continue;
      }
      const idx = Number.parseInt(ch, 10) % n;
      setPixelMut(buf, x, y, palette.colors[idx] ?? TRANSPARENT);
    }
  }
  return buf;
}

function drawBufferScaled(canvas: HTMLCanvasElement, buf: PixelBuffer, scale: number): void {
  if (typeof document === 'undefined') {
    return;
  }
  canvas.width = buf.w * scale;
  canvas.height = buf.h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const off = document.createElement('canvas');
  off.width = buf.w;
  off.height = buf.h;
  const octx = off.getContext('2d');
  if (!octx) {
    return;
  }
  const img = octx.createImageData(buf.w, buf.h);
  img.data.set(buf.data);
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

export interface PaletteSwapPreviewProps {
  readonly palette: Palette;
}

/**
 * A live preview of the indexed-mode killer feature: a small sprite is drawn from
 * the active palette, and `paletteSwap` (the pure engine op) recolors it by index
 * into a chosen target palette. Proves "a pixel drawn with index i becomes the
 * new color at index i after the swap".
 */
export function PaletteSwapPreview({ palette }: PaletteSwapPreviewProps) {
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const selectId = useId();
  const [targetId, setTargetId] = useState<string>(palette.id === 'gameboy' ? 'pico8' : 'gameboy');

  useEffect(() => {
    const seed = seedSprite(palette);
    if (beforeRef.current) {
      drawBufferScaled(beforeRef.current, seed, SCALE);
    }
    const target = BUILTIN_PALETTES[targetId as keyof typeof BUILTIN_PALETTES] ?? palette;
    if (afterRef.current) {
      drawBufferScaled(afterRef.current, paletteSwap(seed, palette, target), SCALE);
    }
  }, [palette, targetId]);

  const onTarget = (e: ChangeEvent<HTMLSelectElement>): void => setTargetId(e.target.value);

  return (
    <div className="pf-swap">
      <div className="pf-swap__row">
        <label className="pf-label" htmlFor={selectId}>
          Palette-swap →
        </label>
        <select id={selectId} className="pf-select" value={targetId} onChange={onTarget}>
          {BUILTIN_PALETTE_IDS.map((id) => (
            <option key={id} value={id}>
              {BUILTIN_PALETTES[id].name}
            </option>
          ))}
        </select>
      </div>
      <div className="pf-swap__panes">
        <figure className="pf-swap__pane">
          <canvas ref={beforeRef} className="pf-swap__canvas pf-checker" />
          <figcaption className="pf-readout">{palette.name}</figcaption>
        </figure>
        <span className="pf-swap__arrow" aria-hidden="true">
          →
        </span>
        <figure className="pf-swap__pane">
          <canvas ref={afterRef} className="pf-swap__canvas pf-checker" />
          <figcaption className="pf-readout">recolored by index</figcaption>
        </figure>
      </div>
    </div>
  );
}
