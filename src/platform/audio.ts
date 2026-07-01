/**
 * Chiptune UI SFX — tiny WebAudio square/triangle blips (design-direction.md).
 *
 * SHIPPED MUTED (constitution a11y: audio off by default; honor reduce-sound).
 * Callers gate every play on the user's `soundEnabled` preference. A single
 * shared AudioContext is created lazily and resumed on the first user gesture
 * (browser autoplay policy). Browser glue lives here in `src/platform`, isolated
 * from the pure engine and UI. Fallible ops return the constitution's result
 * envelope; a disabled call is a successful no-op.
 */

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export type BlipKind = 'hover' | 'click' | 'toggle' | 'success' | 'error';

interface BlipSpec {
  readonly type: OscillatorType;
  /** Frequency waypoints in Hz; stepped (no glide) for chiptune feel. */
  readonly freqs: readonly number[];
  /** Total duration in seconds. */
  readonly dur: number;
  /** Peak gain (kept low; UI blips are quiet). */
  readonly gain: number;
}

const BLIPS: Readonly<Record<BlipKind, BlipSpec>> = {
  hover: { type: 'square', freqs: [740], dur: 0.03, gain: 0.02 },
  click: { type: 'square', freqs: [523, 784], dur: 0.06, gain: 0.05 },
  toggle: { type: 'triangle', freqs: [392, 587], dur: 0.07, gain: 0.05 },
  success: { type: 'square', freqs: [523, 659, 988], dur: 0.16, gain: 0.05 },
  error: { type: 'square', freqs: [311, 233], dur: 0.18, gain: 0.06 },
};

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let sharedContext: AudioContext | null = null;

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/** Whether WebAudio is available in this environment. */
export function isAudioSupported(): boolean {
  return getAudioContextCtor() !== null;
}

/**
 * Lazily get the single shared AudioContext, or null if unsupported. Never
 * creates more than one context for the whole app.
 */
export function getSharedAudioContext(): AudioContext | null {
  if (sharedContext) {
    return sharedContext;
  }
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    return null;
  }
  sharedContext = new Ctor();
  return sharedContext;
}

/**
 * Resume the shared context — call from a user-gesture handler so subsequent
 * blips are audible under the autoplay policy. Safe to call repeatedly.
 */
export async function resumeAudio(): Promise<Result<void>> {
  const ctx = getSharedAudioContext();
  if (!ctx) {
    return fail('unsupported', 'WebAudio is not available in this environment.');
  }
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ok(undefined);
  } catch (error) {
    return fail(
      'resume-failed',
      error instanceof Error ? error.message : 'Could not resume audio.',
    );
  }
}

/**
 * Play a UI blip. No-ops successfully when `enabled` is false (the default, so
 * the app is silent unless the user opts in). Returns an error result only on a
 * genuine WebAudio failure — never throws across the module boundary.
 */
export function playBlip(kind: BlipKind, options: { readonly enabled: boolean }): Result<void> {
  if (!options.enabled) {
    return ok(undefined);
  }
  const ctx = getSharedAudioContext();
  if (!ctx) {
    return fail('unsupported', 'WebAudio is not available in this environment.');
  }
  const spec = BLIPS[kind];
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type;

    const step = spec.dur / spec.freqs.length;
    spec.freqs.forEach((hz, i) => {
      osc.frequency.setValueAtTime(hz, now + i * step);
    });

    // Fast attack, short exponential decay — a clean 8-bit "blip", no click.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.gain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + spec.dur + 0.02);
    return ok(undefined);
  } catch (error) {
    return fail('play-failed', error instanceof Error ? error.message : 'Could not play audio.');
  }
}

/** Test/teardown seam: close and drop the shared context. */
export async function disposeAudio(): Promise<void> {
  if (sharedContext) {
    try {
      await sharedContext.close();
    } catch {
      // ignore — context may already be closed.
    }
    sharedContext = null;
  }
}
