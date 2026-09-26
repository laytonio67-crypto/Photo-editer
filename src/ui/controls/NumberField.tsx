import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import styles from './controls.module.css';
import { evaluateExpression as evaluate } from './expression';

export interface NumberFieldProps {
  value: number;
  /** Called on commit (Enter, blur, arrow keys, scrub end). */
  onChange: (value: number) => void;
  /** Called continuously while scrubbing (live preview). */
  onInput?: (value: number) => void;
  /** Called when a scrub gesture starts/ends (for grouping history). */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown. */
  precision?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
  width?: number | string;
  ariaLabel?: string;
  title?: string;
}

function clampValue(v: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

function format(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(precision);
  return precision > 0 ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Numeric input in the style of pro creative tools: type a value or expression,
 * arrow keys step (Shift ×10), and dragging the label scrubs the value.
 */
export function NumberField({
  value,
  onChange,
  onInput,
  onScrubStart,
  onScrubEnd,
  min,
  max,
  step = 1,
  precision = 0,
  label,
  unit,
  disabled,
  width,
  ariaLabel,
  title,
}: NumberFieldProps) {
  // Text being typed; null when the field shows the formatted value.
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ x: number; start: number; value: number; moved: boolean } | null>(null);
  const text = draft ?? format(value, precision);

  const commit = (raw: string): void => {
    setDraft(null);
    const v = evaluate(raw);
    if (v === null) return;
    const next = clampValue(Number(v.toFixed(precision)), min, max);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      commit(text);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const base = evaluate(text) ?? value;
      const next = clampValue(Number((base + dir * step * (e.shiftKey ? 10 : 1)).toFixed(precision)), min, max);
      setDraft(format(next, precision));
      onChange(next);
    }
  };

  const onLabelDown = (e: PointerEvent<HTMLSpanElement>): void => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, start: value, value, moved: false };
  };

  const onLabelMove = (e: PointerEvent<HTMLSpanElement>): void => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) < 2) return;
    if (!s.moved) {
      s.moved = true;
      onScrubStart?.();
    }
    const speed = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const next = clampValue(Number((s.start + Math.round(dx) * step * speed).toFixed(precision)), min, max);
    if (next !== s.value) {
      s.value = next;
      (onInput ?? onChange)(next);
    }
  };

  const onLabelUp = (): void => {
    const s = scrub.current;
    scrub.current = null;
    if (!s || !s.moved) return;
    if (onInput) onChange(s.value);
    onScrubEnd?.();
  };

  return (
    <label className={styles.field} data-disabled={disabled ? 'true' : 'false'} style={{ width }} title={title}>
      {label && (
        <span
          className={styles.fieldLabel}
          data-scrub={disabled ? 'false' : 'true'}
          onPointerDown={onLabelDown}
          onPointerMove={onLabelMove}
          onPointerUp={onLabelUp}
          onPointerCancel={onLabelUp}
        >
          {label}
        </span>
      )}
      <input
        className={styles.fieldInput}
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel ?? label}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(format(value, precision));
          e.target.select();
        }}
        onBlur={() => {
          if (draft !== null) commit(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {unit && <span className={styles.fieldUnit}>{unit}</span>}
    </label>
  );
}
