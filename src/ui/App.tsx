import { CanvasStage } from './CanvasStage';
import { CrtOverlay } from './components/CrtOverlay';
import { ThemeProvider } from './theme/ThemeProvider';
import { useTheme } from './theme/useTheme';
import './App.css';

/**
 * Application root — integration of U-002 (design system + retro chrome) and
 * U-003 (canvas engine + render pipeline).
 *
 * `ThemeProvider` lives HERE (not in main.tsx) so the tree renders fully
 * self-contained in tests. It drives `data-theme`/`data-crt` and the
 * always-mounted, non-interactive `CrtOverlay` display layer (U-002). Below the
 * brand top bar, the workbench hosts the runnable canvas preview (`CanvasStage`,
 * U-003). Both roots are deliberate scaffolding: the full workbench layout —
 * menu bar, tool rack, dockable panels, the U-002 design-system showcase — is
 * assembled in U-012. Styling uses only design tokens and hard-edged bevels.
 */
function AppBody() {
  const { renderedCrtLevel } = useTheme();
  return (
    <div className="pf-app">
      <header className="pf-topbar">
        <h1 className="pf-wordmark">PixelForge</h1>
        <span className="pf-ingot" aria-hidden="true" />
        <p className="pf-tagline">Hammer pixels into sprites.</p>
      </header>
      <main className="pf-workbench" aria-label="Workbench">
        <CanvasStage />
      </main>
      <CrtOverlay level={renderedCrtLevel} />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppBody />
    </ThemeProvider>
  );
}

export default App;
