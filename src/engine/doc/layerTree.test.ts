import { describe, expect, it } from 'vitest';
import { createDocState, createGroupLayer, createPixelLayer } from './factory';
import {
  collectDocSurfaces,
  findLayer,
  flattenLayers,
  insertLayer,
  isDescendantOf,
  moveLayer,
  nextLayerName,
  panelOrder,
  removeLayer,
  updateLayer,
} from './layerTree';
import { diffDocs } from './diff';
import type { Layer } from './types';

function px(name: string) {
  return createPixelLayer({ name, surfaceId: `s_${name}` });
}

describe('layer tree', () => {
  const a = px('A');
  const b = px('B');
  const c = px('C');
  const g = createGroupLayer({ name: 'G', children: [b, c] });
  const layers: Layer[] = [a, g];

  it('finds nested layers and flattens in render order', () => {
    expect(findLayer(layers, c.id)).toBe(c);
    expect(flattenLayers(layers).map((l) => l.name)).toEqual(['A', 'G', 'B', 'C']);
  });

  it('lists panel order top → bottom with depth', () => {
    expect(panelOrder(layers).map((r) => `${r.layer.name}:${r.depth}`)).toEqual(['G:0', 'C:1', 'B:1', 'A:0']);
  });

  it('updates immutably with structural sharing', () => {
    const next = updateLayer(layers, b.id, (l) => ({ ...l, name: 'B2' }));
    expect(next).not.toBe(layers);
    expect(next[0]).toBe(a); // untouched sibling is shared
    expect(findLayer(next, b.id)!.name).toBe('B2');
    expect(findLayer(layers, b.id)!.name).toBe('B'); // original untouched
    expect(updateLayer(layers, 'missing', (l) => l)).toBe(layers);
  });

  it('removes and inserts', () => {
    const removed = removeLayer(layers, b.id);
    expect(flattenLayers(removed).map((l) => l.name)).toEqual(['A', 'G', 'C']);
    const inserted = insertLayer(removed, g.id, 0, b);
    expect(flattenLayers(inserted).map((l) => l.name)).toEqual(['A', 'G', 'B', 'C']);
    expect(() => insertLayer(layers, a.id, 0, b)).toThrow();
  });

  it('moves layers and refuses cycles', () => {
    const moved = moveLayer(layers, a.id, g.id, 2);
    expect(flattenLayers(moved).map((l) => l.name)).toEqual(['G', 'B', 'C', 'A']);
    const inner = createGroupLayer({ name: 'Inner' });
    const withInner = insertLayer(layers, g.id, 0, inner);
    expect(moveLayer(withInner, g.id, inner.id, 0)).toBe(withInner);
    expect(isDescendantOf(withInner, inner.id, g.id)).toBe(true);
  });

  it('collects surfaces', () => {
    const doc = createDocState({ name: 'd', width: 10, height: 10, layers });
    expect([...collectDocSurfaces(doc)].sort()).toEqual(['s_A', 's_B', 's_C']);
  });

  it('names new layers after the highest number', () => {
    expect(nextLayerName([px('Layer 1'), px('Layer 7'), px('Background')])).toBe('Layer 8');
    expect(nextLayerName([])).toBe('Layer 1');
  });
});

describe('diffDocs', () => {
  const boundsOf = (l: Layer) =>
    l.type === 'pixel' ? { x: l.x, y: l.y, width: 10, height: 10 } : ('full' as const);

  it('returns null for identical docs and the union of changed bounds otherwise', () => {
    const a = createPixelLayer({ name: 'A', surfaceId: 'sa', x: 0, y: 0 });
    const b = createPixelLayer({ name: 'B', surfaceId: 'sb', x: 50, y: 50 });
    const doc = createDocState({ name: 'd', width: 100, height: 100, layers: [a, b] });
    expect(diffDocs(doc, doc, boundsOf)).toBeNull();
    const moved = { ...doc, layers: updateLayer(doc.layers, b.id, (l) => ({ ...l, x: 60 }) as Layer) };
    expect(diffDocs(doc, moved, boundsOf)).toEqual({ x: 50, y: 50, width: 20, height: 10 });
  });

  it('treats selection-only changes as no composite change', () => {
    const a = createPixelLayer({ name: 'A', surfaceId: 'sa' });
    const doc = createDocState({ name: 'd', width: 100, height: 100, layers: [a] });
    expect(diffDocs(doc, { ...doc, activeLayerId: null }, boundsOf)).toBeNull();
  });

  it('marks everything dirty for size changes', () => {
    const doc = createDocState({ name: 'd', width: 100, height: 100 });
    expect(diffDocs(doc, { ...doc, width: 50 }, boundsOf)).toBe('full');
  });

  it('only dirties a group subtree when group properties change', () => {
    const b = createPixelLayer({ name: 'B', surfaceId: 'sb', x: 20, y: 20 });
    const g = createGroupLayer({ name: 'G', children: [b] });
    const doc = createDocState({ name: 'd', width: 100, height: 100, layers: [g] });
    const faded = { ...doc, layers: updateLayer(doc.layers, g.id, (l) => ({ ...l, opacity: 0.5 })) };
    expect(diffDocs(doc, faded, boundsOf)).toEqual({ x: 20, y: 20, width: 10, height: 10 });
  });
});
