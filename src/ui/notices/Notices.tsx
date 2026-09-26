import { X } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import styles from './Notices.module.css';

/** Toast-style notices (errors stay until dismissed). */
export function Notices() {
  const editor = useEditor();
  const notices = useEditorState((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className={styles.stack} aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={styles.notice} data-kind={n.kind} role={n.kind === 'error' ? 'alert' : 'status'}>
          <div className={styles.text}>
            <div>{n.message}</div>
            {n.detail && <div className={styles.detail}>{n.detail}</div>}
          </div>
          <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => editor.dismissNotice(n.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
