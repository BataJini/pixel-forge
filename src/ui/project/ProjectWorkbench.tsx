import { useState } from 'react';
import type { DocPersistence, DocumentStore } from '../../state';
import { Panel } from '../components';
import { CropDialog } from './CropDialog';
import { GalleryDialog } from './GalleryDialog';
import { ProjectBar } from './ProjectBar';
import { ProjectProvider } from './ProjectProvider';
import { ProjectStage } from './ProjectStage';
import { ResizeDialog } from './ResizeDialog';
import { WelcomeDialog } from './WelcomeDialog';
import './project.css';

type DialogKind = 'none' | 'welcome' | 'gallery' | 'resize' | 'crop';

interface WorkbenchBodyProps {
  readonly firstRun: boolean;
  readonly onDismissFirstRun: () => void;
}

function WorkbenchBody({ firstRun, onDismissFirstRun }: WorkbenchBodyProps) {
  const [dialog, setDialog] = useState<DialogKind>('none');
  const close = (): void => setDialog('none');
  const welcomeOpen = dialog === 'welcome' || firstRun;

  return (
    <Panel title="Project" className="pf-project">
      <ProjectBar
        onNew={() => setDialog('welcome')}
        onOpenGallery={() => setDialog('gallery')}
        onResize={() => setDialog('resize')}
        onCrop={() => setDialog('crop')}
      />
      <ProjectStage />

      <WelcomeDialog
        open={welcomeOpen}
        mandatory={firstRun}
        onClose={() => {
          onDismissFirstRun();
          close();
        }}
      />
      <GalleryDialog
        open={dialog === 'gallery'}
        onClose={close}
        onNew={() => setDialog('welcome')}
      />
      <ResizeDialog open={dialog === 'resize'} onClose={close} />
      <CropDialog open={dialog === 'crop'} onClose={close} />
    </Panel>
  );
}

export interface ProjectWorkbenchProps {
  /** Inject a pre-built store (tests). */
  readonly store?: DocumentStore;
  /** Inject persistence (tests) without building a whole store. */
  readonly persistence?: DocPersistence;
  /**
   * Auto-open the mandatory Welcome dialog on first run (no autosave). OFF by
   * default: in the shared U-011 preview App the workbench is one panel among the
   * still-interactive U-004/U-007 demos, and a page-blocking modal on load would
   * make them inert. The standalone shell (U-012) enables it. Users always reach
   * the Welcome dialog via the "New" button regardless.
   */
  readonly autoWelcome?: boolean;
}

/**
 * The Project workbench (U-011): local persistence + dialogs + image import,
 * assembled as a self-contained surface distinct from the U-004 tool preview and
 * U-007 layers demo (the shell unifies them in U-012). One {@link ProjectProvider}
 * shares a single document + autosave across the top bar, canvas stage, and
 * dialogs. With `autoWelcome`, first run (no autosave) opens the Welcome dialog.
 */
export function ProjectWorkbench({
  store,
  persistence,
  autoWelcome = false,
}: ProjectWorkbenchProps) {
  const [firstRun, setFirstRun] = useState(false);
  return (
    <ProjectProvider
      store={store}
      persistence={persistence}
      onFirstRun={autoWelcome ? () => setFirstRun(true) : undefined}
    >
      <WorkbenchBody firstRun={firstRun} onDismissFirstRun={() => setFirstRun(false)} />
    </ProjectProvider>
  );
}

export default ProjectWorkbench;
