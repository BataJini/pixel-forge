import { CrtOverlay } from './components/CrtOverlay';
import { DesignShowcase } from './showcase/DesignShowcase';
import { ThemeProvider } from './theme/ThemeProvider';
import { useTheme } from './theme/useTheme';

/**
 * Application root for U-002 — the design system + retro chrome.
 *
 * `ThemeProvider` lives HERE (not in main.tsx) so the component renders fully
 * self-contained in tests. It renders the design-system showcase (the visual
 * proof for this unit) plus the CRT display layer, which sits above all content
 * as a pure, non-interactive overlay. The full workbench layout arrives in U-012.
 */
function AppBody() {
  const { renderedCrtLevel } = useTheme();
  return (
    <>
      <DesignShowcase />
      <CrtOverlay level={renderedCrtLevel} />
    </>
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
