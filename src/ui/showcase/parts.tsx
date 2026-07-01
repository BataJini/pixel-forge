import { Button } from '../components/Button';
import { useUiSound } from '../hooks/useUiSound';
import { CRT_LEVELS } from '../theme/crt';
import { CSS_VAR, THEME_IDS, THEMES, TOKEN_KEYS } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

/** Re-temper the whole workshop by switching the chrome theme (signature move). */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const play = useUiSound();
  return (
    <div className="pf-switch" role="toolbar" aria-label="Theme">
      {THEME_IDS.map((id) => (
        <Button
          key={id}
          size="sm"
          active={theme === id}
          aria-pressed={theme === id}
          title={THEMES[id].blurb}
          onClick={() => {
            setTheme(id);
            play('toggle');
          }}
        >
          {THEMES[id].label}
        </Button>
      ))}
    </div>
  );
}

/** CRT level (Off/Subtle/Full) + one-click clean-mode escape hatch. */
export function CrtControls() {
  const { crtLevel, setCrtLevel, cleanMode, toggleCleanMode } = useTheme();
  const play = useUiSound();
  return (
    <div className="pf-switch" role="toolbar" aria-label="CRT display layer">
      {CRT_LEVELS.map((level) => (
        <Button
          key={level}
          size="sm"
          active={!cleanMode && crtLevel === level}
          aria-pressed={!cleanMode && crtLevel === level}
          onClick={() => {
            setCrtLevel(level);
            play('click');
          }}
        >
          {level}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={cleanMode}
        active={cleanMode}
        title="Remove scanlines + glow entirely"
        onClick={() => {
          toggleCleanMode();
          play('click');
        }}
      >
        Clean
      </Button>
    </div>
  );
}

/** The live 13-token ramp for the active theme (reads CSS vars). */
export function Swatches() {
  return (
    <ul className="pf-swatches" aria-label="Active palette ramp">
      {TOKEN_KEYS.map((key) => (
        <li key={key} className="pf-swatches__item">
          <span className="pf-swatches__chip" style={{ backgroundColor: `var(${CSS_VAR[key]})` }} />
          <span className="pf-swatches__name pf-label">{key}</span>
        </li>
      ))}
    </ul>
  );
}

/** Muted-by-default sound toggle (reduce-sound preference). */
export function SoundToggle() {
  const { soundEnabled, setSoundEnabled } = useTheme();
  const play = useUiSound();
  return (
    <Button
      size="sm"
      variant={soundEnabled ? 'primary' : 'default'}
      aria-pressed={soundEnabled}
      onClick={() => {
        const next = !soundEnabled;
        setSoundEnabled(next);
        if (next) {
          play('success');
        }
      }}
    >
      Sound: {soundEnabled ? 'On' : 'Off'}
    </Button>
  );
}

/** Bottom status readout (VT323). */
export function StatusBar() {
  const { theme, crtLevel, cleanMode, soundEnabled } = useTheme();
  return (
    <div className="pf-statusbar pf-readout" role="status">
      <span>THEME {THEMES[theme].label}</span>
      <span>CRT {cleanMode ? 'CLEAN' : crtLevel.toUpperCase()}</span>
      <span>SFX {soundEnabled ? 'ON' : 'OFF'}</span>
      <span>GRID {'—'} 2PX</span>
    </div>
  );
}
