import { useRef } from 'react';
import type { DocState } from '../engine/doc/types';
import type { Transaction } from '../engine/Editor';
import { useEditor } from './editorContext';

/**
 * Groups continuous control changes (slider drags, label scrubbing) into a single
 * history entry: `start` opens a transaction, `update` previews, `end` commits.
 * Outside a scrub, `commit` records a normal single-step edit.
 */
export function useScrub() {
  const editor = useEditor();
  const tx = useRef<Transaction | null>(null);
  return {
    start(): void {
      tx.current = editor.beginTransaction();
    },
    update(fn: (doc: DocState) => DocState): void {
      if (tx.current?.isOpen) tx.current.update(fn);
      else editor.updateDocSilently(fn);
    },
    end(label: string): void {
      tx.current?.commit(label);
      tx.current = null;
    },
    commit(label: string, fn: (doc: DocState) => DocState): void {
      if (tx.current?.isOpen) tx.current.update(fn);
      else editor.commit(label, fn);
    },
  };
}
