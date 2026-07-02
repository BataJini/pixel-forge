import { useCallback, useEffect, useState } from 'react';
import type { DocGalleryEntry } from '../../state';
import { Button, Dialog } from '../components';
import { useProject } from './ProjectProvider';

export interface GalleryDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Open the New-Canvas dialog (the gallery's "New" action). */
  readonly onNew: () => void;
}

type Loading =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: DocGalleryEntry[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The Gallery (master-spec §2 `#gallery`): every locally-saved project with a
 * live thumbnail. Open, rename (inline), duplicate, or delete (two-step confirm)
 * any project, or start a New one. Reads through the document store so all data
 * stays local (IndexedDB); every action refreshes the list.
 */
export function GalleryDialog({ open, onClose, onNew }: GalleryDialogProps) {
  const { doc, snapshot } = useProject();
  const [state, setState] = useState<Loading>({ kind: 'loading' });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    const res = await doc.listProjects();
    setState(
      res.ok
        ? { kind: 'ready', entries: res.value }
        : { kind: 'error', message: res.error.message },
    );
  }, [doc]);

  useEffect(() => {
    if (open) {
      setRenamingId(null);
      setConfirmDeleteId(null);
      void refresh();
    }
  }, [open, refresh]);

  const openEntry = async (id: string): Promise<void> => {
    const res = await doc.openById(id);
    if (res.ok) {
      onClose();
    } else {
      setState({ kind: 'error', message: res.error.message });
    }
  };

  const commitRename = async (id: string): Promise<void> => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name.length > 0) {
      await doc.renameSaved(id, name);
      await refresh();
    }
  };

  const duplicate = async (entry: DocGalleryEntry): Promise<void> => {
    await doc.duplicateSaved(entry.id, `${entry.name} copy`);
    await refresh();
  };

  const remove = async (id: string): Promise<void> => {
    await doc.deleteProject(id);
    setConfirmDeleteId(null);
    await refresh();
  };

  const entries = state.kind === 'ready' ? state.entries : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Gallery"
      className="pf-gallery"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onNew}>
            New Canvas
          </Button>
        </>
      }
    >
      {state.kind === 'loading' && <p className="pf-readout">Loading your forge…</p>}
      {state.kind === 'error' && (
        <p className="pf-project__error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'ready' && entries.length === 0 && (
        <p className="pf-gallery__empty pf-readout">
          No saved projects yet. Forge a New Canvas, then Save it to your gallery.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="pf-gallery__list" aria-label="Saved projects">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="pf-gallery__item"
              data-current={entry.id === snapshot.id ? 'true' : undefined}
            >
              <button
                type="button"
                className="pf-gallery__thumb pf-checker"
                aria-label={`Open ${entry.name}`}
                onClick={() => void openEntry(entry.id)}
              >
                {entry.thumbnailDataUrl ? (
                  <img src={entry.thumbnailDataUrl} alt="" className="pf-gallery__img" />
                ) : (
                  <span className="pf-gallery__noimg" aria-hidden="true">
                    {entry.w}×{entry.h}
                  </span>
                )}
              </button>

              <div className="pf-gallery__meta">
                {renamingId === entry.id ? (
                  <input
                    className="pf-input pf-input--sm"
                    value={renameValue}
                    autoFocus
                    aria-label={`Rename ${entry.name}`}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(entry.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => void commitRename(entry.id)}
                  />
                ) : (
                  <span className="pf-gallery__name">{entry.name}</span>
                )}
                <span className="pf-gallery__dims pf-readout">
                  {entry.w}×{entry.h} · {entry.layers} layer{entry.layers === 1 ? '' : 's'}
                  {entry.frames > 1 ? ` · ${entry.frames} frames` : ''}
                </span>
              </div>

              <div className="pf-gallery__ops">
                <Button size="sm" onClick={() => void openEntry(entry.id)}>
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenameValue(entry.name);
                    setRenamingId(entry.id);
                  }}
                >
                  Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void duplicate(entry)}>
                  Duplicate
                </Button>
                {confirmDeleteId === entry.id ? (
                  <Button size="sm" variant="danger" onClick={() => void remove(entry.id)}>
                    Confirm?
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setConfirmDeleteId(entry.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export default GalleryDialog;
