import type { DocState, GroupLayer, Layer, LayerId, SurfaceId } from './types';

/**
 * Pure, immutable helpers for the layer tree. Every mutation returns new arrays/objects
 * along the path to the changed node and shares everything else, so DocState snapshots
 * stay cheap for history.
 *
 * Arrays are ordered bottom → top (render order). "Index" always refers to that order.
 */

export interface LayerLocation {
  /** Parent group, or null for root. */
  parent: GroupLayer | null;
  siblings: readonly Layer[];
  index: number;
  depth: number;
}

export function isGroup(layer: Layer): layer is GroupLayer {
  return layer.type === 'group';
}

/** Depth-first visit, bottom → top, parents before children. Return false to stop. */
export function walkLayers(
  layers: readonly Layer[],
  visit: (layer: Layer, location: LayerLocation) => boolean | void,
  parent: GroupLayer | null = null,
  depth = 0,
): boolean {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (visit(layer, { parent, siblings: layers, index: i, depth }) === false) return false;
    if (layer.type === 'group') {
      if (!walkLayers(layer.children, visit, layer, depth + 1)) return false;
    }
  }
  return true;
}

export function findLayer(layers: readonly Layer[], id: LayerId | null | undefined): Layer | null {
  if (!id) return null;
  let found: Layer | null = null;
  walkLayers(layers, (layer) => {
    if (layer.id === id) {
      found = layer;
      return false;
    }
    return true;
  });
  return found;
}

export function locateLayer(layers: readonly Layer[], id: LayerId): LayerLocation | null {
  let found: LayerLocation | null = null;
  walkLayers(layers, (layer, loc) => {
    if (layer.id === id) {
      found = loc;
      return false;
    }
    return true;
  });
  return found;
}

/** All layers flattened depth-first (bottom → top, groups before their children). */
export function flattenLayers(layers: readonly Layer[]): Layer[] {
  const out: Layer[] = [];
  walkLayers(layers, (layer) => {
    out.push(layer);
  });
  return out;
}

/**
 * Layers in panel order: top → bottom, with a group's children listed (top → bottom)
 * directly after the group row, like a layers panel displays them.
 */
export function panelOrder(
  layers: readonly Layer[],
  includeCollapsed = false,
  depth = 0,
  out: { layer: Layer; depth: number }[] = [],
): { layer: Layer; depth: number }[] {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    out.push({ layer, depth });
    if (layer.type === 'group' && (layer.expanded || includeCollapsed)) {
      panelOrder(layer.children, includeCollapsed, depth + 1, out);
    }
  }
  return out;
}

/** True if `ancestorId` is `id` itself or one of its ancestors. */
export function isDescendantOf(layers: readonly Layer[], id: LayerId, ancestorId: LayerId): boolean {
  if (id === ancestorId) return true;
  const ancestor = findLayer(layers, ancestorId);
  if (!ancestor || ancestor.type !== 'group') return false;
  return findLayer(ancestor.children, id) !== null;
}

/** Replaces a layer by id using `fn`. Returns the original array if nothing changed. */
export function updateLayer(layers: readonly Layer[], id: LayerId, fn: (layer: Layer) => Layer): Layer[] {
  let changed = false;
  const next = layers.map((layer) => {
    if (layer.id === id) {
      const updated = fn(layer);
      if (updated !== layer) changed = true;
      return updated;
    }
    if (layer.type === 'group') {
      const children = updateLayer(layer.children, id, fn);
      if (children !== layer.children) {
        changed = true;
        return { ...layer, children };
      }
    }
    return layer;
  });
  return changed ? next : (layers as Layer[]);
}

/** Maps every layer (post-order: children are mapped before their group). */
export function mapLayers(layers: readonly Layer[], fn: (layer: Layer) => Layer): Layer[] {
  let changed = false;
  const next = layers.map((layer) => {
    let current = layer;
    if (current.type === 'group') {
      const children = mapLayers(current.children, fn);
      if (children !== current.children) current = { ...current, children };
    }
    const mapped = fn(current);
    if (mapped !== layer) changed = true;
    return mapped;
  });
  return changed ? next : (layers as Layer[]);
}

/** Removes a layer (and its subtree). */
export function removeLayer(layers: readonly Layer[], id: LayerId): Layer[] {
  let changed = false;
  const next: Layer[] = [];
  for (const layer of layers) {
    if (layer.id === id) {
      changed = true;
      continue;
    }
    if (layer.type === 'group') {
      const children = removeLayer(layer.children, id);
      if (children !== layer.children) {
        changed = true;
        next.push({ ...layer, children });
        continue;
      }
    }
    next.push(layer);
  }
  return changed ? next : (layers as Layer[]);
}

/**
 * Inserts `layer` into group `parentId` (null = root) at `index` (bottom → top order;
 * clamped). Throws if the parent does not exist or is not a group.
 */
export function insertLayer(
  layers: readonly Layer[],
  parentId: LayerId | null,
  index: number,
  layer: Layer,
): Layer[] {
  if (parentId === null) {
    const i = Math.max(0, Math.min(index, layers.length));
    return [...layers.slice(0, i), layer, ...layers.slice(i)];
  }
  const parent = findLayer(layers, parentId);
  if (!parent || parent.type !== 'group') throw new Error(`Layer ${parentId} is not a group`);
  return updateLayer(layers, parentId, (g) => {
    const group = g as GroupLayer;
    const i = Math.max(0, Math.min(index, group.children.length));
    return { ...group, children: [...group.children.slice(0, i), layer, ...group.children.slice(i)] };
  });
}

/**
 * Moves a layer to a new parent/index. `index` is interpreted in the destination's
 * sibling list *after* removal of the moved layer. Moving a group into itself or its
 * descendants is rejected (returns the input unchanged).
 */
export function moveLayer(
  layers: readonly Layer[],
  id: LayerId,
  parentId: LayerId | null,
  index: number,
): Layer[] {
  const layer = findLayer(layers, id);
  if (!layer) return layers as Layer[];
  if (parentId !== null && isDescendantOf(layers, parentId, id)) return layers as Layer[];
  const without = removeLayer(layers, id);
  return insertLayer(without, parentId, index, layer);
}

/** Surface ids referenced by a layer subtree (content, masks). Text rasters are caches, not included. */
export function collectLayerSurfaces(layers: readonly Layer[], into: Set<SurfaceId> = new Set()): Set<SurfaceId> {
  walkLayers(layers, (layer) => {
    if (layer.type === 'pixel') into.add(layer.surfaceId);
    if (layer.mask) into.add(layer.mask.surfaceId);
  });
  return into;
}

/** Every surface a document state keeps alive. */
export function collectDocSurfaces(doc: DocState, into: Set<SurfaceId> = new Set()): Set<SurfaceId> {
  collectLayerSurfaces(doc.layers, into);
  if (doc.selection) into.add(doc.selection.surfaceId);
  return into;
}

/** Nearest ancestor chain (outermost first) of a layer. */
export function ancestorsOf(layers: readonly Layer[], id: LayerId): GroupLayer[] {
  const chain: GroupLayer[] = [];
  const search = (list: readonly Layer[]): boolean => {
    for (const layer of list) {
      if (layer.id === id) return true;
      if (layer.type === 'group') {
        chain.push(layer);
        if (search(layer.children)) return true;
        chain.pop();
      }
    }
    return false;
  };
  return search(layers) ? chain : [];
}

/** A layer is effectively visible if it and all its ancestors are visible. */
export function isEffectivelyVisible(layers: readonly Layer[], id: LayerId): boolean {
  const layer = findLayer(layers, id);
  if (!layer || !layer.visible) return false;
  return ancestorsOf(layers, id).every((g) => g.visible);
}

export function countLayers(layers: readonly Layer[]): number {
  let n = 0;
  walkLayers(layers, () => {
    n++;
  });
  return n;
}

/** Generates "Layer N" style names that don't collide with existing names. */
export function uniqueLayerName(layers: readonly Layer[], base: string): string {
  const names = new Set<string>();
  walkLayers(layers, (l) => {
    names.add(l.name);
  });
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Next "Layer N" name, continuing the highest existing number. */
export function nextLayerName(layers: readonly Layer[], prefix = 'Layer'): string {
  let max = 0;
  const re = new RegExp(`^${prefix} (\\d+)$`);
  walkLayers(layers, (l) => {
    const m = re.exec(l.name);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `${prefix} ${max + 1}`;
}
