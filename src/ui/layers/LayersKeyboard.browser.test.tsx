import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../styles/tokens.css';
import { App } from '../App';

/**
 * Vitest Browser Mode (real Chromium) — U-007 F-3 regression (WCAG 2.1.1, Level A).
 *
 * Mounts the WHOLE app so `CanvasStage`'s window-level `keydown` handler is live
 * (that is the one that used to `preventDefault()` Enter/Space for every non-text
 * target and thereby cancel the native keyboard activation of every Layers-panel
 * button). The panel must stay fully keyboard-operable: focusing a button and
 * pressing Enter must ADD a layer, and pressing Space on a focused visibility eye
 * must TOGGLE it. These assertions FAIL against the pre-fix build (the handler
 * cancels the activation) and pass once the handler bails on interactive targets.
 */

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
});

const panel = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>('.pf-layers');
  if (!el) {
    throw new Error('Layers panel not mounted');
  }
  return el;
};

const rows = (): HTMLLIElement[] =>
  Array.from(panel().querySelectorAll<HTMLLIElement>('.pf-layer'));

const opButton = (label: string): HTMLButtonElement => {
  const found = Array.from(panel().querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`Layers-panel button "${label}" not found`);
  }
  return found;
};

async function mountApp(): Promise<void> {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // The panel seeds three forge-native layers (Anvil / Heat / Sparks).
  await vi.waitFor(() => expect(rows()).toHaveLength(3), { timeout: 4000 });
}

test('Enter on a focused Layers-panel button activates it (adds a layer)', async () => {
  await mountApp();
  const add = opButton('Add');
  add.focus();
  expect(document.activeElement).toBe(add);

  await userEvent.keyboard('{Enter}');

  await vi.waitFor(() => expect(rows()).toHaveLength(4), { timeout: 4000 });
});

test('Space on a focused visibility toggle activates it (hides the layer)', async () => {
  await mountApp();
  const eye = panel().querySelector<HTMLButtonElement>('button[aria-label^="Hide layer"]');
  expect(eye).not.toBeNull();
  if (!eye) {
    return;
  }
  expect(eye.getAttribute('aria-pressed')).toBe('true'); // currently visible
  eye.focus();

  await userEvent.keyboard(' ');

  // Native Space activation toggles visibility: the control relabels to "Show layer…".
  await vi.waitFor(
    () => {
      expect(panel().querySelector('button[aria-label^="Show layer"]')).not.toBeNull();
    },
    { timeout: 4000 },
  );
});
