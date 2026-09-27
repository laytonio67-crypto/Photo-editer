import { useState } from 'react';
import { Button } from '../controls/Button';
import { Modal } from '../controls/Modal';
import { useEditor, useEditorState } from '../editorContext';
import styles from '../dialogs/Dialogs.module.css';
import { saveProjectAs } from './projectActions';

/** Name prompt for the first save and for Save As. */
export function SaveProjectDialog({ saveAs }: { saveAs: boolean }) {
  const editor = useEditor();
  const docName = useEditorState((s) => s.doc?.name ?? 'Untitled');
  const project = useEditorState((s) => s.project);
  const [name, setName] = useState(saveAs && project ? `${project.name} copy` : docName);
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 0;

  const save = async (): Promise<void> => {
    if (!valid || saving) return;
    setSaving(true);
    const ok = await saveProjectAs(editor, { saveAs: true, name: name.trim() });
    if (ok) editor.closeDialog();
    else setSaving(false);
  };

  return (
    <Modal
      title={saveAs ? 'Save As' : 'Save Project'}
      width={400}
      onClose={() => editor.closeDialog()}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.label} htmlFor="project-name">
          Name
        </label>
        <input
          id="project-name"
          className={styles.text}
          value={name}
          maxLength={120}
          autoComplete="off"
          data-autofocus
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <p className={styles.note}>
          Projects keep layers, masks, text and adjustments. They are stored in this browser on this device.
        </p>
      </div>
    </Modal>
  );
}
