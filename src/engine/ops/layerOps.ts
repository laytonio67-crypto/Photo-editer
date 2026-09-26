import {
  findLayer,
  flattenLayers,
  insertLayer,
  isDescendantOf,
  locateLayer,
  moveLayer,
  panelOrder,
  removeLayer,
  updateLayer,
  walkLayers,
} from '../doc/layerTree';
import { createGroupLayer } from '../doc/factory';
import type { DocState, GroupLayer, Layer, LayerId } from '../doc/types';

/**
 * Pure document transformations for layer management. Each returns a new DocState
 * (or the same one when nothing changes). GPU-dependent operations (duplicating
 * pixels, merging) live in the editor and use these for the structural part.
 */

export type SelectMode = 'replace' | 'toggle' | 'range';

/** Updates the active layer and multi-selection the way a layers panel does. */
export function selectLayer(doc: DocState, id: LayerId, mode: SelectMode = 'replace'): DocState {
  if (!findLayer(doc.layers, id)) return doc;
  if (mode === 'toggle') {
    const has = doc.selectedLayerIds.includes(id);
    const selected = has ? doc.selectedLayerIds.filter((x) => x !== id) : [...doc.selectedLayerIds, id];
    if (selected.length === 0) return doc; // keep at least one selected
    const active = has ? (doc.activeLayerId === id ? selected[selected.length - 1]! : doc.activeLayerId) : id;
    return { ...doc, selectedLayerIds: selected, activeLayerId: active, editTarget: active === doc.activeLayerId ? doc.editTarget : 'content' };
  }
  if (mode === 'range' && doc.activeLayerId) {
    const order = panelOrder(doc.layers).map((r) => r.layer.id);
    const a = order.indexOf(doc.activeLayerId);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { ...doc, selectedLayerIds: order.slice(lo, hi + 1), activeLayerId: id, editTarget: 'content' };
    }
  }
  if (doc.activeLayerId === id && doc.selectedLayerIds.length === 1 && doc.selectedLayerIds[0] === id) return doc;
  return {
    ...doc,
    activeLayerId: id,
    selectedLayerIds: [id],
    editTarget: doc.activeLayerId === id ? doc.editTarget : 'content',
  };
}

/** Location where new layers go: directly above the active layer, inside its parent. */
export function insertionPoint(doc: DocState): { parentId: LayerId | null; index: number } {
  if (doc.activeLayerId) {
    const loc = locateLayer(doc.layers, doc.activeLayerId);
    if (loc) return { parentId: loc.parent?.id ?? null, index: loc.index + 1 };
  }
  return { parentId: null, index: doc.layers.length };
}

/** Inserts a layer above the active one and makes it active. */
export function addLayer(doc: DocState, layer: Layer, at = insertionPoint(doc)): DocState {
  return {
    ...doc,
    layers: insertLayer(doc.layers, at.parentId, at.index, layer),
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    editTarget: 'content',
  };
}

/** Top-level selected ids (drops ids whose ancestor is also selected). */
export function topLevelSelection(doc: DocState, ids: readonly LayerId[] = doc.selectedLayerIds): LayerId[] {
  const set = new Set(ids.filter((id) => findLayer(doc.layers, id)));
  return [...set].filter((id) => ![...set].some((other) => other !== id && isDescendantOf(doc.layers, id, other)));
}

/** Deletes layers; the next active layer is the one below the deleted block (or above). */
export function deleteLayers(doc: DocState, ids: readonly LayerId[]): DocState {
  const targets = topLevelSelection(doc, ids);
  if (targets.length === 0) return doc;
  const order = panelOrder(doc.layers, true).map((r) => r.layer.id);
  let layers = doc.layers;
  for (const id of targets) layers = removeLayer(layers, id);
  // Choose the nearest surviving layer after the first removed one in panel order.
  const firstIdx = Math.min(...targets.map((id) => order.indexOf(id)));
  const survivors = new Set(flattenLayers(layers).map((l) => l.id));
  let active: LayerId | null = null;
  for (let i = firstIdx; i < order.length && !active; i++) if (survivors.has(order[i]!)) active = order[i]!;
  for (let i = firstIdx - 1; i >= 0 && !active; i--) if (survivors.has(order[i]!)) active = order[i]!;
  return {
    ...doc,
    layers,
    activeLayerId: active,
    selectedLayerIds: active ? [active] : [],
    editTarget: 'content',
  };
}

export function renameLayer(doc: DocState, id: LayerId, name: string): DocState {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  const layer = findLayer(doc.layers, id);
  if (!layer || layer.name === trimmed) return doc;
  return { ...doc, layers: updateLayer(doc.layers, id, (l) => ({ ...l, name: trimmed })) };
}

type CommonProps = Pick<Layer, 'visible' | 'opacity' | 'blendMode' | 'locks' | 'clipped' | 'name'>;

/** Patches common properties of a layer. */
export function setLayerProps(doc: DocState, id: LayerId, patch: Partial<CommonProps>): DocState {
  const layer = findLayer(doc.layers, id);
  if (!layer) return doc;
  const keys = Object.keys(patch) as (keyof CommonProps)[];
  if (keys.every((k) => Object.is(layer[k], patch[k]))) return doc;
  if (patch.blendMode === 'passThrough' && layer.type !== 'group') return doc;
  return { ...doc, layers: updateLayer(doc.layers, id, (l) => ({ ...l, ...patch }) as Layer) };
}

/** Replaces a layer object wholesale (type-specific edits). */
export function replaceLayer(doc: DocState, id: LayerId, fn: (layer: Layer) => Layer): DocState {
  const layers = updateLayer(doc.layers, id, fn);
  return layers === doc.layers ? doc : { ...doc, layers };
}

/**
 * Shows only `id` (Alt-click on a visibility toggle); a second invocation restores all
 * siblings/other layers to visible.
 */
export function soloVisibility(doc: DocState, id: LayerId): DocState {
  const all = flattenLayers(doc.layers);
  const target = findLayer(doc.layers, id);
  if (!target) return doc;
  // Ancestors of the target and descendants stay as they are.
  const keep = new Set<LayerId>([id]);
  walkLayers(doc.layers, (layer) => {
    if (layer.type === 'group' && isDescendantOf(doc.layers, id, layer.id)) keep.add(layer.id);
  });
  if (target.type === 'group') for (const l of flattenLayers(target.children)) keep.add(l.id);
  const othersHidden = all.every((l) => keep.has(l.id) || !l.visible);
  let layers = doc.layers;
  for (const l of all) {
    if (keep.has(l.id)) {
      if (!l.visible && l.id === id) layers = updateLayer(layers, l.id, (x) => ({ ...x, visible: true }));
      continue;
    }
    const visible = othersHidden;
    if (l.visible !== visible) layers = updateLayer(layers, l.id, (x) => ({ ...x, visible }));
  }
  return layers === doc.layers ? doc : { ...doc, layers };
}

/**
 * Moves the given layers so they sit (in panel order) at `index` inside `parentId`
 * (bottom→top index). Used by drag-and-drop in the layers panel.
 */
export function moveLayersTo(doc: DocState, ids: readonly LayerId[], parentId: LayerId | null, index: number): DocState {
  const targets = topLevelSelection(doc, ids);
  if (targets.length === 0) return doc;
  if (parentId && targets.some((id) => isDescendantOf(doc.layers, parentId, id))) return doc;
  // Preserve the relative bottom→top order of the moved layers.
  const flat = flattenLayers(doc.layers).map((l) => l.id);
  const ordered = [...targets].sort((a, b) => flat.indexOf(a) - flat.indexOf(b));
  const parentChildren = (layers: readonly Layer[]): readonly Layer[] =>
    parentId ? ((findLayer(layers, parentId) as GroupLayer | null)?.children ?? []) : layers;
  // Translate the insertion index to account for moved layers that were below it in
  // the destination list.
  const destBefore = parentChildren(doc.layers);
  let insertAt = index;
  for (let i = 0; i < Math.min(index, destBefore.length); i++) {
    if (ordered.includes(destBefore[i]!.id)) insertAt--;
  }
  let layers: Layer[] = doc.layers as Layer[];
  const moved = ordered.map((id) => findLayer(layers, id)!);
  for (const id of ordered) layers = removeLayer(layers, id);
  moved.forEach((layer, i) => {
    layers = insertLayer(layers, parentId, insertAt + i, layer);
  });
  return { ...doc, layers };
}

/** Moves the active layer one step up/down among its siblings (Ctrl+] / Ctrl+[). */
export function shiftLayer(doc: DocState, id: LayerId, direction: 1 | -1 | 'top' | 'bottom'): DocState {
  const loc = locateLayer(doc.layers, id);
  if (!loc) return doc;
  const count = loc.siblings.length;
  let index: number;
  if (direction === 'top') index = count - 1;
  else if (direction === 'bottom') index = 0;
  else index = loc.index + direction;
  index = Math.max(0, Math.min(count - 1, index));
  if (index === loc.index) return doc;
  return { ...doc, layers: moveLayer(doc.layers, id, loc.parent?.id ?? null, index) };
}

/** Wraps the selected layers into a new group placed where the topmost one was. */
export function groupLayers(doc: DocState, ids: readonly LayerId[] = doc.selectedLayerIds, name = 'Group'): DocState {
  const targets = topLevelSelection(doc, ids);
  if (targets.length === 0) return doc;
  const flat = flattenLayers(doc.layers).map((l) => l.id);
  const ordered = [...targets].sort((a, b) => flat.indexOf(a) - flat.indexOf(b));
  const topId = ordered[ordered.length - 1]!;
  const topLoc = locateLayer(doc.layers, topId)!;
  const parentId = topLoc.parent?.id ?? null;
  const children = ordered.map((id) => findLayer(doc.layers, id)!);
  let layers: Layer[] = doc.layers as Layer[];
  // Count moved layers that sit below the insertion point in the same parent.
  let index = topLoc.index + 1;
  for (let i = 0; i < topLoc.index + 1; i++) {
    if (ordered.includes(topLoc.siblings[i]!.id)) index--;
  }
  for (const id of ordered) layers = removeLayer(layers, id);
  const group = createGroupLayer({ name, children });
  layers = insertLayer(layers, parentId, index, group);
  return { ...doc, layers, activeLayerId: group.id, selectedLayerIds: [group.id], editTarget: 'content' };
}

/** Replaces a group by its children (keeping their stacking position). */
export function ungroupLayer(doc: DocState, groupId: LayerId): DocState {
  const loc = locateLayer(doc.layers, groupId);
  const group = findLayer(doc.layers, groupId);
  if (!loc || !group || group.type !== 'group') return doc;
  const parentId = loc.parent?.id ?? null;
  let layers = removeLayer(doc.layers, groupId);
  group.children.forEach((child, i) => {
    layers = insertLayer(layers, parentId, loc.index + i, child);
  });
  const top = group.children[group.children.length - 1];
  return {
    ...doc,
    layers,
    activeLayerId: top?.id ?? null,
    selectedLayerIds: group.children.map((c) => c.id),
    editTarget: 'content',
  };
}

export function toggleGroupExpanded(doc: DocState, groupId: LayerId, expanded?: boolean): DocState {
  return replaceLayer(doc, groupId, (l) =>
    l.type === 'group' ? { ...l, expanded: expanded ?? !l.expanded } : l,
  );
}

/** Selects every layer (Ctrl+Alt+A). */
export function selectAllLayers(doc: DocState): DocState {
  const ids = panelOrder(doc.layers, true).map((r) => r.layer.id);
  if (ids.length === 0) return doc;
  return { ...doc, selectedLayerIds: ids, activeLayerId: doc.activeLayerId ?? ids[0]! };
}
