import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPixel } from '../../core/buffer';
import type { PixelBuffer, RGBA } from '../../core/types';
import { type KeyValStore, ProjectStore, renderThumbnail } from '../../platform';
import { DocumentStore } from '../../state';
import { ProjectWorkbench } from './ProjectWorkbench';

const RED: RGBA = [255, 0, 0, 255];

/** In-memory key-value store so the real ProjectStore (serialize/deserialize +
 * gallery index) round-trips in the browser without touching IndexedDB. */
function memKv(): KeyValStore {
  const map = new Map<string, string>();
  return {
    async get(k) {
      return map.get(k);
    },
    async set(k, v) {
      map.set(k, v);
    },
    async del(k) {
      map.delete(k);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function makeDoc(persistence: ProjectStore): DocumentStore {
  return new DocumentStore(persistence, {
    renderThumbnail,
    autosaveDelayMs: 5,
    initialSize: { w: 8, h: 8 },
  });
}

let host: HTMLDivElement;
let root: Root;

function mount(node: React.ReactElement): void {
  root.render(<StrictMode>{node}</StrictMode>);
}

function findButton(text: string, scope: ParentNode = document): HTMLButtonElement {
  const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) {
    throw new Error(`button "${text}" not found`);
  }
  return btn as HTMLButtonElement;
}

function setNumber(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
});

describe('ProjectWorkbench — first run + New Canvas', () => {
  it('shows a mandatory Welcome dialog and clamps a >512 custom size', async () => {
    const doc = makeDoc(new ProjectStore(memKv()));
    mount(<ProjectWorkbench store={doc} autoWelcome />);

    await vi.waitFor(() => {
      const title = [...document.querySelectorAll('.pf-dialog__title')].some((n) =>
        n.textContent?.includes('New Canvas'),
      );
      expect(title).toBe(true);
    });

    const nums = document.querySelectorAll<HTMLInputElement>(
      '.pf-welcome .pf-welcome__custom input[type="number"]',
    );
    expect(nums.length).toBe(2);
    setNumber(nums[0], 999); // W → clamps to 512
    setNumber(nums[1], 700); // H → clamps to 512
    await vi.waitFor(() => expect(nums[0].value).toBe('512'));

    findButton('Forge it').click();
    await vi.waitFor(() => {
      expect(doc.getSnapshot().w).toBe(512);
      expect(doc.getSnapshot().h).toBe(512);
    });
  });
});

describe('ProjectWorkbench — persistence round-trip', () => {
  it('autosaves the working document and restores it on a fresh mount', async () => {
    const persistence = new ProjectStore(memKv());
    const docA = makeDoc(persistence);
    mount(<ProjectWorkbench store={docA} />);
    await vi.waitFor(() => expect(document.querySelector('.pf-projbar')).not.toBeNull());

    docA.newProject({ w: 8, h: 8, name: 'Sprite' });
    docA.getStack().stampPixel(2, 3, RED);
    await docA.flushAutosave();
    root.unmount();

    // "Reload": a brand-new store over the SAME persistence restores the session.
    root = createRoot(host);
    const docB = makeDoc(persistence);
    mount(<ProjectWorkbench store={docB} />);
    await vi.waitFor(() => {
      expect(docB.getSnapshot().name).toBe('Sprite');
    });
    const layer = docB.getStack().getLayers()[0];
    expect(getPixel(layer.buffer, 2, 3)).toEqual(RED);
  });

  it('saves to the gallery and re-opens the exact pixels from another session', async () => {
    const persistence = new ProjectStore(memKv());
    const docA = makeDoc(persistence);
    mount(<ProjectWorkbench store={docA} />);
    await vi.waitFor(() => expect(document.querySelector('.pf-projbar')).not.toBeNull());

    docA.newProject({ w: 8, h: 8, name: 'Gallery Hero' });
    docA.getStack().stampPixel(5, 6, RED);
    await docA.flushAutosave(); // ensure the reload store restores (no mandatory Welcome)
    findButton('Save').click();
    await vi.waitFor(() => {
      expect(document.querySelector('.pf-savestate--saved')).not.toBeNull();
    });
    root.unmount();

    root = createRoot(host);
    const docB = makeDoc(persistence);
    mount(<ProjectWorkbench store={docB} />);
    await vi.waitFor(() => expect(document.querySelector('.pf-projbar')).not.toBeNull());

    // Open the gallery and open the saved project.
    findButton('Open').click();
    await vi.waitFor(() => expect(findButton('Open')).toBeTruthy());
    await vi.waitFor(() => {
      const names = [...document.querySelectorAll('.pf-gallery__name')].map((n) => n.textContent);
      expect(names).toContain('Gallery Hero');
    });
    // The row's primary Open button.
    const openBtns = [...document.querySelectorAll('.pf-gallery__ops button')].filter(
      (b) => b.textContent?.trim() === 'Open',
    );
    (openBtns[0] as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const layer = docB.getStack().getLayers()[0];
      expect(getPixel(layer.buffer, 5, 6)).toEqual(RED);
    });
  });
});

describe('ProjectWorkbench — resize + import guards', () => {
  it('resizes via the dialog and clamps a > 512 request', async () => {
    const doc = makeDoc(new ProjectStore(memKv()));
    mount(<ProjectWorkbench store={doc} />);
    await vi.waitFor(() => expect(document.querySelector('.pf-projbar')).not.toBeNull());
    doc.newProject({ w: 16, h: 16, name: 'Resizable' });

    findButton('Resize').click(); // the top-bar action opens the dialog
    const dialog = await vi.waitFor(() => {
      const d = document.querySelector<HTMLElement>('.pf-resize');
      if (!d?.querySelector('.pf-dialog__title')?.textContent?.includes('Resize Canvas')) {
        throw new Error('resize dialog not open');
      }
      return d;
    });
    const nums = dialog.querySelectorAll<HTMLInputElement>('input[type="number"]');
    setNumber(nums[0], 900);
    await vi.waitFor(() => expect(nums[0].value).toBe('512'));
    findButton('Resize', dialog.querySelector('.pf-dialog__actions') ?? dialog).click();
    await vi.waitFor(() => expect(doc.getSnapshot().w).toBe(512));
  });

  it('rejects an oversize image import with a friendly error and no loss of work', async () => {
    const doc = makeDoc(new ProjectStore(memKv()));
    mount(<ProjectWorkbench store={doc} />);
    await vi.waitFor(() => expect(document.querySelector('.pf-projbar')).not.toBeNull());
    doc.newProject({ w: 8, h: 8, name: 'Keep Me' });
    doc.getStack().stampPixel(1, 1, RED);

    const file = await makeImageFile(600, 2); // > 512 cap
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) {
      throw new Error('import file input not found');
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      const err = document.querySelector('.pf-project__error');
      expect(err?.textContent ?? '').toMatch(/512/);
    });
    // Current work is intact: same size, same pixel.
    expect(doc.getSnapshot().name).toBe('Keep Me');
    expect(doc.getSnapshot().w).toBe(8);
    const layer = doc.getStack().getLayers()[0];
    expect(getPixel(layer.buffer as PixelBuffer, 1, 1)).toEqual(RED);
  });
});

/** Build a real PNG File of the given size for import tests. */
async function makeImageFile(w: number, h: number): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('could not create test image blob');
  }
  return new File([blob], 'big.png', { type: 'image/png' });
}
