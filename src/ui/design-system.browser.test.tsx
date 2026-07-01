import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../styles/tokens.css';
import { Button } from './components/Button';
import { CrtOverlay } from './components/CrtOverlay';
import { Dialog } from './components/Dialog';
import { Frame } from './components/Frame';
import { Panel } from './components/Panel';
import { Slider } from './components/Slider';
import { ThemeProvider } from './theme/ThemeProvider';
import { useTheme } from './theme/useTheme';

/**
 * Vitest Browser Mode (real Chromium via Playwright). Covers the machine-checkable
 * U-002 criteria that need a live DOM + CSSOM: exact token resolution (1), the
 * Arcade-CRT default (2), components rendering (5), and the CRT overlay being a
 * non-interactive, content-preserving overlay (6).
 */

const root = document.documentElement;

function readVar(name: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim().toLowerCase();
}

async function mount(node: React.ReactNode): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  r.render(<StrictMode>{node}</StrictMode>);
  await vi.waitFor(() => {
    expect(host.childElementCount).toBeGreaterThan(0);
  });
  return { host, root: r };
}

beforeEach(() => {
  root.removeAttribute('data-theme');
  root.removeAttribute('data-crt');
});
afterEach(() => {
  root.removeAttribute('data-theme');
  root.removeAttribute('data-crt');
});

describe('criterion 1/2 — exact token resolution + Arcade default', () => {
  test('the default :root (no data-theme) resolves the Arcade CRT ramp', () => {
    expect(readVar('--c-ember')).toBe('#00f0ff');
    expect(readVar('--c-steel')).toBe('#e8f0ff');
    expect(readVar('--c-anvil')).toBe('#06070c');
    expect(readVar('--c-spark')).toBe('#ff2e88');
  });

  test('data-theme="forge" re-tempers to the exact Forge ramp', () => {
    root.dataset.theme = 'forge';
    expect(readVar('--c-ember')).toBe('#ff6a1a');
    expect(readVar('--c-steel')).toBe('#e8dfd2');
    expect(readVar('--c-anvil')).toBe('#12100e');
    expect(readVar('--c-warning')).toBe('#e23b2e');
  });

  test('hardware themes resolve their accent ember', () => {
    root.dataset.theme = 'gameboy';
    expect(readVar('--c-ember')).toBe('#9bbc0f');
    root.dataset.theme = 'amber';
    expect(readVar('--c-ember')).toBe('#f59a2e');
  });
});

describe('criterion 2 — ThemeProvider defaults', () => {
  function Probe() {
    const { theme, renderedCrtLevel, soundEnabled } = useTheme();
    return (
      <p data-testid="probe" data-theme={theme} data-crt={renderedCrtLevel}>
        {String(soundEnabled)}
      </p>
    );
  }

  test('defaults to arcade + subtle CRT + muted sound, and writes <html> attrs', async () => {
    const { host, root: r } = await mount(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const probe = host.querySelector('[data-testid="probe"]');
    expect(probe?.getAttribute('data-theme')).toBe('arcade');
    expect(probe?.getAttribute('data-crt')).toBe('subtle');
    expect(probe?.textContent).toBe('false');
    await vi.waitFor(() => {
      expect(root.dataset.theme).toBe('arcade');
      expect(root.dataset.crt).toBe('subtle');
    });
    r.unmount();
    host.remove();
  });
});

describe('criterion 5 — components render without throwing', () => {
  test('Button, Panel, Slider, Frame, Dialog all render', async () => {
    const { host, root: r } = await mount(
      <ThemeProvider>
        <Panel title="Layers">
          <Frame>
            <Button variant="primary">Forge</Button>
            <Slider label="Brush" min={1} max={16} defaultValue={4} />
          </Frame>
        </Panel>
        <Dialog open title="New Canvas" onClose={() => {}}>
          body
        </Dialog>
      </ThemeProvider>,
    );
    expect(host.querySelector('.pf-btn')).not.toBeNull();
    expect(host.querySelector('.pf-panel')).not.toBeNull();
    expect(host.querySelector('.pf-frame')).not.toBeNull();
    expect(host.querySelector('.pf-slider__input')).not.toBeNull();
    const dialog = host.querySelector('dialog.pf-dialog') as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    r.unmount();
    host.remove();
  });
});

describe('criterion 6 — CRT layer is a non-interactive overlay', () => {
  test('overlay is pointer-events:none, aria-hidden, and toggles levels', async () => {
    const { host, root: r } = await mount(<CrtOverlay level="subtle" />);
    const overlay = host.querySelector('[data-testid="crt-overlay"]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(getComputedStyle(overlay).pointerEvents).toBe('none');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.dataset.level).toBe('subtle');

    r.render(
      <StrictMode>
        <CrtOverlay level="full" />
      </StrictMode>,
    );
    await vi.waitFor(() => {
      expect((host.querySelector('[data-testid="crt-overlay"]') as HTMLElement).dataset.level).toBe(
        'full',
      );
    });
    expect(
      getComputedStyle(host.querySelector('[data-testid="crt-overlay"]') as HTMLElement)
        .pointerEvents,
    ).toBe('none');
    r.unmount();
    host.remove();
  });

  test('toggling CRT level does not move content pixels', async () => {
    function Harness({ level }: { level: 'off' | 'subtle' | 'full' }) {
      return (
        <>
          <div
            id="content"
            style={{ width: '200px', height: '80px', margin: '10px', padding: '4px' }}
          >
            canvas
          </div>
          <CrtOverlay level={level} />
        </>
      );
    }
    const { host, root: r } = await mount(<Harness level="off" />);
    const before = (host.querySelector('#content') as HTMLElement).getBoundingClientRect();

    for (const level of ['subtle', 'full', 'off'] as const) {
      r.render(
        <StrictMode>
          <Harness level={level} />
        </StrictMode>,
      );
      await vi.waitFor(() => {
        expect(
          (host.querySelector('[data-testid="crt-overlay"]') as HTMLElement).dataset.level,
        ).toBe(level);
      });
      const after = (host.querySelector('#content') as HTMLElement).getBoundingClientRect();
      expect(after.top).toBe(before.top);
      expect(after.left).toBe(before.left);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
    }
    r.unmount();
    host.remove();
  });
});
