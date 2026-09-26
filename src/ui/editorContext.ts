import { createContext, useContext, useEffect, useState } from 'react';
import type { Editor, EditorEvents, EditorState } from '../engine/Editor';
import { useStore } from '../engine/store';

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor must be used inside <EditorContext.Provider>');
  return editor;
}

/** Selects a slice of editor state; re-renders only when the slice changes. */
export function useEditorState<S>(selector: (state: EditorState) => S, isEqual?: (a: S, b: S) => boolean): S {
  const editor = useEditor();
  return useStore(editor.store, selector, isEqual);
}

/**
 * Subscribes to a high-frequency editor event, coalescing updates to one per
 * animation frame so pointer-rate events don't flood React.
 */
export function useEditorEvent<K extends keyof EditorEvents>(event: K, initial: EditorEvents[K]): EditorEvents[K] {
  const editor = useEditor();
  const [value, setValue] = useState<EditorEvents[K]>(initial);
  useEffect(() => {
    let frame = 0;
    let latest: EditorEvents[K] = initial;
    const off = editor.events.on(event, (payload) => {
      latest = payload;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setValue(latest);
        });
      }
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
    // `initial` is only the seed value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, event]);
  return value;
}
