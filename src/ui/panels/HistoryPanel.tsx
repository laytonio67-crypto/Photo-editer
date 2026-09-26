import { useEffect, useRef } from 'react';
import { History as HistoryIcon, ImageIcon } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import panel from './Panel.module.css';
import styles from './HistoryPanel.module.css';

export function HistoryPanel() {
  const editor = useEditor();
  const history = useEditorState((s) => s.history);
  const hasDoc = useEditorState((s) => s.doc !== null);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [history.index, history.labels.length]);

  if (!hasDoc) return <p className={panel.empty}>Edits to the open document are listed here.</p>;

  const rows = [history.baseLabel, ...history.labels];
  return (
    <div className={styles.list} role="listbox" aria-label="History states">
      {rows.map((label, i) => (
        <button
          key={i}
          ref={i === history.index ? currentRef : undefined}
          type="button"
          role="option"
          aria-selected={i === history.index}
          className={styles.row}
          data-future={i > history.index}
          data-testid="history-row"
          onClick={() => void editor.goToHistory(i)}
        >
          {i === 0 ? <ImageIcon size={13} strokeWidth={1.6} /> : <HistoryIcon size={13} strokeWidth={1.6} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
