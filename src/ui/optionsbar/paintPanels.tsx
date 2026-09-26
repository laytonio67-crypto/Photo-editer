import { useEditor, useEditorState } from '../editorContext';
import { SliderField } from '../controls/SliderField';
import controls from '../controls/controls.module.css';
import type { BrushOptions } from '../../engine/tools/options';
import styles from './OptionsBar.module.css';

/** Brush / Eraser options: size, hardness, opacity, flow, smoothing, pressure. */
export function BrushOptionsPanel({ tool }: { tool: 'brush' | 'eraser' }) {
  const editor = useEditor();
  const opts = useEditorState((s) => s.toolOptions[tool]);
  const set = (patch: Partial<BrushOptions>): void => {
    editor.setToolOptions(tool, patch);
    editor.tools.refreshCursor();
  };
  return (
    <>
      <SliderField label="Size" unit="px" value={opts.size} min={1} max={5000} logarithmic onChange={(size) => set({ size })} />
      <SliderField
        label="Hardness"
        unit="%"
        value={Math.round(opts.hardness * 100)}
        min={0}
        max={100}
        onChange={(v) => set({ hardness: v / 100 })}
      />
      <span className={styles.divider} />
      <SliderField
        label="Opacity"
        unit="%"
        value={Math.round(opts.opacity * 100)}
        min={1}
        max={100}
        onChange={(v) => set({ opacity: v / 100 })}
      />
      <SliderField label="Flow" unit="%" value={Math.round(opts.flow * 100)} min={1} max={100} onChange={(v) => set({ flow: v / 100 })} />
      <SliderField
        label="Smoothing"
        unit="%"
        value={Math.round(opts.smoothing * 100)}
        min={0}
        max={100}
        onChange={(v) => set({ smoothing: v / 100 })}
      />
      <span className={styles.divider} />
      <label className={controls.checkbox} title="Pen pressure controls the brush size">
        <input type="checkbox" checked={opts.pressureSize} onChange={(e) => set({ pressureSize: e.target.checked })} />
        Pressure size
      </label>
      <label className={controls.checkbox} title="Pen pressure controls the flow">
        <input type="checkbox" checked={opts.pressureOpacity} onChange={(e) => set({ pressureOpacity: e.target.checked })} />
        Pressure flow
      </label>
    </>
  );
}

export function EyedropperOptionsPanel() {
  const editor = useEditor();
  const opts = useEditorState((s) => s.toolOptions.eyedropper);
  return (
    <>
      <label className={styles.group}>
        <span className={styles.label}>Sample size</span>
        <select
          className={controls.select}
          value={opts.sampleSize}
          onChange={(e) => editor.setToolOptions('eyedropper', { sampleSize: Number(e.target.value) as 1 | 3 | 5 })}
        >
          <option value={1}>Point sample</option>
          <option value={3}>3 × 3 average</option>
          <option value={5}>5 × 5 average</option>
        </select>
      </label>
      <label className={styles.group}>
        <span className={styles.label}>Sample</span>
        <select
          className={controls.select}
          value={opts.sample}
          onChange={(e) => editor.setToolOptions('eyedropper', { sample: e.target.value as 'all' | 'current' })}
        >
          <option value="all">All layers</option>
          <option value="current">Current layer</option>
        </select>
      </label>
      <span className={styles.hint}>Click to pick the foreground colour · Alt-click for background</span>
    </>
  );
}
