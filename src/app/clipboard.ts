import type { Editor } from '../engine/Editor';
import { pasteClipboard } from '../engine/actions/clipboardActions';

/** True when an image blob has the same size as the in-app clipboard (our own copy round-tripped). */
async function matchesInternal(editor: Editor, blob: Blob): Promise<boolean> {
  const clip = editor.clipboard;
  if (!clip) return false;
  try {
    const bitmap = await createImageBitmap(blob);
    const same = bitmap.width === clip.width && bitmap.height === clip.height;
    bitmap.close();
    return same;
  } catch {
    return false;
  }
}

/**
 * Handles pasted image files (from a paste event). Pixels we copied ourselves are pasted
 * from the in-app clipboard so they keep their exact position; other images are placed
 * as new layers (or opened when no document exists).
 */
export async function handlePastedFiles(editor: Editor, files: File[]): Promise<void> {
  const first = files[0];
  if (!first) {
    if (!pasteClipboard(editor)) editor.notify('info', 'The clipboard contains no image.');
    return;
  }
  if (editor.doc && (await matchesInternal(editor, first)) && pasteClipboard(editor)) return;
  const named = files.map((f) =>
    f.name && f.name !== 'image.png' ? f : new File([f], 'Pasted Image.png', { type: f.type || 'image/png' }),
  );
  await editor.importFiles(named, editor.doc ? 'place' : 'open');
}

/**
 * Edit ▸ Paste from the menu: reads the system clipboard through the async Clipboard
 * API (may prompt for permission). Returns true if something was pasted.
 */
export async function importClipboardImages(editor: Editor): Promise<boolean> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') return false;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      await handlePastedFiles(editor, [new File([blob], 'Pasted Image.png', { type })]);
      return true;
    }
  } catch {
    // Permission denied or unsupported: fall back to the in-app clipboard.
  }
  return false;
}
