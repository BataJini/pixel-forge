import { type ChangeEvent, useId, useRef, useState } from 'react';
import {
  BUILTIN_PALETTE_IDS,
  BUILTIN_PALETTES,
  makePalette,
  type PaletteExportFormat,
  parsePalette,
  serializePalette,
} from '../../core/palette';
import type { Palette } from '../../core/types';
import { downloadText, paletteFormatFromFilename, readTextFile } from '../../platform/files';

export interface PaletteMenuProps {
  readonly palette: Palette;
  readonly indexed: boolean;
  readonly onLoadPalette: (palette: Palette) => void;
  readonly onToggleIndexed: () => void;
}

type Status = { readonly tone: 'ok' | 'error'; readonly message: string } | null;

/** Load a built-in, import (.hex/.gpl/.pal), export, start a new palette, and
 * toggle indexed/palette-lock mode. Import is parsed defensively via the engine;
 * failures surface a friendly, non-blocking message (aria-live). */
export function PaletteMenu({
  palette,
  indexed,
  onLoadPalette,
  onToggleIndexed,
}: PaletteMenuProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const selectId = useId();
  const [status, setStatus] = useState<Status>(null);

  const onSelectBuiltin = (e: ChangeEvent<HTMLSelectElement>): void => {
    const id = e.target.value;
    if (id in BUILTIN_PALETTES) {
      onLoadPalette(BUILTIN_PALETTES[id as keyof typeof BUILTIN_PALETTES]);
      setStatus(null);
    }
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) {
      return;
    }
    try {
      const text = await readTextFile(file);
      const result = parsePalette(text, paletteFormatFromFilename(file.name));
      if (result.ok) {
        onLoadPalette(result.value);
        setStatus({ tone: 'ok', message: `Imported ${result.value.colors.length} colors.` });
      } else {
        setStatus({ tone: 'error', message: result.error.message });
      }
    } catch {
      setStatus({ tone: 'error', message: 'Could not read that file.' });
    }
  };

  const onExport = (format: PaletteExportFormat): void => {
    const safe = palette.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'palette';
    downloadText(`${safe}.${format}`, serializePalette(palette, format), 'text/plain');
    setStatus({ tone: 'ok', message: `Exported ${format.toUpperCase()}.` });
  };

  const onNew = (): void => {
    onLoadPalette(makePalette('New Palette', [], 'custom'));
    setStatus({ tone: 'ok', message: 'Started a new palette.' });
  };

  return (
    <div className="pf-palmenu">
      <div className="pf-palmenu__row">
        <label className="pf-label" htmlFor={selectId}>
          Load
        </label>
        <select
          id={selectId}
          className="pf-select"
          value={palette.id in BUILTIN_PALETTES ? palette.id : ''}
          onChange={onSelectBuiltin}
        >
          {!(palette.id in BUILTIN_PALETTES) && <option value="">{palette.name}</option>}
          {BUILTIN_PALETTE_IDS.map((id) => (
            <option key={id} value={id}>
              {BUILTIN_PALETTES[id].name}
            </option>
          ))}
        </select>
      </div>

      <div className="pf-palmenu__row pf-palmenu__row--buttons">
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          onClick={() => fileRef.current?.click()}
        >
          Import…
        </button>
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => onExport('hex')}>
          .hex
        </button>
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => onExport('gpl')}>
          .gpl
        </button>
        <button type="button" className="pf-btn pf-btn--sm" onClick={onNew}>
          New
        </button>
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          data-active={indexed ? 'true' : undefined}
          aria-pressed={indexed}
          onClick={onToggleIndexed}
          title="Restrict drawing to the palette and enable palette-swap recolor"
        >
          {indexed ? 'Indexed ●' : 'Indexed ○'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".hex,.gpl,.pal,.txt,text/plain"
          className="pf-visually-hidden"
          onChange={onImportFile}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {status && (
        <p
          className={`pf-palmenu__status pf-readout${status.tone === 'error' ? ' pf-palmenu__status--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
