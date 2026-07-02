import { useState } from 'react';
import { exportProjectFile } from '../../platform';
import type { SaveState } from '../../state';
import { Button } from '../components';
import { ImportImageControl } from './ImportImageControl';
import { useProject } from './ProjectProvider';

export interface ProjectBarProps {
  readonly onNew: () => void;
  readonly onOpenGallery: () => void;
  readonly onResize: () => void;
  readonly onCrop: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Forged',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
};

/**
 * The project toolbar (master-spec §3 top bar + §3.7 File/Canvas commands as they
 * pertain to persistence): an editable title, a live save-state indicator
 * ("Forged"/"Unsaved"/"Saving…"), and the New / Open / Save / Export-file /
 * Resize / Crop / Trim / Import actions. The full menu bar + command palette land
 * in U-012; this bar exposes U-011's document + persistence surface.
 */
export function ProjectBar({ onNew, onOpenGallery, onResize, onCrop }: ProjectBarProps) {
  const { doc, snapshot } = useProject();
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const res = await doc.save();
    setNotice(res.ok ? 'Saved to gallery.' : res.error.message);
  };

  const saveToFile = async (): Promise<void> => {
    const res = await exportProjectFile(doc.buildProject());
    if (!res.ok) {
      setNotice(res.error.message);
    } else if (res.value === 'saved') {
      setNotice('Exported .forge file.');
    }
  };

  const trim = (): void => {
    const res = doc.trimTransparent();
    setNotice(res.ok ? 'Trimmed to content.' : res.error.message);
  };

  return (
    <div className="pf-projbar">
      <div className="pf-projbar__id">
        <label className="pf-field pf-projbar__title">
          <span className="pf-visually-hidden">Project title</span>
          <input
            className="pf-input pf-projbar__titleinput"
            type="text"
            value={snapshot.name}
            maxLength={64}
            aria-label="Project title"
            onChange={(e) => doc.setName(e.target.value)}
          />
        </label>
        <span
          className={`pf-savestate pf-savestate--${snapshot.saveState}`}
          role="status"
          aria-live="polite"
        >
          <span className="pf-savestate__dot" aria-hidden="true" />
          {SAVE_LABEL[snapshot.saveState]}
        </span>
      </div>

      <div className="pf-projbar__ops" role="toolbar" aria-label="Project actions">
        <Button size="sm" onClick={onNew}>
          New
        </Button>
        <Button size="sm" onClick={onOpenGallery}>
          Open
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void saveToFile()}>
          Export .forge
        </Button>
        <span className="pf-projbar__sep" aria-hidden="true" />
        <Button size="sm" onClick={onResize}>
          Resize
        </Button>
        <Button size="sm" onClick={onCrop}>
          Crop
        </Button>
        <Button size="sm" onClick={trim}>
          Trim
        </Button>
        <span className="pf-projbar__sep" aria-hidden="true" />
        <ImportImageControl />
      </div>

      {notice && (
        <p className="pf-projbar__notice pf-readout" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  );
}

export default ProjectBar;
