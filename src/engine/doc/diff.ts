import { unionRects, type Rect } from '../geometry';
import type { DocState, Layer } from './types';

/** Document-space bounds of a layer's visible content, or 'full' if it can affect anything. */
export type BoundsFn = (layer: Layer) => Rect | 'full';

const FULL = 'full' as const;

function sameShallowExceptChildren(a: Layer, b: Layer): boolean {
  const ka = Object.keys(a) as (keyof Layer)[];
  for (const k of ka) {
    if (k === ('children' as keyof Layer)) continue;
    if (!Object.is(a[k], b[k])) return false;
  }
  return Object.keys(b).length === ka.length;
}

function subtreeBounds(layer: Layer, boundsOf: BoundsFn): Rect | 'full' {
  if (layer.type !== 'group') return boundsOf(layer);
  let acc: Rect = { x: 0, y: 0, width: 0, height: 0 };
  for (const child of layer.children) {
    const b = subtreeBounds(child, boundsOf);
    if (b === FULL) return FULL;
    acc = unionRects(acc, b);
  }
  return acc;
}

function indexById(layers: readonly Layer[], into: Map<string, { layer: Layer; parent: string | null; index: number }>, parent: string | null = null): void {
  layers.forEach((layer, index) => {
    into.set(layer.id, { layer, parent, index });
    if (layer.type === 'group') indexById(layer.children, into, layer.id);
  });
}

/**
 * Computes the document region whose composite may differ between two layer trees.
 * Returns null when nothing visible changed, a rect for localised changes, or 'full'.
 *
 * Relies on structural sharing: unchanged layers keep their object identity.
 */
export function diffLayers(prev: readonly Layer[], next: readonly Layer[], boundsOf: BoundsFn): Rect | 'full' | null {
  if (prev === next) return null;
  const a = new Map<string, { layer: Layer; parent: string | null; index: number }>();
  const b = new Map<string, { layer: Layer; parent: string | null; index: number }>();
  indexById(prev, a);
  indexById(next, b);
  let dirty: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let any = false;
  const add = (r: Rect | 'full'): boolean => {
    if (r === FULL) return true;
    dirty = unionRects(dirty, r);
    any = true;
    return false;
  };

  for (const [id, before] of a) {
    const after = b.get(id);
    if (!after) {
      // Removed.
      if (add(subtreeBounds(before.layer, boundsOf))) return FULL;
      continue;
    }
    const moved = before.parent !== after.parent || before.index !== after.index;
    if (before.layer === after.layer && !moved) continue;
    if (before.layer.type === 'group' && after.layer.type === 'group') {
      // Group identity changes whenever a descendant changes; only its own
      // properties (or position) make the whole subtree dirty.
      if (moved || !sameShallowExceptChildren(before.layer, after.layer)) {
        if (add(subtreeBounds(before.layer, boundsOf))) return FULL;
        if (add(subtreeBounds(after.layer, boundsOf))) return FULL;
      }
      continue;
    }
    if (before.layer.type === 'adjustment' || after.layer.type === 'adjustment') return FULL;
    if (add(subtreeBounds(before.layer, boundsOf))) return FULL;
    if (add(subtreeBounds(after.layer, boundsOf))) return FULL;
  }
  for (const [id, after] of b) {
    if (a.has(id)) continue;
    if (add(subtreeBounds(after.layer, boundsOf))) return FULL;
  }
  // Sibling reorders shift indices of layers that were not themselves moved; those were
  // handled above via `moved`. Anything else unchanged contributes nothing.
  return any ? dirty : null;
}

/** Region of the composite affected by switching from `prev` to `next`. */
export function diffDocs(prev: DocState | null, next: DocState | null, boundsOf: BoundsFn): Rect | 'full' | null {
  if (prev === next) return null;
  if (!prev || !next) return FULL;
  if (prev.width !== next.width || prev.height !== next.height) return FULL;
  return diffLayers(prev.layers, next.layers, boundsOf);
}
