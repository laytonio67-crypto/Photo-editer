import { Fragment } from 'react';
import { ArrowLeftRight, Square } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { IconButton } from '../controls/Button';
import { formatShortcut } from '../../app/shortcuts';
import { ColorSwatch } from '../color/ColorSwatch';
import { TOOL_DEFS } from './toolDefs';
import styles from './Toolbar.module.css';

export function Toolbar({ className }: { className?: string }) {
  const editor = useEditor();
  const tool = useEditorState((s) => s.tool);
  const foreground = useEditorState((s) => s.foreground);
  const background = useEditorState((s) => s.background);
  const available = TOOL_DEFS.filter((t) => editor.tools.has(t.id));

  return (
    <aside className={`${styles.toolbar} ${className ?? ''}`} aria-label="Tools" role="toolbar" aria-orientation="vertical">
      {available.map((def, i) => (
        <Fragment key={def.id}>
          {i > 0 && available[i - 1]!.group !== def.group && <div className={styles.separator} />}
          <IconButton
            className={styles.tool}
            label={def.label}
            shortcut={formatShortcut(def.shortcut)}
            icon={def.icon}
            pressed={tool === def.id}
            onClick={() => editor.setTool(def.id)}
          />
        </Fragment>
      ))}
      <div className={styles.spacer} />
      <div className={styles.colors}>
        <ColorSwatch
          className={`${styles.swatch} ${styles.fg}`}
          color={foreground}
          label="Foreground color"
          onChange={(c) => editor.setColors({ foreground: c })}
        />
        <ColorSwatch
          className={`${styles.swatch} ${styles.bg}`}
          color={background}
          label="Background color"
          onChange={(c) => editor.setColors({ background: c })}
        />
        <button
          type="button"
          className={styles.swap}
          aria-label="Swap colors"
          title={`Swap colors (${formatShortcut('X')})`}
          onClick={() => editor.swapColors()}
        >
          <ArrowLeftRight size={10} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.reset}
          aria-label="Default colors"
          title={`Default colors (${formatShortcut('D')})`}
          onClick={() => editor.resetColors()}
        >
          <Square size={8} strokeWidth={2.4} />
        </button>
      </div>
    </aside>
  );
}
