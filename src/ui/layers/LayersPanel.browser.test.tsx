import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createBuffer, setPixel } from '../../core/buffer';
import type { RGBA } from '../../core/types';
import { LayerStack, layerFromBuffer } from '../../state';
import '../../styles/tokens.css';
import { ThemeProvider } from '../theme/ThemeProvider';
import { LayersPanel } from './LayersPanel';
import { LayersProvider } from './LayersProvider';

/**
 * Vitest Browser Mode (real Chromium). Exercises the Layers panel's DOM behavior
 * and the fact that layer semantics reach the live composite canvas: rendering the
 * list top-first, the active-row highlight, add/duplicate/delete (+ last-layer
 * guard), rename, visibility/opacity affecting the composite pixels, reorder (via
 * buttons and drag), the flatten confirm dialog, and undo/redo — all against a
 * known 4×4 two-layer stack so pixel assertions are exact.
 */

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const TRANSPARENT: RGBA = [0, 0, 0, 0];

const px = (x: number, y: number, c: RGBA) => setPixel(createBuffer(4, 4), x, y, c);

let host: HTMLElement;
let root: Root;
let stack: LayerStack;

function makeStack(): LayerStack {
  stack = new LayerStack(4, 4, {
    initial: {
      layers: [
        layerFromBuffer('layer-1', 'Base', px(0, 0, RED)),
        layerFromBuffer('layer-2', 'Top', px(1, 1, BLUE)),
      ],
      activeId: 'layer-2',
    },
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
        <LayersProvider createStack={makeStack}>
          <LayersPanel standalone={false} />
        </LayersProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  await vi.waitFor(() => {
    expect(host.querySelector('.pf-layer')).not.toBeNull();
  });
}

beforeEach(async () => {
  await mount();
});

afterEach(() => {
  root?.unmount();
  host?.remove();
});

const rows = (): HTMLLIElement[] => Array.from(host.querySelectorAll<HTMLLIElement>('.pf-layer'));
const names = (): string[] =>
  Array.from(host.querySelectorAll<HTMLInputElement>('.pf-layer__name')).map((i) => i.value);
const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
const byLabel = (label: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
/** Set a controlled input's value the way React expects, then fire `input`. */
function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function compositePixel(x: number, y: number): number[] {
  const canvas = host.querySelector('.pf-lpreview__canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no ctx');
  }
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

describe('LayersPanel — structure & active layer', () => {
  test('renders the stack top-first with the active row marked', () => {
    expect(names()).toEqual(['Top', 'Base']); // top layer first
    const active = host.querySelectorAll('.pf-layer[aria-current="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].querySelector<HTMLInputElement>('.pf-layer__name')?.value).toBe('Top');
  });

  test('clicking a layer thumbnail makes it active', async () => {
    byLabel('Select layer Base')?.click();
    await vi.waitFor(() => {
      const active = host.querySelector('.pf-layer[aria-current="true"] .pf-layer__name');
      expect((active as HTMLInputElement)?.value).toBe('Base');
    });
  });
});

describe('LayersPanel — add / duplicate / delete', () => {
  test('Add inserts a new active layer above the active one', async () => {
    button('Add')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    // Inserted directly above 'Top' (the active layer) and becomes the active top.
    expect(stack.getActiveIndex()).toBe(2);
    expect(stack.getActiveId()).toBe('layer-3');
    const activeName = (
      host.querySelector('.pf-layer[aria-current="true"] .pf-layer__name') as HTMLInputElement
    )?.value;
    expect(activeName).toBe(names()[0]); // the active row renders first (top)
  });

  test('Duplicate copies the active layer', async () => {
    button('Duplicate')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    expect(names()).toContain('Top copy');
  });

  test('Delete removes a layer and is disabled at the last one', async () => {
    button('Delete')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(names()).toEqual(['Base']);
    expect(button('Delete')?.disabled).toBe(true); // last-layer guard
  });
});

describe('LayersPanel — visibility & opacity reach the composite', () => {
  test('hiding the top layer removes its pixel; showing restores it', async () => {
    expect(compositePixel(1, 1)).toEqual(BLUE);
    byLabel('Hide layer Top')?.click();
    await vi.waitFor(() => expect(compositePixel(1, 1)).toEqual(TRANSPARENT));
    byLabel('Show layer Top')?.click();
    await vi.waitFor(() => expect(compositePixel(1, 1)).toEqual(BLUE));
  });

  test('opacity 0 on the top layer drops it from the composite', async () => {
    const slider = host.querySelector<HTMLInputElement>('.pf-layer__opacity input');
    expect(slider).not.toBeNull();
    if (slider) {
      setNativeValue(slider, '0');
    }
    await vi.waitFor(() => expect(compositePixel(1, 1)).toEqual(TRANSPARENT));
    expect(stack.getLayers()[1].opacity).toBe(0); // 'Top' is array index 1
  });
});

describe('LayersPanel — rename, reorder, flatten, undo', () => {
  test('editing the name input renames the layer', async () => {
    const input = host.querySelector<HTMLInputElement>('.pf-layer__name');
    if (input) {
      setNativeValue(input, 'Sky');
    }
    await vi.waitFor(() => expect(stack.getLayers().some((l) => l.name === 'Sky')).toBe(true));
    expect(names()).toContain('Sky');
  });

  test('Move down button reorders the layers', async () => {
    // The top row is 'Top'; moving it down swaps it below 'Base'.
    byLabel('Move layer Top down')?.click();
    await vi.waitFor(() => expect(names()).toEqual(['Base', 'Top']));
  });

  test('drag-and-drop reorders the layers', async () => {
    const [topRow, baseRow] = rows();
    const dt = new DataTransfer();
    topRow.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    baseRow.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
    baseRow.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    await vi.waitFor(() => expect(names()).toEqual(['Base', 'Top']));
  });

  test('Flatten asks for confirmation, then collapses to one layer', async () => {
    button('Flatten')?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull();
    });
    button('Flatten all')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    // Composite is preserved after flatten.
    expect(compositePixel(0, 0)).toEqual(RED);
    expect(compositePixel(1, 1)).toEqual(BLUE);
  });

  test('undo reverts a structural change; redo re-applies it', async () => {
    button('Add')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    byLabel('Revert last layer change')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    byLabel('Reapply last layer change')?.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
  });
});

describe('LayersPanel — lock protects the active layer (F-2)', () => {
  test('locking disables delete/merge/flatten and blocks painting', async () => {
    // Lock the active 'Top' layer via its lock toggle.
    byLabel('Lock layer Top')?.click();
    await vi.waitFor(() => expect(stack.getSnapshot().activeLocked).toBe(true));

    // Destructive ops disable in lockstep with the store guards (data-safety).
    expect(button('Delete')?.disabled).toBe(true);
    expect(button('Flatten')?.disabled).toBe(true);
    expect(stack.getSnapshot().canMergeDown).toBe(false);

    // Painting the locked active layer through the preview is a no-op.
    const preview = host.querySelector('.pf-lpreview') as HTMLDivElement;
    const rect = preview.getBoundingClientRect();
    const cx = rect.left + (2.5 / 4) * rect.width;
    const cy = rect.top + (2.5 / 4) * rect.height;
    const opts = { clientX: cx, clientY: cy, pointerId: 1, bubbles: true } as PointerEventInit;
    preview.dispatchEvent(new PointerEvent('pointerdown', opts));
    preview.dispatchEvent(new PointerEvent('pointerup', opts));
    await new Promise((r) => setTimeout(r, 30));
    expect(compositePixel(2, 2)).toEqual(TRANSPARENT);
    expect(stack.getLayers()[1].locked).toBe(true);

    // Unlocking restores the ability to delete/flatten.
    byLabel('Unlock layer Top')?.click();
    await vi.waitFor(() => expect(stack.getSnapshot().activeLocked).toBe(false));
    expect(button('Delete')?.disabled).toBe(false);
    expect(button('Flatten')?.disabled).toBe(false);
  });
});

describe('LayersPanel — painting the active layer via pointer', () => {
  test('dragging on the preview paints the active layer and updates the composite', async () => {
    const preview = host.querySelector('.pf-lpreview') as HTMLDivElement;
    const rect = preview.getBoundingClientRect();
    // Aim at art pixel (2,2) in the 4×4 buffer (active layer = 'Top').
    const cx = rect.left + (2.5 / 4) * rect.width;
    const cy = rect.top + (2.5 / 4) * rect.height;
    const opts = { clientX: cx, clientY: cy, pointerId: 1, bubbles: true } as PointerEventInit;
    preview.dispatchEvent(new PointerEvent('pointerdown', opts));
    preview.dispatchEvent(new PointerEvent('pointerup', opts));
    await vi.waitFor(() => {
      const p = compositePixel(2, 2);
      expect(p[3]).toBeGreaterThan(0); // something opaque was painted
    });
    // The painted pixel lives on the active 'Top' layer, so hiding it clears (2,2).
    byLabel('Hide layer Top')?.click();
    await vi.waitFor(() => expect(compositePixel(2, 2)).toEqual(TRANSPARENT));
  });
});
