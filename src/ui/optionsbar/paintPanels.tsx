import { useEditor, useEditorState } from '../editorContext';
import { SliderField } from '../controls/SliderField';
import controls from '../controls/controls.module.css';
import type { BrushOptions, CloneOptions } from '../../engine/tools/options';
import styles from './OptionsBar.module.css';

type StrokeToolId = 'brush' | 'eraser' | 'cloneStamp' | 'healingBrush';

/** Brush / Eraser options: size, hardness, opacity, flow, smoothing, pressure. */
export function BrushOptionsPanel({ tool }: { tool: StrokeToolId }) {
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
          onChange={(e) =>
            editor.setToolOptions('eyedropper', {
              sampleSize: Number(e.target.value) as 1 | 3 | 5,
            })
          }
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
          onChange={(e) =>
            editor.setToolOptions('eyedropper', {
              sample: e.target.value as 'all' | 'current',
            })
          }
        >
          <option value="all">All layers</option>
          <option value="current">Current layer</option>
        </select>
      </label>
      <span className={styles.hint}>Click to pick the foreground colour · Alt-click for background</span>
    </>
  );
}

/** Clone Stamp / Healing Brush: brush settings plus source alignment and sampling. */
export function CloneOptionsPanel({ tool }: { tool: 'cloneStamp' | 'healingBrush' }) {
  const editor = useEditor();
  const opts = useEditorState((s) => s.toolOptions[tool]);
  const set = (patch: Partial<CloneOptions>): void => editor.setToolOptions(tool, patch);
  return (
    <>
      <SliderField
        label="Size"
        unit="px"
        value={opts.size}
        min={1}
        max={5000}
        logarithmic
        onChange={(size) => {
          set({ size });
          editor.tools.refreshCursor();
        }}
      />
      <SliderField
        label="Hardness"
        unit="%"
        value={Math.round(opts.hardness * 100)}
        min={0}
        max={100}
        onChange={(v) => set({ hardness: v / 100 })}
      />
      <SliderField
        label="Opacity"
        unit="%"
        value={Math.round(opts.opacity * 100)}
        min={1}
        max={100}
        onChange={(v) => set({ opacity: v / 100 })}
      />
      {tool === 'cloneStamp' && (
        <SliderField label="Flow" unit="%" value={Math.round(opts.flow * 100)} min={1} max={100} onChange={(v) => set({ flow: v / 100 })} />
      )}
      <span className={styles.divider} />
      <label className={controls.checkbox} title="Keep the source offset between strokes">
        <input type="checkbox" checked={opts.aligned} onChange={(e) => set({ aligned: e.target.checked })} />
        Aligned
      </label>
      <label className={styles.group}>
        <span className={styles.label}>Sample</span>
        <select className={controls.select} value={opts.sample} onChange={(e) => set({ sample: e.target.value as 'current' | 'all' })}>
          <option value="current">Current layer</option>
          <option value="all">All layers</option>
        </select>
      </label>
      <span className={styles.hint}>
        Alt-click to set the source
        {tool === 'healingBrush' ? ' · blends into the surroundings on release' : ''}
      </span>
    </>
  );
}
