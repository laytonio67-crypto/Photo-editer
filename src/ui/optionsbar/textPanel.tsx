import { Check, X } from 'lucide-react';
import { applyTextStyle, currentTextStyle, sameTextStyle } from '../../engine/actions/textActions';
import { IconButton } from '../controls/Button';
import { useEditor, useEditorState } from '../editorContext';
import { TextStyleControls } from '../text/TextStyleControls';
import styles from './OptionsBar.module.css';

/** Text tool options: style of the edited/selected text (or of new text). */
export function TextOptions() {
  const editor = useEditor();
  const style = useEditorState(currentTextStyle, sameTextStyle);
  const editing = useEditorState((s) => s.textEditing !== null);
  return (
    <>
      <TextStyleControls layout="bar" value={style} onChange={(patch, mergeKey) => applyTextStyle(editor, patch, mergeKey)} />
      <span className={styles.divider} />
      {editing ? (
        <>
          <IconButton size="small" label="Commit text" shortcut="Esc" icon={<Check size={15} />} onClick={() => editor.textTool.commit()} />
          <IconButton size="small" label="Cancel editing" icon={<X size={15} />} onClick={() => editor.textTool.cancel()} />
        </>
      ) : (
        <span className={styles.hint}>Click to add text · click text to edit it</span>
      )}
    </>
  );
}
