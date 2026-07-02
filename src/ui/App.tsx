import { effectivePaintColor } from '../state/colorStore';
import { CanvasStage } from './CanvasStage';
import { ColorPalettePanel } from './color/ColorPalettePanel';
import { ColorProvider, useColorStore } from './color/ColorProvider';
import { CrtOverlay } from './components/CrtOverlay';
import { TimelinePanel } from './frames';
import { LayersPanel } from './layers';
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
 * U-003) alongside a right dock of workbench panels: the Color & Palette panel
 * (`ColorPalettePanel`, U-005) — whose foreground color drives the canvas pencil,
 * so picking/loading colors is demonstrably wired to the artwork — and the Layers
 * panel (`LayersPanel`, U-007) with its own undoable layer stack (add/duplicate/
 * delete/rename/reorder/lock/opacity/merge/flatten over a live composite preview),
 * and the Frames / timeline panel (`TimelinePanel`, U-008) with its own undoable
 * frame stack (add/duplicate/delete/reorder frames, per-frame duration, FPS, play/
 * pause/stop/loop/ping-pong playback, and onion-skin ghosts over a live preview).
 * In indexed / palette-lock mode the pencil is
 * fed `effectivePaintColor` (the fg snapped to the active palette) and the stage
 * quantizes / palette-swaps its buffer, so drawing is genuinely restricted to the
 * palette. The full workbench layout — menu bar, tool rack, dockable panels, the
 * U-002 design-system showcase — is assembled in U-012. Styling uses only design
 * tokens and hard-edged bevels.
 */
function AppBody() {
  const { renderedCrtLevel } = useTheme();
  const { state } = useColorStore();
  return (
    <div className="pf-app">
      <header className="pf-topbar">
        <h1 className="pf-wordmark">PixelForge</h1>
        <span className="pf-ingot" aria-hidden="true" />
        <p className="pf-tagline">Hammer pixels into sprites.</p>
      </header>
      <main className="pf-workbench" aria-label="Workbench">
        <CanvasStage
          paintColor={effectivePaintColor(state)}
          indexed={state.indexed}
          palette={state.palette}
        />
        <div className="pf-dock">
          <ColorPalettePanel standalone={false} />
          <LayersPanel />
          <TimelinePanel />
        </div>
      </main>
      <CrtOverlay level={renderedCrtLevel} />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ColorProvider>
        <AppBody />
      </ColorProvider>
    </ThemeProvider>
  );
}

export default App;
