import type { Editor } from '../../engine/Editor';
import { formatBytes } from '../format';

/** Saves to the project the document belongs to, or asks for a name first. */
export async function saveProject(editor: Editor): Promise<void> {
  if (!editor.store.get().project) {
    editor.openDialog({ kind: 'saveProject', saveAs: false });
    return;
  }
  await saveProjectAs(editor, { saveAs: false });
}

/** Runs a save and reports the outcome. Returns true on success. */
export async function saveProjectAs(editor: Editor, options: { saveAs: boolean; name?: string }): Promise<boolean> {
  try {
    const meta = await editor.projects.save(options);
    editor.notify('success', `Saved “${meta.name}” (${formatBytes(meta.bytes)}).`);
    return true;
  } catch (err) {
    editor.notify('error', 'Could not save the project', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Opens a saved project after confirming that unsaved changes may be discarded. */
export async function openProject(editor: Editor, id: string): Promise<boolean> {
  if (!(await editor.confirmDiscard('open a project'))) return false;
  try {
    await editor.projects.open(id);
    return true;
  } catch (err) {
    editor.notify('error', 'Could not open the project', err instanceof Error ? err.message : String(err));
    return false;
  }
}
