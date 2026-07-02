import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createBuffer, setPixel } from '../../core/buffer';
import { makeFrame } from '../../core/frames';
import type { Frame, RGBA } from '../../core/types';
import { FrameStack } from '../../state';
import '../../styles/tokens.css';
import { ThemeProvider } from '../theme/ThemeProvider';
import { FramesProvider } from './FramesProvider';
import { TimelinePanel } from './TimelinePanel';

/**
 * Vitest Browser Mode (real Chromium). Exercises the Frames/timeline panel's DOM
 * behavior and that frame semantics reach the live preview + onion overlay: rendering
 * the strip, add/duplicate/delete (+ last-frame guard), reorder, per-frame duration,
 * add-layer-to-all-frames, onion ghost rendering + toggle, deterministic stepping,
 * live playback advancing the active frame, undo/redo, and per-frame painting — all
 * against a known 4×4 three-frame stack so assertions are exact.
 */

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 200, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const W = 4;
const H = 4;

const layer = (id: string, name: string, buffer: ReturnType<typeof createBuffer>) => ({
  id,
  name,
  visible: true,
  locked: false,
  opacity: 100,
  blend: 'normal' as const,
  buffer,
});

let host: HTMLElement;
let root: Root;
let stack: FrameStack;

function makeStack(): FrameStack {
  const frames: Frame[] = [
    makeFrame('frame-1', [layer('layer-1', 'Base', setPixel(createBuffer(W, H), 0, 0, RED))], 60),
    makeFrame('frame-2', [layer('layer-1', 'Base', setPixel(createBuffer(W, H), 1, 1, GREEN))], 60),
    makeFrame('frame-3', [layer('layer-1', 'Base', setPixel(createBuffer(W, H), 2, 2, BLUE))], 60),
  ];
  stack = new FrameStack(W, H, {
    initial: { frames, activeFrameId: 'frame-2', activeLayerId: 'layer-1', fps: 16 },
  });
  return stack;
}

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <StrictMode>
      <ThemeProvider>
        <FramesProvider createStack={makeStack}>
          <TimelinePanel standalone={false} />
        </FramesProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  await vi.waitFor(() => {
    expect(host.querySelector('.pf-frame')).not.toBeNull();
  });
}

beforeEach(async () => {
  await mount();
});

afterEach(() => {
  root?.unmount();
  host?.remove();
});

const cells = (): HTMLLIElement[] => Array.from(host.querySelectorAll<HTMLLIElement>('.pf-frame'));
const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
const byLabel = (label: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const activeIndex = (): number =>
  cells().findIndex((c) => c.getAttribute('aria-current') === 'true');
function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function pixelOf(selector: string, x: number, y: number): number[] {
  const canvas = host.querySelector(selector) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no ctx');
  }
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

describe('TimelinePanel — structure', () => {
  test('renders the three-frame strip with frame 2 active', () => {
    expect(cells()).toHaveLength(3);
    expect(activeIndex()).toBe(1);
    expect(host.querySelector('.pf-frames__status')?.textContent).toContain('3 frames');
  });

  test('selecting a frame thumbnail makes it active', async () => {
    byLabel('Select frame 1')?.click();
    await vi.waitFor(() => expect(activeIndex()).toBe(0));
  });
});

describe('TimelinePanel — add / duplicate / delete frames', () => {
  test('Add frame inserts a blank frame after the active one and activates it', async () => {
    button('Add frame')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
    // Inserted after frame 2 (index 1) → new active index 2.
    expect(stack.getActiveIndex()).toBe(2);
    expect(activeIndex()).toBe(2);
  });

  test('Duplicate copies the active frame', async () => {
    button('Duplicate')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
    // The duplicate lands right after the source and becomes active.
    expect(stack.getActiveIndex()).toBe(2);
  });

  test('Delete removes a frame and is disabled at the last one', async () => {
    button('Delete')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(2));
    button('Delete')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(1));
    expect(button('Delete')?.disabled).toBe(true); // last-frame guard
  });
});

describe('TimelinePanel — reorder & per-frame duration', () => {
  test('Move later button reorders the frames', async () => {
    byLabel('Move frame 1 later')?.click();
    await vi.waitFor(() =>
      expect(stack.getFrames().map((f) => f.id)).toEqual(['frame-2', 'frame-1', 'frame-3']),
    );
  });

  test('editing a duration input updates that frame duration', async () => {
    const input = host.querySelector<HTMLInputElement>('.pf-frame__durinput');
    expect(input).not.toBeNull();
    if (input) {
      setNativeValue(input, '250');
    }
    await vi.waitFor(() => expect(stack.getFrames()[0].durationMs).toBe(250));
  });
});

describe('TimelinePanel — add layer applies to every frame (criterion 1)', () => {
  test('+ Layer (all frames) adds an aligned layer to all three frames', async () => {
    button('+ Layer (all frames)')?.click();
    await vi.waitFor(() => {
      expect(stack.getFrames().every((f) => f.layers.length === 2)).toBe(true);
    });
    const ids = new Set(stack.getFrames().map((f) => f.layers[1].id));
    expect(ids.size).toBe(1); // same aligned id in every frame
    expect(host.querySelector('.pf-frames__status')?.textContent).toContain('2 layers');
  });
});

describe('TimelinePanel — onion skin', () => {
  test('renders ghost overlay when enabled and removes it when off', async () => {
    // Frame 2 active, prev=frame1 (warm) + next=frame3 (cool) ghosts by default.
    await vi.waitFor(() => expect(host.querySelector('.pf-fpreview__onion')).not.toBeNull());
    // Frame 1 painted RED at (0,0) → the warm ghost leaves a non-transparent pixel there.
    await vi.waitFor(() => expect(pixelOf('.pf-fpreview__onion', 0, 0)[3]).toBeGreaterThan(0));

    byLabel('Disable onion skin')?.click();
    await vi.waitFor(() => expect(host.querySelector('.pf-fpreview__onion')).toBeNull());

    byLabel('Enable onion skin')?.click();
    await vi.waitFor(() => expect(host.querySelector('.pf-fpreview__onion')).not.toBeNull());
  });

  test('the current frame (never a ghost) shows on the main preview', () => {
    // Frame 2 is GREEN at (1,1) on the live preview canvas.
    expect(pixelOf('.pf-fpreview__canvas', 1, 1)).toEqual(GREEN);
  });
});

describe('TimelinePanel — playback', () => {
  test('Next / Previous step the active frame deterministically', async () => {
    byLabel('Next frame')?.click();
    await vi.waitFor(() => expect(activeIndex()).toBe(2));
    byLabel('Previous frame')?.click();
    await vi.waitFor(() => expect(activeIndex()).toBe(1));
  });

  test('Play advances the active frame; Pause halts it', async () => {
    const start = stack.getActiveIndex();
    byLabel('Play')?.click();
    // Within a few frame durations (60ms each), the active frame advances.
    await vi.waitFor(() => expect(stack.getActiveIndex()).not.toBe(start), { timeout: 2000 });
    byLabel('Pause')?.click();
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Play"]')).not.toBeNull());
    const held = stack.getActiveIndex();
    await new Promise((r) => setTimeout(r, 150));
    expect(stack.getActiveIndex()).toBe(held); // paused → no further advance
  });
});

describe('TimelinePanel — undo / redo & painting', () => {
  test('undo reverts a frame add; redo re-applies it', async () => {
    button('Add frame')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
    byLabel('Revert last frame change')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(3));
    byLabel('Reapply last frame change')?.click();
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
  });

  test('dragging on the preview paints the active frame active layer', async () => {
    const preview = host.querySelector('.pf-fpreview') as HTMLDivElement;
    const rect = preview.getBoundingClientRect();
    // Aim at art pixel (3,3) in the 4×4 buffer (active frame 2, layer-1).
    const cx = rect.left + (3.5 / 4) * rect.width;
    const cy = rect.top + (3.5 / 4) * rect.height;
    const opts = { clientX: cx, clientY: cy, pointerId: 1, bubbles: true } as PointerEventInit;
    preview.dispatchEvent(new PointerEvent('pointerdown', opts));
    preview.dispatchEvent(new PointerEvent('pointerup', opts));
    await vi.waitFor(() => {
      expect(pixelOf('.pf-fpreview__canvas', 3, 3)[3]).toBeGreaterThan(0);
    });
    // The paint landed on frame 2 only — frame 1's buffer is untouched at (3,3).
    expect(stack.getFrames()[0].layers[0].buffer.data[(3 * 4 + 3) * 4 + 3]).toBe(0);
  });
});
