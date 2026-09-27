import { findLayer, mapLayers, updateLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerId } from '../doc/types';
import { topLevelSelection } from './layerOps';

/**
 * Translates a layer (and its subtree) by whole pixels. Linked masks move with their
 * layer; unlinked masks stay put (Photoshop semantics).
 */
export function translateLayer(layer: Layer, dx: number, dy: number): Layer {
  if (dx === 0 && dy === 0) return layer;
  const mask = layer.mask && layer.mask.linked ? { ...layer.mask, x: layer.mask.x + dx, y: layer.mask.y + dy } : layer.mask;
  switch (layer.type) {
    case 'pixel':
      return { ...layer, x: layer.x + dx, y: layer.y + dy, mask };
    case 'text':
      return { ...layer, x: layer.x + dx, y: layer.y + dy, mask };
    case 'adjustment':
      return mask === layer.mask ? layer : { ...layer, mask };
    case 'group':
      return { ...layer, mask, children: layer.children.map((c) => translateLayer(c, dx, dy)) };
  }
}

/** True if the layer (or anything inside it) is position-locked. */
export function isPositionLocked(layer: Layer): boolean {
  if (layer.locks.position) return true;
  return layer.type === 'group' && layer.children.some(isPositionLocked);
}

/** Layers the Move/Transform tools act on: top-level selected, unlocked layers. */
export function movableLayerIds(doc: DocState): { ids: LayerId[]; locked: LayerId[] } {
  const ids: LayerId[] = [];
  const locked: LayerId[] = [];
  for (const id of topLevelSelection(doc)) {
    const layer = findLayer(doc.layers, id);
    if (!layer) continue;
    (isPositionLocked(layer) ? locked : ids).push(id);
  }
  return { ids, locked };
}

/** Moves layers by an integer offset. */
export function moveLayers(doc: DocState, ids: readonly LayerId[], dx: number, dy: number): DocState {
  const rx = Math.round(dx);
  const ry = Math.round(dy);
  if ((rx === 0 && ry === 0) || ids.length === 0) return doc;
  let layers = doc.layers;
  for (const id of ids) layers = updateLayer(layers, id, (l) => translateLayer(l, rx, ry));
  return layers === doc.layers ? doc : { ...doc, layers };
}

/** Offsets every layer (canvas resize / crop). */
export function offsetAllLayers(doc: DocState, dx: number, dy: number): DocState {
  if (dx === 0 && dy === 0) return doc;
  return { ...doc, layers: doc.layers.map((l) => translateLayer(l, dx, dy)) };
}

/** Changes canvas size keeping content anchored (anchor 0 = left/top, 0.5 = centre, 1 = right/bottom). */
export function resizeCanvasPure(
  doc: DocState,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
): DocState {
  const dx = Math.round((width - doc.width) * anchorX);
  const dy = Math.round((height - doc.height) * anchorY);
  const moved = offsetAllLayers(doc, dx, dy);
  return { ...moved, width, height };
}

/** Expands groups into the leaf layers a transform must resample (pixel/text layers). */
export function transformLeaves(doc: DocState, ids: readonly LayerId[]): Layer[] {
  const out: Layer[] = [];
  const visit = (layer: Layer): void => {
    if (layer.type === 'group') layer.children.forEach(visit);
    else out.push(layer);
  };
  for (const id of ids) {
    const layer = findLayer(doc.layers, id);
    if (layer) visit(layer);
  }
  return out;
}

/** Applies `fn` to every layer (used by whole-canvas operations). */
export function mapAllLayers(doc: DocState, fn: (layer: Layer) => Layer): DocState {
  const layers = mapLayers(doc.layers, fn);
  return layers === doc.layers ? doc : { ...doc, layers };
}
