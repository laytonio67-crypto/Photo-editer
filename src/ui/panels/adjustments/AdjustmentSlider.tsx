import { useRef, type CSSProperties } from 'react';
import { NumberField } from '../../controls/NumberField';
import controls from '../../controls/controls.module.css';
import styles from './Adjustments.module.css';
import { onPointerRelease } from './useAdjustmentEdit';

export interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  unit?: string;
  /** Value restored by double-clicking the label. */
  defaultValue: number;
  /** CSS background for the slider track (hints at the effect). */
  track?: string;
  disabled?: boolean;
  /** Gesture hooks (see useAdjustmentEdit). */
  onBegin: () => void;
  onEnd: () => void;
  /** `gesture` is false for one-off changes (typing, arrow keys). */
  onValue: (value: number, gesture: boolean) => void;
}

/** Labelled slider + numeric field; dragging either records one history entry. */
export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  unit,
  defaultValue,
  track,
  disabled,
  onBegin,
  onEnd,
  onValue,
}: AdjustmentSliderProps) {
  const dragging = useRef(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={styles.slider}>
      <div className={styles.sliderHead}>
        <span className={styles.sliderLabel} title="Double-click to reset" onDoubleClick={() => onValue(defaultValue, false)}>
          {label}
        </span>
        <NumberField
          value={value}
          min={min}
          max={max}
          step={step}
          precision={precision}
          unit={unit}
          width={unit ? 74 : 60}
          ariaLabel={label}
          disabled={disabled}
          onScrubStart={onBegin}
          onInput={(v) => onValue(v, true)}
          onScrubEnd={onEnd}
          onChange={(v) => onValue(v, false)}
        />
      </div>
      <input
        type="range"
        className={`${controls.range} ${styles.range}`}
        style={track ? ({ '--track': track } as CSSProperties) : undefined}
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={() => {
          dragging.current = true;
          onBegin();
          onPointerRelease(() => {
            dragging.current = false;
            onEnd();
          });
        }}
        onChange={(e) => onValue(clamp(Number(e.target.value)), dragging.current)}
      />
    </div>
  );
}
