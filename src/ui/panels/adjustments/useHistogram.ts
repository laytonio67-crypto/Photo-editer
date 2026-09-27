import { useEffect, useMemo, useState } from 'react';
import { layersBelow, type HistogramData } from '../../../engine/histogram/histogram';
import type { Layer, LayerId } from '../../../engine/doc/types';
import { useEditor, useEditorState } from '../../editorContext';

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function objectId(o: object): number {
  let id = objectIds.get(o);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(o, id);
  }
  return id;
}

/**
 * A string that changes whenever anything in `layers` that affects rendering changes.
 * Layers keep their identity while unchanged (structural sharing), so leaves are keyed
 * by identity; truncated groups are rebuilt on every call, so they are keyed by props.
 */
function treeSignature(layers: readonly Layer[]): string {
  return layers
    .map((l) => {
      if (l.type !== 'group') return String(objectId(l));
      const mask = l.mask ? `${objectId(l.mask)}` : '-';
      return `g${l.id}:${l.visible}:${l.opacity}:${l.blendMode}:${l.clipped}:${mask}[${treeSignature(l.children)}]`;
    })
    .join(',');
}

/**
 * Histogram of the input of adjustment layer `layerId` (everything below it), or of the
 * whole composite when `layerId` is null. Recomputed (debounced) when that input changes
 * — editing the adjustment itself does not trigger a recompute.
 */
export function useHistogram(layerId: LayerId | null, enabled = true): HistogramData | null {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [pixelsVersion, setPixelsVersion] = useState(0);

  useEffect(() => editor.events.on('surfaceChanged', () => setPixelsVersion((v) => v + 1)), [editor]);

  const signature = useMemo(() => {
    if (!doc) return null;
    const layers = layerId ? layersBelow(doc.layers, layerId) : doc.layers;
    return layers ? `${doc.id}:${doc.width}x${doc.height}:${treeSignature(layers)}` : null;
  }, [doc, layerId]);

  useEffect(() => {
    if (!enabled || signature === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const current = editor.doc;
      if (!current) return;
      editor.histograms
        .compute(current, layerId)
        .then((h) => !cancelled && setHistogram(h))
        .catch((err: unknown) => {
          if (!cancelled) editor.notify('error', 'Could not compute the histogram', String(err));
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editor, signature, layerId, pixelsVersion, enabled]);

  return enabled ? histogram : null;
}
