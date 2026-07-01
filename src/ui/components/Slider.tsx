import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cx } from '../lib/cx';
import './slider.css';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label (associated to the input for a11y). */
  readonly label: ReactNode;
  /** Optional numeric readout shown at the right (VT323). */
  readonly valueLabel?: ReactNode;
}

/**
 * A range slider styled as a recessed groove with a raised Ember thumb. Wraps a
 * native `<input type="range">` so it is keyboard-operable and screen-reader
 * friendly for free; the label is programmatically associated via `htmlFor`.
 */
export function Slider({ label, valueLabel, id, className, ...rest }: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx('pf-slider', className)}>
      <div className="pf-slider__meta">
        <label className="pf-slider__label pf-label" htmlFor={inputId}>
          {label}
        </label>
        {valueLabel !== undefined && (
          <span className="pf-slider__value pf-readout">{valueLabel}</span>
        )}
      </div>
      <input id={inputId} className="pf-slider__input" type="range" {...rest} />
    </div>
  );
}
