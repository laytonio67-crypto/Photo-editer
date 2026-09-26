import type { LayerBlendMode } from '../../engine/doc/types';
import controls from '../controls/controls.module.css';
import { BLEND_MODE_GROUPS } from './blendModes';

interface BlendModeSelectProps {
  value: LayerBlendMode;
  onChange: (mode: LayerBlendMode) => void;
  allowPassThrough?: boolean;
  disabled?: boolean;
  className?: string;
}

export function BlendModeSelect({ value, onChange, allowPassThrough, disabled, className }: BlendModeSelectProps) {
  return (
    <select
      className={`${controls.select} ${className ?? ''}`}
      value={value}
      disabled={disabled}
      aria-label="Blend mode"
      onChange={(e) => onChange(e.target.value as LayerBlendMode)}
      // Arrow keys on a focused select cycle modes, like Shift+/- in pro editors.
    >
      {allowPassThrough && <option value="passThrough">Pass Through</option>}
      {BLEND_MODE_GROUPS.map((group, i) => (
        <optgroup key={i} label={i === 0 ? 'Basic' : ['Basic', 'Darken', 'Lighten', 'Contrast', 'Inversion', 'Component'][i]}>
          {group.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
