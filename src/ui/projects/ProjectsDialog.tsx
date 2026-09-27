import { useEffect, useState } from 'react';
import { ImageOff, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../controls/Button';
import { Modal } from '../controls/Modal';
import { useEditor } from '../editorContext';
import { formatBytes } from '../format';
import { openProject } from './projectActions';
import styles from './Projects.module.css';
import { formatDate, useProjects } from './useProjects';

/** File ▸ Open Project: saved projects with thumbnails; open or delete them. */
export function ProjectsDialog() {
  const editor = useEditor();
  const { projects, error } = useProjects();
  const [selected, setSelected] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const current = selected ?? projects?.[0]?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    void navigator.storage?.estimate?.().then((e) => {
      if (!cancelled && e.usage !== undefined && e.quota) setUsage(`${formatBytes(e.usage)} of ${formatBytes(e.quota)} used`);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const open = async (id: string): Promise<void> => {
    editor.closeDialog();
    await openProject(editor, id);
  };

  const remove = async (id: string, name: string): Promise<void> => {
    const ok = await editor.confirm({
      title: 'Delete project?',
      message: `“${name}” will be permanently deleted from this browser.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      try {
        await editor.projects.remove(id);
        editor.notify('info', `Deleted “${name}”.`);
      } catch (err) {
        editor.notify('error', 'Could not delete the project', err instanceof Error ? err.message : String(err));
      }
    }
    // The confirmation replaced this dialog: show the (updated) list again.
    editor.openDialog({ kind: 'projects' });
  };

  return (
    <Modal
      title="Open Project"
      width={640}
      onClose={() => editor.closeDialog()}
      onSubmit={() => current && void open(current)}
      footer={
        <>
          <span className={styles.usage}>{usage}</span>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" disabled={!current} onClick={() => current && void open(current)}>
            Open
          </Button>
        </>
      }
    >
      {error && <p className={styles.error}>{error}</p>}
      {projects === null ? (
        <p className={styles.empty}>Loading…</p>
      ) : projects.length === 0 ? (
        <p className={styles.empty}>No saved projects yet. Save the open document with Save (Ctrl/Cmd+S).</p>
      ) : (
        <div className={styles.grid} role="listbox" aria-label="Saved projects">
          {projects.map((p) => (
            <div
              key={p.id}
              className={styles.card}
              role="option"
              tabIndex={0}
              aria-selected={p.id === current}
              data-testid="project-card"
              onClick={() => setSelected(p.id)}
              onDoubleClick={() => void open(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void open(p.id);
                }
              }}
            >
              <div className={styles.thumb}>
                {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" /> : <ImageOff size={20} strokeWidth={1.5} />}
              </div>
              <div className={styles.info}>
                <span className={styles.name} title={p.name}>
                  {p.name}
                </span>
                <span className={styles.meta}>
                  {p.width} × {p.height} · {p.layerCount} {p.layerCount === 1 ? 'layer' : 'layers'} · {formatBytes(p.bytes)}
                </span>
                <span className={styles.meta}>{formatDate(p.modified)}</span>
              </div>
              <IconButton
                size="small"
                className={styles.delete}
                label={`Delete ${p.name}`}
                icon={<Trash2 size={13} />}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(p.id, p.name);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
