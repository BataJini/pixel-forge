import { Panel } from '../components/Panel';
import { AnvilPreview } from './AnvilPreview';
import { ControlsDemo } from './ControlsDemo';
import { CrtControls, SoundToggle, StatusBar, Swatches, ThemeSwitcher } from './parts';
import './showcase.css';

/**
 * U-002 design-system surface: the bespoke Arcade-CRT-over-Forge chrome, every
 * reusable primitive (Button/Panel/Slider/Dialog/Frame), the signature anvil
 * well, and live theme / CRT / sound controls. This is the visual proof for the
 * unit; the full workbench layout arrives in U-012.
 */
export function DesignShowcase() {
  return (
    <main className="pf-shell">
      <header className="pf-topbar">
        <div className="pf-brand">
          <h1 className="pf-wordmark pf-display pf-display-lg">PixelForge</h1>
          <p className="pf-tagline pf-ui pf-ui-sm">Hammer pixels into sprites.</p>
        </div>
        <div className="pf-topbar__controls">
          <SoundToggle />
        </div>
      </header>

      <div className="pf-grid">
        <Panel title="Anvil" className="pf-grid__anvil">
          <AnvilPreview />
        </Panel>

        <Panel title="Controls" className="pf-grid__controls">
          <ControlsDemo />
        </Panel>

        <Panel title="Theme" className="pf-grid__theme">
          <ThemeSwitcher />
          <p className="pf-hint pf-ui pf-ui-sm">
            Selecting a hardware palette re-tempers the whole workshop's accent ramp.
          </p>
          <Swatches />
        </Panel>

        <Panel title="CRT display layer" className="pf-grid__crt">
          <CrtControls />
          <p className="pf-hint pf-ui pf-ui-sm">
            Arcade CRT ships Subtle by default. Clean mode strips scanlines + glow. Reduced-motion
            freezes flicker &amp; sweep automatically.
          </p>
        </Panel>
      </div>

      <StatusBar />
    </main>
  );
}
