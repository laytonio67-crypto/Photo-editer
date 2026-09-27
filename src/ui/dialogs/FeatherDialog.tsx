import { useState } from 'react';
import { useEditor } from '../editorContext';
import { Modal } from '../controls/Modal';
import { Button } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import { featherSelectionAction } from '../../engine/actions/selectionActions';
import styles from './Dialogs.module.css';

export function FeatherDialog() {
  const editor = useEditor();
  const [radius, setRadius] = useState(10);
  const apply = (): void => {
    editor.closeDialog();
    if (radius > 0) featherSelectionAction(editor, radius);
  };
  return (
    <Modal
      title="Feather Selection"
      width={340}
      onClose={() => editor.closeDialog()}
      onSubmit={apply}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Feather
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <span className={styles.label}>Radius</span>
        <div className={styles.inline}>
          <NumberField value={radius} min={0.1} max={500} precision={1} unit="px" onChange={setRadius} width={120} ariaLabel="Feather radius" />
        </div>
        <p className={styles.note}>Softens the selection edge with a Gaussian falloff.</p>
      </div>
    </Modal>
  );
}
