import { describe, expect, it } from 'vitest';
import { createDocState, createGroupLayer, createPixelLayer } from '../doc/factory';
import { findLayer } from '../doc/layerTree';
import type { Layer, PixelLayer } from '../doc/types';
import { moveLayers, movableLayerIds, resizeCanvasPure, transformLeaves, translateLayer } from './transformOps';
import { selectLayer } from './layerOps';

function px(name: string, x = 0, y = 0): PixelLayer {
  return createPixelLayer({ name, surfaceId: `s_${name}`, x, y });
}

describe('transform ops', () => {
  it('translates layers with linked masks, leaving unlinked masks in place', () => {
    const base = px('A', 10, 20);
    const linked: Layer = { ...base, mask: { surfaceId: 'm', x: 0, y: 0, defaultValue: 255, enabled: true, linked: true } };
    const unlinked: Layer = { ...base, mask: { surfaceId: 'm', x: 0, y: 0, defaultValue: 255, enabled: true, linked: false } };
    expect(translateLayer(linked, 5, -3)).toMatchObject({ x: 15, y: 17, mask: { x: 5, y: -3 } });
    expect(translateLayer(unlinked, 5, -3)).toMatchObject({ x: 15, y: 17, mask: { x: 0, y: 0 } });
  });

  it('moves group descendants and rounds to whole pixels', () => {
    const a = px('A', 1, 1);
    const g = createGroupLayer({ name: 'G', children: [a] });
    const doc = createDocState({ name: 'd', width: 100, height: 100, layers: [g] });
    const moved = moveLayers(doc, [g.id], 2.4, 3.6);
    expect(findLayer(moved.layers, a.id)).toMatchObject({ x: 3, y: 5 });
    expect(moveLayers(doc, [g.id], 0.2, -0.3)).toBe(doc);
  });

  it('skips position-locked layers', () => {
    const a = px('A');
    const b: PixelLayer = { ...px('B'), locks: { transparency: false, pixels: false, position: true } };
    let doc = createDocState({ name: 'd', width: 10, height: 10, layers: [a, b] });
    doc = selectLayer(selectLayer(doc, a.id), b.id, 'toggle');
    expect(movableLayerIds(doc)).toEqual({ ids: [a.id], locked: [b.id] });
  });

  it('resizes the canvas around an anchor', () => {
    const a = px('A', 0, 0);
    const doc = createDocState({ name: 'd', width: 100, height: 50, layers: [a] });
    const centred = resizeCanvasPure(doc, 200, 150, 0.5, 0.5);
    expect(centred).toMatchObject({ width: 200, height: 150 });
    expect(findLayer(centred.layers, a.id)).toMatchObject({ x: 50, y: 50 });
    const topLeft = resizeCanvasPure(doc, 50, 20, 0, 0);
    expect(findLayer(topLeft.layers, a.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('expands groups into leaves', () => {
    const a = px('A');
    const b = px('B');
    const g = createGroupLayer({ name: 'G', children: [a, createGroupLayer({ name: 'H', children: [b] })] });
    const doc = createDocState({ name: 'd', width: 10, height: 10, layers: [g] });
    expect(transformLeaves(doc, [g.id]).map((l) => l.name)).toEqual(['A', 'B']);
  });
});
