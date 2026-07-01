import './App.css';

/**
 * Minimal, brand-safe application shell for U-001.
 *
 * Deliberately tiny: it proves the toolchain (build/test/lint/typecheck/E2E)
 * and the design-token layer without baking in a full design system — the
 * workbench layout, retro chrome, and CRT display layer are built in U-002+.
 * Uses only design tokens and hard-edged bevels; no forbidden techniques.
 */
export function App() {
  return (
    <main className="pf-shell">
      <section className="pf-plate" aria-labelledby="pf-title">
        <h1 id="pf-title" className="pf-wordmark">
          PixelForge
        </h1>
        <div className="pf-ingot" aria-hidden="true" />
        <p className="pf-tagline">Hammer pixels into sprites.</p>
        <p className="pf-status">
          Scaffold ready — the engine, tools, and forge chrome arrive in later units.
        </p>
      </section>
    </main>
  );
}

export default App;
