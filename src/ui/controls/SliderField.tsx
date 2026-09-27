import { NumberField } from './NumberField';
import styles from './controls.module.css';

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  precision?: number;
  /** Slider width in px. */
  sliderWidth?: number;
  fieldWidth?: number;
  /** Map the slider logarithmically (useful for brush sizes). */
  logarithmic?: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** Compact label + range slider + numeric field, for option bars. */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  precision = 0,
  sliderWidth = 72,
  fieldWidth = 62,
  logarithmic = false,
  disabled,
  onChange,
}: SliderFieldProps) {
  const toSlider = (v: number): number =>
    logarithmic ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v;
  const fromSlider = (s: number): number => {
    const v = logarithmic ? min * Math.pow(max / min, s / 1000) : s;
    const factor = Math.pow(10, precision);
    return Math.min(max, Math.max(min, Math.round(v * factor) / factor));
  };
  return (
    <div className={styles.sliderField}>
      <span className={styles.sliderFieldLabel}>{label}</span>
      <input
        type="range"
        className={styles.range}
        style={{ width: sliderWidth }}
        aria-label={`${label} slider`}
        min={logarithmic ? 0 : min}
        max={logarithmic ? 1000 : max}
        step={logarithmic ? 1 : step}
        value={toSlider(value)}
        disabled={disabled}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
      />
      <NumberField
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        precision={precision}
        width={fieldWidth}
        disabled={disabled}
        ariaLabel={label}
        onChange={onChange}
      />
    </div>
  );
}
