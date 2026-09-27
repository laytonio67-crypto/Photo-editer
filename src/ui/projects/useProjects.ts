import { useCallback, useEffect, useState } from 'react';
import type { ProjectMeta } from '../../engine/io/ProjectStore';
import { useEditor } from '../editorContext';

export interface ProjectEntry extends ProjectMeta {
  /** Object URL of the thumbnail (revoked when the list changes or unmounts). */
  thumbnailUrl: string | null;
}

/** Saved projects with thumbnail URLs; `reload` refreshes the list. */
export function useProjects(): { projects: ProjectEntry[] | null; error: string | null; reload: () => void } {
  const editor = useEditor();
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    editor.projects
      .list()
      .then((list) => {
        if (cancelled) return;
        const entries = list.map((p) => {
          const thumbnailUrl = p.thumbnail ? URL.createObjectURL(p.thumbnail) : null;
          if (thumbnailUrl) urls.push(thumbnailUrl);
          return { ...p, thumbnailUrl };
        });
        setProjects(entries);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProjects([]);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
      urls = [];
    };
  }, [editor, version]);

  return { projects, error, reload };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(ms: number): string {
  return dateFormat.format(new Date(ms));
}
