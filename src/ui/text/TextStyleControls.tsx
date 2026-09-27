import { AlignCenter, AlignLeft, AlignRight, Italic } from 'lucide-react';
import type { TextAlign, TextStyle } from '../../engine/doc/types';
import { ColorSwatch } from '../color/ColorSwatch';
import { NumberField } from '../controls/NumberField';
import controls from '../controls/controls.module.css';
import optionStyles from '../optionsbar/OptionsBar.module.css';
import { FONT_FAMILIES, FONT_WEIGHTS } from './fonts';
import styles from './Text.module.css';

interface TextStyleControlsProps {
  value: TextStyle;
  /** `mergeKey` groups continuous changes (scrubbing, colour dragging) into one edit. */
  onChange: (patch: Partial<TextStyle>, mergeKey?: string) => void;
  /** 'bar': one row for the options bar; 'panel': stacked rows for the Properties panel. */
  layout: 'bar' | 'panel';
  disabled?: boolean;
}

const ALIGNS: { value: TextAlign; label: string; icon: React.ReactNode }[] = [
  { value: 'left', label: 'Align left', icon: <AlignLeft size={14} /> },
  { value: 'center', label: 'Align center', icon: <AlignCenter size={14} /> },
  { value: 'right', label: 'Align right', icon: <AlignRight size={14} /> },
];

/** Font, size, colour, alignment and spacing controls for text layers. */
export function TextStyleControls({ value, onChange, layout, disabled }: TextStyleControlsProps) {
  const families = FONT_FAMILIES.includes(value.fontFamily) ? FONT_FAMILIES : [value.fontFamily, ...FONT_FAMILIES];
  const family = (
    <select
      className={`${controls.select} ${styles.family}`}
      aria-label="Font family"
      value={value.fontFamily}
      disabled={disabled}
      onChange={(e) => onChange({ fontFamily: e.target.value })}
    >
      {families.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>
          {f}
        </option>
      ))}
    </select>
  );
  const weight = (
    <select
      className={controls.select}
      aria-label="Font weight"
      value={value.fontWeight}
      disabled={disabled}
      onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
    >
      {FONT_WEIGHTS.map((w) => (
        <option key={w.value} value={w.value}>
          {w.label}
        </option>
      ))}
    </select>
  );
  const italic = (
    <div className={optionStyles.segmented}>
      <button
        type="button"
        aria-label="Italic"
        title="Italic"
        aria-pressed={value.italic}
        disabled={disabled}
        onClick={() => onChange({ italic: !value.italic })}
      >
        <Italic size={14} />
      </button>
    </div>
  );
  const size = (
    <NumberField
      label={layout === 'bar' ? 'Size' : undefined}
      ariaLabel="Font size"
      unit="px"
      value={value.fontSize}
      min={1}
      max={2000}
      precision={1}
      width={layout === 'bar' ? 92 : 80}
      disabled={disabled}
      onInput={(v) => onChange({ fontSize: v }, 'fontSize')}
      onChange={(v) => onChange({ fontSize: v })}
    />
  );
  const color = (
    <ColorSwatch
      className={styles.swatch}
      color={value.color}
      label="Text color"
      onChange={(c) => onChange({ color: c }, 'textColor')}
    />
  );
  const align = (
    <div className={optionStyles.segmented} role="radiogroup" aria-label="Alignment">
      {ALIGNS.map((a) => (
        <button
          key={a.value}
          type="button"
          role="radio"
          aria-label={a.label}
          title={a.label}
          aria-checked={value.align === a.value}
          aria-pressed={value.align === a.value}
          disabled={disabled}
          onClick={() => onChange({ align: a.value })}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
  const leading = (
    <NumberField
      label={layout === 'bar' ? 'Leading' : undefined}
      ariaLabel="Line height"
      unit="×"
      value={value.lineHeight}
      min={0.5}
      max={5}
      step={0.05}
      precision={2}
      width={layout === 'bar' ? 104 : 80}
      disabled={disabled}
      onInput={(v) => onChange({ lineHeight: v }, 'lineHeight')}
      onChange={(v) => onChange({ lineHeight: v })}
    />
  );
  const tracking = (
    <NumberField
      label={layout === 'bar' ? 'Tracking' : undefined}
      ariaLabel="Letter spacing"
      unit="px"
      value={value.letterSpacing}
      min={-100}
      max={500}
      step={0.5}
      precision={1}
      width={layout === 'bar' ? 104 : 80}
      disabled={disabled}
      onInput={(v) => onChange({ letterSpacing: v }, 'letterSpacing')}
      onChange={(v) => onChange({ letterSpacing: v })}
    />
  );

  if (layout === 'bar') {
    return (
      <>
        {family}
        {weight}
        {italic}
        {size}
        {color}
        <span className={optionStyles.divider} />
        {align}
        {leading}
        {tracking}
      </>
    );
  }
  return (
    <div className={styles.panel}>
      <div className={styles.row}>{family}</div>
      <div className={styles.row}>
        {weight}
        {italic}
        {color}
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Size</span>
        {size}
        {align}
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Leading</span>
        {leading}
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Tracking</span>
        {tracking}
      </div>
    </div>
  );
}
