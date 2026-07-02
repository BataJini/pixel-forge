import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createProjectStore, renderThumbnail, requestPersistentStorage } from '../../platform';
import { type DocPersistence, type DocumentSnapshot, DocumentStore } from '../../state';

export interface ProjectStoreValue {
  readonly doc: DocumentStore;
  readonly snapshot: DocumentSnapshot;
}

const ProjectContext = createContext<ProjectStoreValue | null>(null);

export interface ProjectProviderProps {
  readonly children: ReactNode;
  /** Inject a pre-built store (tests). Defaults to an IndexedDB-backed store. */
  readonly store?: DocumentStore;
  /** Inject persistence (tests) when not injecting a whole store. */
  readonly persistence?: DocPersistence;
  /** Called once after mount when there is no autosave to restore (first run). */
  readonly onFirstRun?: () => void;
  /** Called once after a session was restored from autosave. */
  readonly onRestored?: () => void;
}

/**
 * Provides a single {@link DocumentStore} to the project workbench (top bar,
 * stage, dialogs) via `useSyncExternalStore`, so title / saved-state / canvas
 * size changes re-render without tearing. On mount it requests persistent
 * storage and restores the last autosaved session; if there is none it signals
 * first-run so the Welcome dialog can open. The store is created once per
 * provider instance (tests inject their own with a fake persistence + timers).
 */
export function ProjectProvider({
  children,
  store,
  persistence,
  onFirstRun,
  onRestored,
}: ProjectProviderProps) {
  const ref = useRef<DocumentStore | null>(null);
  if (ref.current === null) {
    ref.current =
      store ??
      new DocumentStore(persistence ?? createProjectStore(), {
        renderThumbnail,
      });
  }
  const doc = ref.current;
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot, doc.getSnapshot);

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    void requestPersistentStorage();
    let cancelled = false;
    doc.restoreAutosave().then((res) => {
      if (cancelled) {
        return;
      }
      if (res.ok && res.value) {
        onRestored?.();
      } else {
        onFirstRun?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, onFirstRun, onRestored]);

  useEffect(() => () => doc.dispose(), [doc]);

  const value = useMemo<ProjectStoreValue>(() => ({ doc, snapshot }), [doc, snapshot]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Access the document store. Throws outside a `ProjectProvider`. */
export function useProject(): ProjectStoreValue {
  const value = useContext(ProjectContext);
  if (value === null) {
    throw new Error('useProject must be used within a <ProjectProvider>.');
  }
  return value;
}
