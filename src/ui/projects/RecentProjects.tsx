import { ImageOff } from 'lucide-react';
import { useEditor } from '../editorContext';
import { openProject } from './projectActions';
import styles from './Projects.module.css';
import { formatDate, useProjects } from './useProjects';

/** Most recently saved projects, for the start screen. */
export function RecentProjects({ limit = 6 }: { limit?: number }) {
  const editor = useEditor();
  const { projects } = useProjects();
  if (!projects || projects.length === 0) return null;
  return (
    <section className={styles.recent} aria-label="Recent projects">
      <h2 className={styles.recentTitle}>Recent projects</h2>
      <div className={styles.recentList}>
        {projects.slice(0, limit).map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.recentItem}
            title={`Open “${p.name}”`}
            onClick={() => void openProject(editor, p.id)}
          >
            <span className={styles.thumb}>
              {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" /> : <ImageOff size={18} strokeWidth={1.5} />}
            </span>
            <span className={styles.info}>
              <span className={styles.name}>{p.name}</span>
              <span className={styles.meta}>{formatDate(p.modified)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
