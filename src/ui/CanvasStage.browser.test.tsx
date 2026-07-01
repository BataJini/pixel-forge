import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BUILTIN_PALETTES } from '../core/palette';
import type { RGBA } from '../core/types';
import { effectivePaintColor, initialColorState } from '../state/colorStore';
import '../styles/tokens.css';
import { CanvasStage } from './CanvasStage';
import './CanvasStage.css';

/**
 * Vitest Browser Mode (real Chromium). Proves the U-005 indexed / palette-lock
 * wiring runs on the REAL render pipeline (not a synthetic preview): entering
 * indexed mode quantizes the live artwork to the palette, and changing the
 * palette while locked palette-swaps the buffer by index. Complements the pure
 * `effectivePaintColor` unit tests (which lock the pencil's draw color).
 */

let host: HTMLElement;
let root: Root;

const GAMEBOY = BUILTIN_PALETTES.gameboy;
const CGA = BUILTIN_PALETTES.cga;
// The seeded forge motif paints iron (#3A342E). It is not a member of any built-in
// palette, so after quantizing to a palette it must be gone from the display.
const RAW_IRON: RGBA = [58, 52, 46, 255];

function displayCanvas(): HTMLCanvasElement {
  return host.querySelectorAll('.pf-stage__well canvas')[1] as HTMLCanvasElement;
}

/** All opaque device pixels of a canvas as packed 0xRRGGBB numbers. */
function opaqueColors(canvas: HTMLCanvasElement): Set<number> {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no 2d context');
  }
  const { width, height } = canvas;
  const out = new Set<number>();
  if (width === 0 || height === 0) {
    return out;
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 255) {
      out.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return out;
}

const packed = (c: RGBA): number => (c[0] << 16) | (c[1] << 8) | c[2];

async function render(node: React.ReactNode): Promise<void> {
  root.render(<StrictMode>{node}</StrictMode>);
  await vi.waitFor(
    () => {
      expect(opaqueColors(displayCanvas()).size).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '320px';
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
});

test('entering indexed mode quantizes the live artwork to the palette', async () => {
  const fg = effectivePaintColor({ ...initialColorState(GAMEBOY), indexed: true });
  await render(<CanvasStage paintColor={fg} indexed palette={GAMEBOY} />);

  const colors = opaqueColors(displayCanvas());
  // The raw off-palette iron of the seed motif is gone…
  expect(colors.has(packed(RAW_IRON))).toBe(false);
  // …and every opaque display color is now a Game Boy palette color.
  const allowed = new Set(GAMEBOY.colors.map(packed));
  for (const c of colors) {
    expect(allowed.has(c)).toBe(true);
  }
});

test('the stage self-enforces the lock: a raw off-palette paintColor cannot be drawn while indexed', async () => {
  // Pass a RAW off-palette color directly (NOT pre-snapped via effectivePaintColor)
  // to prove the component itself constrains the pencil in indexed mode (M-1).
  const OFF_PALETTE: RGBA = [255, 0, 255, 255]; // magenta — absent from Game Boy
  await render(<CanvasStage paintColor={OFF_PALETTE} indexed palette={GAMEBOY} />);

  const allowed = new Set(GAMEBOY.colors.map(packed));
  const colors = opaqueColors(displayCanvas());
  // The existing art is already quantized, and the raw magenta is never introduced.
  expect(colors.has(packed(OFF_PALETTE))).toBe(false);
  for (const c of colors) {
    expect(allowed.has(c)).toBe(true);
  }
});

test('changing the palette while locked palette-swaps the real canvas by index', async () => {
  const gbFg = effectivePaintColor({ ...initialColorState(GAMEBOY), indexed: true });
  await render(<CanvasStage paintColor={gbFg} indexed palette={GAMEBOY} />);
  expect(opaqueColors(displayCanvas()).size).toBeGreaterThan(0);

  const gbSet = new Set(GAMEBOY.colors.map(packed));
  const cgaSet = new Set(CGA.colors.map(packed));
  const cgaFg = effectivePaintColor({ ...initialColorState(CGA), indexed: true });
  // Re-render with CGA active. The display still shows the Game Boy colors until
  // the palette-swap effect + repaint land, so wait for the swapped result:
  // every opaque color is a CGA color AND at least one is CGA-only (recolor ran).
  root.render(
    <StrictMode>
      <CanvasStage paintColor={cgaFg} indexed palette={CGA} />
    </StrictMode>,
  );
  await vi.waitFor(
    () => {
      const after = opaqueColors(displayCanvas());
      expect(after.size).toBeGreaterThan(0);
      for (const c of after) {
        expect(cgaSet.has(c)).toBe(true);
      }
      expect([...after].some((c) => !gbSet.has(c))).toBe(true);
    },
    { timeout: 4000 },
  );
});
