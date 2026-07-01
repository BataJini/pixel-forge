import { describe, expect, it } from 'vitest';
import { type BlipKind, disposeAudio, isAudioSupported, playBlip, resumeAudio } from './audio';

/**
 * Node environment (no `window`/WebAudio). Verifies the muted-by-default and
 * result-envelope contracts without a real AudioContext. Actual sound output is
 * exercised by hand/QA in a browser.
 */
describe('audio blip engine (headless)', () => {
  it('reports WebAudio as unsupported without a window', () => {
    expect(isAudioSupported()).toBe(false);
  });

  it('is a silent no-op success when sound is disabled (default)', () => {
    for (const kind of ['hover', 'click', 'toggle', 'success', 'error'] as BlipKind[]) {
      const result = playBlip(kind, { enabled: false });
      expect(result.ok).toBe(true);
    }
  });

  it('returns an error envelope (never throws) when enabled but unsupported', () => {
    const result = playBlip('click', { enabled: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(typeof result.error.message).toBe('string');
    }
  });

  it('resumeAudio reports unsupported without a window', async () => {
    const result = await resumeAudio();
    expect(result.ok).toBe(false);
  });

  it('disposeAudio resolves even when no context exists', async () => {
    await expect(disposeAudio()).resolves.toBeUndefined();
  });
});
