import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuffer, setPixel } from '../../core/buffer';
import type { PixelBuffer } from '../../core/types';

// Intercept the download so no real "Save As" dialog fires. Automates the U-009
// QA item "triggers a .png / .svg download of the right dimensions" via the
// browser-fs-access boundary.
const { fileSaveMock } = vi.hoisted(() => ({ fileSaveMock: vi.fn() }));
vi.mock('browser-fs-access', () => ({
  supported: false,
  fileSave: fileSaveMock,
}));

import { ExportDialog } from './ExportDialog';

let host: HTMLDivElement;
let root: Root;

function source(): PixelBuffer {
  return setPixel(createBuffer(8, 8), 1, 1, [255, 0, 0, 255]);
}

function render(getSource: () => PixelBuffer | null): void {
  root.render(
    <StrictMode>
      <ExportDialog open onClose={() => {}} getSource={getSource} title="pixelforge" />
    </StrictMode>,
  );
}

function findButton(text: string): HTMLButtonElement {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) {
    throw new Error(`button "${text}" not found`);
  }
  return btn as HTMLButtonElement;
}

function firstOptions(mock: ReturnType<typeof vi.fn>): {
  fileName?: string;
  extensions?: string[];
} {
  const opts = mock.mock.calls[0][1];
  return Array.isArray(opts) ? opts[0] : opts;
}

beforeEach(() => {
  fileSaveMock.mockReset();
  fileSaveMock.mockResolvedValue(null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
});

describe('ExportDialog — real browser', () => {
  it('shows the scale options and the live output size', async () => {
    render(source);
    await vi.waitFor(() => {
      expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    });
    // Default scale 8× on an 8×8 canvas → 64×64 output.
    const readout = document.querySelector('.pf-export__readout');
    expect(readout?.textContent).toContain('64×64');
  });

  it('recomputes the output size when the scale changes', async () => {
    render(source);
    await vi.waitFor(() => expect(document.querySelector('.pf-seg input')).not.toBeNull());
    const two = document.querySelector<HTMLInputElement>('input[type="radio"][value="2"]');
    if (!two) {
      throw new Error('2× radio missing');
    }
    two.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.pf-export__readout')?.textContent).toContain('16×16');
    });
  });

  it('exports a PNG through the save boundary with the right file name', async () => {
    render(source);
    await vi.waitFor(() => findButton('Export PNG'));
    findButton('Export PNG').click();
    await vi.waitFor(() => expect(fileSaveMock).toHaveBeenCalledTimes(1));
    const blob = fileSaveMock.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(firstOptions(fileSaveMock).fileName).toBe('pixelforge.png');
    await vi.waitFor(() => {
      expect(document.querySelector('.pf-export__status')?.textContent).toContain('PNG exported');
    });
  });

  it('exports an SVG through the save boundary with the right file name', async () => {
    render(source);
    await vi.waitFor(() => findButton('Export SVG'));
    findButton('Export SVG').click();
    await vi.waitFor(() => expect(fileSaveMock).toHaveBeenCalledTimes(1));
    const blob = fileSaveMock.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
    expect(firstOptions(fileSaveMock).fileName).toBe('pixelforge.svg');
  });

  it('surfaces a friendly error when there is nothing to export', async () => {
    render(() => null);
    await vi.waitFor(() => findButton('Export PNG'));
    findButton('Export PNG').click();
    await vi.waitFor(() => {
      expect(document.querySelector('.pf-export__status--error')?.textContent).toContain(
        'Nothing to export',
      );
    });
    expect(fileSaveMock).not.toHaveBeenCalled();
  });
});
