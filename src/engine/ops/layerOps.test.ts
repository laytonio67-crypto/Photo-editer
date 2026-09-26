import { describe, expect, it } from 'vitest';
import { createDocState, createGroupLayer, createPixelLayer } from '../doc/factory';
import { findLayer, flattenLayers, panelOrder } from '../doc/layerTree';
import {
  addLayer,
  deleteLayers,
  groupLayers,
  moveLayersTo,
  renameLayer,
  selectLayer,
  setLayerProps,
  shiftLayer,
  soloVisibility,
  ungroupLayer,
} from './layerOps';

function makeDoc() {
  const bg = createPixelLayer({ name: 'Background', surfaceId: 's0' });
  const l1 = createPixelLayer({ name: 'L1', surfaceId: 's1' });
  const l2 = createPixelLayer({ name: 'L2', surfaceId: 's2' });
  const doc = createDocState({ name: 'd', width: 10, height: 10, layers: [bg, l1, l2] });
  return { doc, bg, l1, l2 };
}

const names = (layers: Parameters<typeof flattenLayers>[0]) => flattenLayers(layers).map((l) => l.name);

describe('layer operations', () => {
  it('adds above the active layer and activates it', () => {
    const { doc, l1 } = makeDoc();
    const withActive = selectLayer(doc, l1.id);
    const n = createPixelLayer({ name: 'New', surfaceId: 'sn' });
    const next = addLayer(withActive, n);
    expect(names(next.layers)).toEqual(['Background', 'L1', 'New', 'L2']);
    expect(next.activeLayerId).toBe(n.id);
  });

  it('selects with toggle and range modes', () => {
    const { doc, bg, l1, l2 } = makeDoc();
    let d = selectLayer(doc, l2.id);
    d = selectLayer(d, bg.id, 'range');
    expect(new Set(d.selectedLayerIds)).toEqual(new Set([bg.id, l1.id, l2.id]));
    d = selectLayer(d, l1.id, 'toggle');
    expect(d.selectedLayerIds).not.toContain(l1.id);
  });

  it('deletes layers and picks a sensible next active layer', () => {
    const { doc, l1, l2 } = makeDoc();
    const d = deleteLayers(selectLayer(doc, l2.id), [l2.id]);
    expect(names(d.layers)).toEqual(['Background', 'L1']);
    expect(d.activeLayerId).toBe(l1.id);
  });

  it('renames (trimming) and ignores empty names', () => {
    const { doc, l1 } = makeDoc();
    expect(findLayer(renameLayer(doc, l1.id, '  Sky  ').layers, l1.id)!.name).toBe('Sky');
    expect(renameLayer(doc, l1.id, '   ')).toBe(doc);
  });

  it('patches properties and rejects pass-through for non-groups', () => {
    const { doc, l1 } = makeDoc();
    const d = setLayerProps(doc, l1.id, { opacity: 0.5, blendMode: 'multiply' });
    expect(findLayer(d.layers, l1.id)).toMatchObject({ opacity: 0.5, blendMode: 'multiply' });
    expect(setLayerProps(doc, l1.id, { blendMode: 'passThrough' })).toBe(doc);
    expect(setLayerProps(doc, l1.id, { opacity: 1 })).toBe(doc);
  });

  it('groups and ungroups preserving order', () => {
    const { doc, l1, l2 } = makeDoc();
    let d = selectLayer(doc, l1.id);
    d = selectLayer(d, l2.id, 'toggle');
    const grouped = groupLayers(d);
    expect(panelOrder(grouped.layers, true).map((r) => `${r.layer.name}:${r.depth}`)).toEqual([
      'Group:0',
      'L2:1',
      'L1:1',
      'Background:0',
    ]);
    const ungrouped = ungroupLayer(grouped, grouped.activeLayerId!);
    expect(names(ungrouped.layers)).toEqual(['Background', 'L1', 'L2']);
  });

  it('shifts layers up/down and to top/bottom', () => {
    const { doc, bg, l2 } = makeDoc();
    expect(names(shiftLayer(doc, bg.id, 1).layers)).toEqual(['L1', 'Background', 'L2']);
    expect(names(shiftLayer(doc, bg.id, 'top').layers)).toEqual(['L1', 'L2', 'Background']);
    expect(shiftLayer(doc, l2.id, 1)).toBe(doc);
  });

  it('moves multiple layers into a group keeping their relative order', () => {
    const { doc, bg, l1, l2 } = makeDoc();
    const g = createGroupLayer({ name: 'G' });
    const withGroup = { ...doc, layers: [...doc.layers, g] };
    const d = moveLayersTo(withGroup, [l2.id, bg.id], g.id, 0);
    const group = findLayer(d.layers, g.id);
    expect(group?.type === 'group' && group.children.map((c) => c.name)).toEqual(['Background', 'L2']);
    expect(names(d.layers)).toEqual(['L1', 'G', 'Background', 'L2']);
    expect(findLayer(d.layers, l1.id)).toBeTruthy();
  });

  it('solos visibility and restores on second use', () => {
    const { doc, bg, l1 } = makeDoc();
    const solo = soloVisibility(doc, l1.id);
    expect(flattenLayers(solo.layers).filter((l) => l.visible).map((l) => l.name)).toEqual(['L1']);
    const restored = soloVisibility(solo, l1.id);
    expect(flattenLayers(restored.layers).every((l) => l.visible)).toBe(true);
    expect(findLayer(restored.layers, bg.id)!.visible).toBe(true);
  });
});
