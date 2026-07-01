import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type Hsv, hsvToRgb, rgbaToHex, rgbToHsv, tryHexToRgba } from '../../core/color';
import type { RGBA } from '../../core/types';

const SV_W = 168;
const SV_H = 132;
const BAR_W = 168;
const BAR_H = 14;
const CHECK = 6;

export interface HsvPickerProps {
  readonly value: RGBA;
  readonly onChange: (color: RGBA) => void;
  /** Called when a value is committed (pointer up / hex enter) — for recents. */
  readonly onCommit?: (color: RGBA) => void;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Fraction (0..1) of a pointer within an element, clamped. */
function fractionOf(el: HTMLElement, clientX: number, clientY: number): { fx: number; fy: number } {
  const rect = el.getBoundingClientRect();
  return {
    fx: clamp01((clientX - rect.left) / rect.width),
    fy: clamp01((clientY - rect.top) / rect.height),
  };
}

function paintSvField(canvas: HTMLCanvasElement, hue: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const img = ctx.createImageData(SV_W, SV_H);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < SV_H; y++) {
    const v = 1 - y / (SV_H - 1);
    for (let x = 0; x < SV_W; x++) {
      const [r, g, b] = hsvToRgb(hue, x / (SV_W - 1), v);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      i += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintHueBar(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const img = ctx.createImageData(BAR_W, BAR_H);
  const d = img.data;
  for (let x = 0; x < BAR_W; x++) {
    const [r, g, b] = hsvToRgb((x / (BAR_W - 1)) * 360, 1, 1);
    for (let y = 0; y < BAR_H; y++) {
      const i = (y * BAR_W + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintAlphaBar(canvas: HTMLCanvasElement, color: RGBA): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const img = ctx.createImageData(BAR_W, BAR_H);
  const d = img.data;
  for (let y = 0; y < BAR_H; y++) {
    for (let x = 0; x < BAR_W; x++) {
      const a = x / (BAR_W - 1);
      const checker = ((x / CHECK) | 0) + ((y / CHECK) | 0);
      const base = checker % 2 === 0 ? 200 : 143;
      const i = (y * BAR_W + x) * 4;
      d[i] = Math.round(color[0] * a + base * (1 - a));
      d[i + 1] = Math.round(color[1] * a + base * (1 - a));
      d[i + 2] = Math.round(color[2] * a + base * (1 - a));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * HSV color picker: a saturation/value field, a hue bar, an alpha bar (all
 * rendered as true-color canvases — no CSS gradients on chrome), and a hex input.
 * Every surface is a focusable `role="slider"` operable with arrow keys (Shift =
 * coarse), so the picker is fully keyboard-accessible (WCAG 2.2 AA); the hex
 * input is an additional exact-entry path.
 *
 * Hue is held in internal state so it survives dragging into a gray (s=0), where
 * the RGB round-trip would otherwise lose it. External `value` changes resync.
 */
export function HsvPicker({ value, onChange, onCommit }: HsvPickerProps) {
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  const alphaRef = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(value));
  const [hexDraft, setHexDraft] = useState<string>(() => rgbaToHex(value, value[3] !== 255));
  const alpha = value[3];

  // Resync internal HSV when the external color no longer matches it (external
  // set), preserving the current hue when the new color is a pure gray.
  useEffect(() => {
    const current = hsvToRgb(hsv.h, hsv.s, hsv.v, alpha);
    if (current[0] === value[0] && current[1] === value[1] && current[2] === value[2]) {
      return;
    }
    const next = rgbToHsv(value);
    setHsv((prev) => ({ h: next.s === 0 ? prev.h : next.h, s: next.s, v: next.v }));
  }, [value, alpha, hsv]);

  useEffect(() => {
    setHexDraft(rgbaToHex(value, value[3] !== 255));
  }, [value]);

  useEffect(() => {
    const c = svRef.current;
    if (c) {
      c.width = SV_W;
      c.height = SV_H;
      paintSvField(c, hsv.h);
    }
  }, [hsv.h]);

  useEffect(() => {
    const c = hueRef.current;
    if (c) {
      c.width = BAR_W;
      c.height = BAR_H;
      paintHueBar(c);
    }
  }, []);

  useEffect(() => {
    const c = alphaRef.current;
    if (c) {
      c.width = BAR_W;
      c.height = BAR_H;
      paintAlphaBar(c, [value[0], value[1], value[2], 255]);
    }
  }, [value]);

  const emit = (h: number, s: number, v: number, a: number, commit = false): void => {
    setHsv({ h, s, v });
    const rgba = hsvToRgb(h, s, v, a);
    onChange(rgba);
    if (commit) {
      onCommit?.(rgba);
    }
  };

  const dragSv = (e: ReactPointerEvent<HTMLDivElement>, commit = false): void => {
    const { fx, fy } = fractionOf(e.currentTarget, e.clientX, e.clientY);
    emit(hsv.h, fx, 1 - fy, alpha, commit);
  };
  const dragHue = (e: ReactPointerEvent<HTMLDivElement>, commit = false): void => {
    const { fx } = fractionOf(e.currentTarget, e.clientX, e.clientY);
    emit(fx * 360, hsv.s, hsv.v, alpha, commit);
  };
  const dragAlpha = (e: ReactPointerEvent<HTMLDivElement>, commit = false): void => {
    const { fx } = fractionOf(e.currentTarget, e.clientX, e.clientY);
    emit(hsv.h, hsv.s, hsv.v, Math.round(fx * 255), commit);
  };

  const dragging = useRef(false);
  const onDown =
    (fn: (e: ReactPointerEvent<HTMLDivElement>, commit?: boolean) => void) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      fn(e);
    };
  const onMove =
    (fn: (e: ReactPointerEvent<HTMLDivElement>, commit?: boolean) => void) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (dragging.current) {
        fn(e);
      }
    };
  const onUp =
    (fn: (e: ReactPointerEvent<HTMLDivElement>, commit?: boolean) => void) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (dragging.current) {
        dragging.current = false;
        fn(e, true);
      }
    };

  const onSvKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') {
      emit(hsv.h, clamp01(hsv.s - step), hsv.v, alpha);
    } else if (e.key === 'ArrowRight') {
      emit(hsv.h, clamp01(hsv.s + step), hsv.v, alpha);
    } else if (e.key === 'ArrowUp') {
      emit(hsv.h, hsv.s, clamp01(hsv.v + step), alpha);
    } else if (e.key === 'ArrowDown') {
      emit(hsv.h, hsv.s, clamp01(hsv.v - step), alpha);
    } else {
      return;
    }
    e.preventDefault();
  };
  const onHueKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      emit(hsv.h - step, hsv.s, hsv.v, alpha);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      emit(hsv.h + step, hsv.s, hsv.v, alpha);
    } else {
      return;
    }
    e.preventDefault();
  };
  const onAlphaKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 16 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      emit(hsv.h, hsv.s, hsv.v, Math.max(0, alpha - step));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      emit(hsv.h, hsv.s, hsv.v, Math.min(255, alpha + step));
    } else {
      return;
    }
    e.preventDefault();
  };

  const commitHex = (): void => {
    const parsed = tryHexToRgba(hexDraft.trim());
    if (parsed.ok) {
      const next = rgbToHsv(parsed.value);
      setHsv((prev) => ({ h: next.s === 0 ? prev.h : next.h, s: next.s, v: next.v }));
      onChange(parsed.value);
      onCommit?.(parsed.value);
    } else {
      setHexDraft(rgbaToHex(value, value[3] !== 255));
    }
  };

  const svMarkerX = `${hsv.s * 100}%`;
  const svMarkerY = `${(1 - hsv.v) * 100}%`;
  const hueMarkerX = `${(hsv.h / 360) * 100}%`;
  const alphaMarkerX = `${(alpha / 255) * 100}%`;

  return (
    <div className="pf-picker">
      <div
        className="pf-picker__sv"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onPointerDown={onDown(dragSv)}
        onPointerMove={onMove(dragSv)}
        onPointerUp={onUp(dragSv)}
        onPointerCancel={onUp(dragSv)}
        onKeyDown={onSvKey}
      >
        <canvas ref={svRef} className="pf-picker__canvas" />
        <span className="pf-picker__ring" style={{ left: svMarkerX, top: svMarkerY }} />
      </div>

      <div
        className="pf-picker__bar"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`${Math.round(hsv.h)} degrees`}
        onPointerDown={onDown(dragHue)}
        onPointerMove={onMove(dragHue)}
        onPointerUp={onUp(dragHue)}
        onPointerCancel={onUp(dragHue)}
        onKeyDown={onHueKey}
      >
        <canvas ref={hueRef} className="pf-picker__canvas" />
        <span className="pf-picker__thumb" style={{ left: hueMarkerX }} />
      </div>

      <div
        className="pf-picker__bar pf-picker__bar--alpha"
        role="slider"
        tabIndex={0}
        aria-label="Alpha"
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={alpha}
        onPointerDown={onDown(dragAlpha)}
        onPointerMove={onMove(dragAlpha)}
        onPointerUp={onUp(dragAlpha)}
        onPointerCancel={onUp(dragAlpha)}
        onKeyDown={onAlphaKey}
      >
        <canvas ref={alphaRef} className="pf-picker__canvas" />
        <span className="pf-picker__thumb" style={{ left: alphaMarkerX }} />
      </div>

      <label className="pf-picker__hex">
        <span className="pf-label">Hex</span>
        <input
          className="pf-picker__hexinput pf-readout"
          type="text"
          inputMode="text"
          spellCheck={false}
          value={hexDraft}
          aria-label="Hex color value"
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitHex();
            }
          }}
        />
      </label>
    </div>
  );
}
