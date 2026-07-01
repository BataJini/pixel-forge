import { useCallback, useEffect } from 'react';
import { type BlipKind, playBlip, resumeAudio } from '../../platform/audio';
import { useTheme } from '../theme/useTheme';

/**
 * Wire the chiptune blip engine to the user's (muted-by-default) sound
 * preference. Returns a `play(kind)` that no-ops silently while sound is off.
 *
 * The shared AudioContext is only created + resumed AFTER sound is enabled and
 * the user makes a gesture — so a fresh, silent load never instantiates audio
 * and never triggers the browser's autoplay-policy console warning.
 */
export function useUiSound(): (kind: BlipKind) => void {
  const { soundEnabled } = useTheme();

  useEffect(() => {
    if (!soundEnabled || typeof window === 'undefined') {
      return;
    }
    let resumed = false;
    const onGesture = () => {
      if (resumed) {
        return;
      }
      resumed = true;
      void resumeAudio();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [soundEnabled]);

  return useCallback(
    (kind: BlipKind) => {
      playBlip(kind, { enabled: soundEnabled });
    },
    [soundEnabled],
  );
}
