import { type ChangeEvent, useId, useRef, useState } from 'react';
import { decodeImageFile } from '../../platform';
import { Button } from '../components';
import { useProject } from './ProjectProvider';

type Mode = 'canvas' | 'layer';

/** Strip the extension from a file name for a friendly project name. */
function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.trim() || 'Imported';
}

/**
 * Import an image (master-spec §3.8): decode a PNG/image file and add it either
 * as a NEW canvas (sized to the image) or as a NEW layer on the current canvas.
 * Defensive at the boundary — an oversize (> 512) or unreadable file is rejected
 * with a friendly, actionable message and NO change to current work. Decoding
 * never smooths, so imported pixel art stays crisp.
 */
export function ImportImageControl() {
  const { doc } = useProject();
  const [mode, setMode] = useState<Mode>('canvas');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modeId = useId();
  const errId = useId();

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) {
      return;
    }
    setError(null);
    setBusy(true);
    const res = await decodeImageFile(file);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    if (mode === 'canvas') {
      doc.importAsNewCanvas(res.value, baseName(file.name));
    } else {
      doc.importAsLayer(res.value, baseName(file.name));
    }
  };

  return (
    <div className="pf-import">
      <label className="pf-field" htmlFor={modeId}>
        <span className="pf-visually-hidden">Import as</span>
        <select
          id={modeId}
          className="pf-select pf-select--sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          <option value="canvas">as new canvas</option>
          <option value="layer">as new layer</option>
        </select>
      </label>
      <Button
        size="sm"
        disabled={busy}
        aria-describedby={error ? errId : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Importing…' : 'Import image'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/*"
        className="pf-visually-hidden"
        aria-label="Choose an image file to import"
        onChange={(e) => void onChange(e)}
      />
      {error && (
        <p id={errId} className="pf-project__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default ImportImageControl;
