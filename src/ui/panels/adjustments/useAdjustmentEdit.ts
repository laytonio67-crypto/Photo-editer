import { useEffect, useMemo, useRef } from 'react';
import type { Transaction } from '../../../engine/Editor';
import { updateAdjustment } from '../../../engine/actions/adjustmentActions';
import { ADJUSTMENTS } from '../../../engine/adjustments/registry';
import type { Adjustment, AdjustmentKind } from '../../../engine/adjustments/types';
import { findLayer } from '../../../engine/doc/layerTree';
import type { DocState, LayerId } from '../../../engine/doc/types';
import { useEditor } from '../../editorContext';

export type AdjustmentOf<K extends AdjustmentKind> = Extract<Adjustment, { kind: K }>;

export interface AdjustmentEdit<K extends AdjustmentKind> {
  /** Starts a continuous gesture (slider or handle drag): one history entry until `end`. */
  begin(): void;
  /**
   * Applies a change relative to the document's current parameters (never to a stale
   * render's copy). Outside a gesture it is recorded immediately; edits sharing a
   * `mergeKey` (e.g. repeated arrow keys) collapse into one history entry.
   */
  change(update: (a: AdjustmentOf<K>) => AdjustmentOf<K>, mergeKey?: string): void;
  end(): void;
}

export function useAdjustmentEdit<K extends AdjustmentKind>(layerId: LayerId, kind: K): AdjustmentEdit<K> {
  const editor = useEditor();
  const tx = useRef<Transaction | null>(null);
  const label = `Modify ${ADJUSTMENTS[kind].label}`;

  // A gesture still open when the editor unmounts (layer switched mid-drag) is kept.
  useEffect(
    () => () => {
      tx.current?.commit(label);
      tx.current = null;
    },
    [label],
  );

  return useMemo(() => {
    const apply =
      (update: (a: AdjustmentOf<K>) => AdjustmentOf<K>) =>
      (d: DocState): DocState => {
        const layer = findLayer(d.layers, layerId);
        if (layer?.type !== 'adjustment' || layer.adjustment.kind !== kind) return d;
        return updateAdjustment(d, layerId, update(layer.adjustment as AdjustmentOf<K>));
      };
    return {
      begin() {
        if (!tx.current?.isOpen) tx.current = editor.beginTransaction();
      },
      change(update, mergeKey) {
        if (tx.current?.isOpen) tx.current.update(apply(update));
        else editor.commit(label, apply(update), mergeKey);
      },
      end() {
        tx.current?.commit(label);
        tx.current = null;
      },
    };
  }, [editor, layerId, kind, label]);
}

/**
 * Calls `onEnd` once when the pointer that started a gesture is released anywhere
 * (sliders and handles may be released outside their element).
 */
export function onPointerRelease(onEnd: () => void): void {
  const done = (): void => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    onEnd();
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
}
