import { Maximize, Minus, Plus } from 'lucide-react';
import { useEditor, useEditorEvent, useEditorState } from '../editorContext';
import { IconButton } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import { formatShortcut } from '../../app/shortcuts';
import styles from './StatusBar.module.css';

function CursorReadout() {
  const cursor = useEditorEvent('cursor', null);
  if (!cursor) return <span className={styles.item}>—</span>;
  return (
    <span className={styles.item} data-testid="cursor-readout">
      X <span className={styles.value}>{Math.floor(cursor.x)}</span> Y{' '}
      <span className={styles.value}>{Math.floor(cursor.y)}</span>
    </span>
  );
}

export function StatusBar({ className }: { className?: string }) {
  const editor = useEditor();
  const zoom = useEditorState((s) => s.zoom);
  const size = useEditorState((s) => (s.doc ? `${s.doc.width} × ${s.doc.height} px` : null));
  const busy = useEditorState((s) => s.busy);
  const hasDoc = size !== null;

  return (
    <footer className={`${styles.bar} ${className ?? ''}`}>
      <div className={styles.zoom}>
        <IconButton
          size="small"
          label="Zoom out"
          shortcut={formatShortcut('Mod+-')}
          icon={<Minus size={12} />}
          disabled={!hasDoc}
          onClick={() => editor.view.zoomOut()}
        />
        <NumberField
          value={Number((zoom * 100).toFixed(2))}
          precision={2}
          min={1}
          max={6400}
          unit="%"
          width={72}
          disabled={!hasDoc}
          ariaLabel="Zoom level"
          onChange={(v) => editor.view.zoomTo(v / 100)}
        />
        <IconButton
          size="small"
          label="Zoom in"
          shortcut={formatShortcut('Mod+=')}
          icon={<Plus size={12} />}
          disabled={!hasDoc}
          onClick={() => editor.view.zoomIn()}
        />
        <IconButton
          size="small"
          label="Fit on screen"
          shortcut={formatShortcut('Mod+0')}
          icon={<Maximize size={11} />}
          disabled={!hasDoc}
          onClick={() => editor.view.fit()}
        />
      </div>
      {hasDoc && (
        <>
          <span className={styles.sep} />
          <span className={styles.item}>
            <span className={styles.value}>{size}</span>
          </span>
          <span className={styles.sep} />
          <CursorReadout />
        </>
      )}
      {busy && (
        <>
          <span className={styles.sep} />
          <span className={styles.busy} role="status">
            <span className={styles.spinner} />
            {busy}
          </span>
        </>
      )}
      <span className={styles.spacer} />
      <span className={styles.item} title={`Renderer: ${editor.caps.renderer}`}>
        WebGL 2 · max {editor.caps.maxDocumentSize}px
      </span>
    </footer>
  );
}
