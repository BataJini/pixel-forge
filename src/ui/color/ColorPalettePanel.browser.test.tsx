import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../styles/tokens.css';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ColorPalettePanel } from './ColorPalettePanel';

/**
 * Vitest Browser Mode (real Chromium). Exercises the Color & Palette panel's DOM
 * behavior: swatch rendering, click-to-pick reflected in the hex readout, loading
 * a built-in palette, the indexed toggle, and the live palette-swap preview.
 */

let host: HTMLElement;
let root: Root;

async function mount(node: React.ReactNode): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<StrictMode>{node}</StrictMode>);
  await vi.waitFor(() => {
    expect(host.querySelector('.pf-palette__swatch')).not.toBeNull();
  });
}

beforeEach(() => {
  try {
    localStorage.removeItem('pixelforge.recentColors.v1');
  } catch {
    // ignore
  }
});

afterEach(() => {
  root?.unmount();
  host?.remove();
});

function hexInput(): HTMLInputElement {
  return host.querySelector('.pf-picker__hexinput') as HTMLInputElement;
}

test('renders the default PICO-8 grid and a black foreground', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  expect(host.querySelectorAll('.pf-palette__swatch')).toHaveLength(16);
  expect(hexInput().value).toBe('#000000');
  // The palette-swap preview renders two canvases (before + recolored).
  expect(host.querySelectorAll('.pf-swap__canvas')).toHaveLength(2);
});

test('clicking a palette swatch sets the foreground (hex readout updates)', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  const swatches = host.querySelectorAll<HTMLButtonElement>('.pf-palette__swatch');
  swatches[8].click(); // PICO-8 index 8 = #FF004D
  await vi.waitFor(() => {
    expect(hexInput().value).toBe('#FF004D');
  });
});

test('loading a built-in palette swaps the grid contents', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  const select = host.querySelector('.pf-palmenu .pf-select') as HTMLSelectElement;
  select.value = 'gameboy';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => {
    expect(host.querySelectorAll('.pf-palette__swatch')).toHaveLength(4);
  });
});

test('Shift+Enter on a palette swatch sets the background (keyboard bg, F-3)', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  const swatch = host.querySelectorAll<HTMLButtonElement>('.pf-palette__swatch')[8]; // #FF004D
  swatch.focus();
  swatch.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
  );
  const bg = host.querySelector('.pf-slots__swatch--bg') as HTMLButtonElement;
  await vi.waitFor(() => {
    expect(bg.getAttribute('aria-label')).toContain('#FF004D');
  });
  // Foreground is untouched by the bg shortcut.
  expect(hexInput().value).toBe('#000000');
});

test('the indexed toggle flips its pressed state', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('.pf-palmenu button')).find(
    (b) => b.textContent?.startsWith('Indexed'),
  );
  expect(toggle).toBeTruthy();
  expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  toggle?.click();
  await vi.waitFor(() => {
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  });
});

test('toggling indexed reveals the palette-lock "drawing as" readout', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  expect(host.querySelector('.pf-color__lock')).toBeNull(); // hidden in free-color mode
  const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('.pf-palmenu button')).find(
    (b) => b.textContent?.startsWith('Indexed'),
  );
  toggle?.click();
  await vi.waitFor(() => {
    const lock = host.querySelector('.pf-color__lock');
    expect(lock?.textContent).toContain('drawing as');
    // fg #000000 is PICO-8 index 0, so it stays #000000 under the lock.
    expect(lock?.querySelector('b')?.textContent).toBe('#000000');
  });
});

test('reset returns the foreground to black after a change', async () => {
  await mount(
    <ThemeProvider>
      <ColorPalettePanel />
    </ThemeProvider>,
  );
  host.querySelectorAll<HTMLButtonElement>('.pf-palette__swatch')[8].click();
  await vi.waitFor(() => expect(hexInput().value).toBe('#FF004D'));
  const reset = Array.from(
    host.querySelectorAll<HTMLButtonElement>('.pf-slots__actions button'),
  ).find((b) => b.textContent === 'Reset');
  reset?.click();
  await vi.waitFor(() => {
    expect(hexInput().value).toBe('#000000');
  });
});
