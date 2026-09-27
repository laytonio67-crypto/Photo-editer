import { Square, SquareMinus, SquarePlus, SquaresIntersect } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { NumberField } from '../controls/NumberField';
import { SliderField } from '../controls/SliderField';
import controls from '../controls/controls.module.css';
import type { SelectionMode } from '../../engine/selection/SelectionOps';
import styles from './OptionsBar.module.css';

const MODES: { value: SelectionMode; label: string; icon: React.ReactNode }[] = [
  { value: 'replace', label: 'New selection', icon: <Square size={14} strokeWidth={1.7} /> },
  { value: 'add', label: 'Add to selection (Shift)', icon: <SquarePlus size={14} strokeWidth={1.7} /> },
  { value: 'subtract', label: 'Subtract from selection (Alt)', icon: <SquareMinus size={14} strokeWidth={1.7} /> },
  { value: 'intersect', label: 'Intersect with selection (Shift+Alt)', icon: <SquaresIntersect size={14} strokeWidth={1.7} /> },
];

function ModeButtons() {
  const editor = useEditor();
  const mode = useEditorState((s) => s.toolOptions.selection.mode);
  return (
    <div className={styles.segmented} role="radiogroup" aria-label="Selection mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          aria-pressed={mode === m.value}
          aria-label={m.label}
          title={m.label}
          onClick={() => editor.setToolOptions('selection', { mode: m.value })}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

export function SelectionOptions({ hint }: { hint: string }) {
  const editor = useEditor();
  const feather = useEditorState((s) => s.toolOptions.selection.feather);
  return (
    <>
      <ModeButtons />
      <span className={styles.divider} />
      <NumberField
        label="Feather"
        unit="px"
        value={feather}
        min={0}
        max={250}
        precision={1}
        width={112}
        onChange={(v) => editor.setToolOptions('selection', { feather: v })}
      />
      <span className={styles.hint}>{hint}</span>
    </>
  );
}

export function MagicWandOptions() {
  const editor = useEditor();
  const opts = useEditorState((s) => s.toolOptions.magicWand);
  return (
    <>
      <ModeButtons />
      <span className={styles.divider} />
      <SliderField
        label="Tolerance"
        value={opts.tolerance}
        min={0}
        max={255}
        onChange={(tolerance) => editor.setToolOptions('magicWand', { tolerance })}
      />
      <label className={controls.checkbox}>
        <input type="checkbox" checked={opts.contiguous} onChange={(e) => editor.setToolOptions('magicWand', { contiguous: e.target.checked })} />
        Contiguous
      </label>
      <label className={controls.checkbox}>
        <input type="checkbox" checked={opts.sampleAll} onChange={(e) => editor.setToolOptions('magicWand', { sampleAll: e.target.checked })} />
        Sample all layers
      </label>
    </>
  );
}
