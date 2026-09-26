import { findLayer, locateLayer } from '../../engine/doc/layerTree';
import type { DocState, LayerId } from '../../engine/doc/types';

export type DropZone = 'above' | 'below' | 'into';

export interface DropTarget {
  id: LayerId;
  zone: DropZone;
}

/** Converts a drop position relative to a row into (parent, bottom→top index). */
export function dropDestination(doc: DocState, target: DropTarget): { parentId: LayerId | null; index: number } | null {
  const layer = findLayer(doc.layers, target.id);
  const loc = locateLayer(doc.layers, target.id);
  if (!layer || !loc) return null;
  const parentId = loc.parent?.id ?? null;
  if (target.zone === 'into' && layer.type === 'group') return { parentId: layer.id, index: layer.children.length };
  if (target.zone === 'above') return { parentId, index: loc.index + 1 };
  if (layer.type === 'group' && layer.expanded) return { parentId: layer.id, index: layer.children.length };
  return { parentId, index: loc.index };
}
