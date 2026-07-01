import { afterEach, describe, expect, it, vi } from 'vitest';

// browser-fs-access is a browser boundary; mock it so the save layer is unit
// testable in Node. The high-level SVG export path is Node-safe (Blob only);
// PNG export needs a real canvas and is covered in export.browser.test.tsx.
const { fileSaveMock } = vi.hoisted(() => ({ fileSaveMock: vi.fn() }));
vi.mock('browser-fs-access', () => ({ supported: true, fileSave: fileSaveMock }));

import { createBuffer, setPixel } from '../../core/buffer';
import { exportSvgFile } from './index';
import { sanitizeFileName, saveBlob, withExtension } from './save';

function blob(): Blob {
  return new Blob(['x'], { type: 'text/plain' });
}

afterEach(() => {
  fileSaveMock.mockReset();
});

describe('sanitizeFileName', () => {
  it('slugs spaces and strips path-unsafe characters', () => {
    expect(sanitizeFileName('My Sprite')).toBe('My-Sprite');
    expect(sanitizeFileName('a/b\\c:d*e?')).toBe('a-b-c-d-e');
  });

  it('falls back when the result would be empty', () => {
    expect(sanitizeFileName('   ')).toBe('sprite');
    expect(sanitizeFileName('...')).toBe('sprite');
    expect(sanitizeFileName('', 'art')).toBe('art');
  });
});

describe('withExtension', () => {
  it('appends the extension only when missing (case-insensitive)', () => {
    expect(withExtension('sprite', 'png')).toBe('sprite.png');
    expect(withExtension('sprite', '.png')).toBe('sprite.png');
    expect(withExtension('sprite.png', 'png')).toBe('sprite.png');
    expect(withExtension('sprite.PNG', 'png')).toBe('sprite.PNG');
  });
});

describe('saveBlob', () => {
  it('resolves to "saved" on success', async () => {
    fileSaveMock.mockResolvedValue(null);
    const res = await saveBlob(blob(), { fileName: 'a.png', extensions: ['.png'] });
    expect(res).toEqual({ ok: true, value: 'saved' });
    expect(fileSaveMock).toHaveBeenCalledOnce();
  });

  it('treats a user-cancelled picker (AbortError) as "cancelled", not an error', async () => {
    fileSaveMock.mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    const res = await saveBlob(blob(), { fileName: 'a.png', extensions: ['.png'] });
    expect(res).toEqual({ ok: true, value: 'cancelled' });
  });

  it('returns a friendly error result on genuine failure', async () => {
    fileSaveMock.mockRejectedValue(new Error('disk full'));
    const res = await saveBlob(blob(), { fileName: 'a.png', extensions: ['.png'] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('EXPORT_SAVE_FAILED');
      expect(res.error.message).not.toContain('disk full'); // no internal leak
    }
  });
});

describe('exportSvgFile', () => {
  it('encodes a crisp SVG blob and saves it as <name>.svg', async () => {
    fileSaveMock.mockResolvedValue(null);
    const buf = setPixel(createBuffer(4, 4), 1, 1, [255, 0, 0, 255]);
    const res = await exportSvgFile(buf, { fileName: 'My Art' });
    expect(res).toEqual({ ok: true, value: 'saved' });

    const [savedBlob, opts] = fileSaveMock.mock.calls[0];
    const firstOpts = Array.isArray(opts) ? opts[0] : opts;
    expect(firstOpts.fileName).toBe('My-Art.svg');
    expect(firstOpts.extensions).toEqual(['.svg']);
    expect(savedBlob.type).toBe('image/svg+xml');
    const text = await (savedBlob as Blob).text();
    expect(text).toContain('<svg');
    expect(text).toContain('shape-rendering="crispEdges"');
  });
});
