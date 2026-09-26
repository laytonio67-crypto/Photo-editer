import type { Editor } from '../Editor';
import { createGroupLayer, createPixelLayer } from '../doc/factory';
import { findLayer, locateLayer, nextLayerName, panelOrder, removeLayer, updateLayer, walkLayers } from '../doc/layerTree';
import type { DocState, Layer, LayerBlendMode, LayerId, LayerLocks } from '../doc/types';
import { createId } from '../store';
import { unionRects, type Rect } from '../geometry';
import { copyProgram } from '../render/shaders/layer';
import {
  addLayer,
  deleteLayers,
  groupLayers,
  insertionPoint,
  moveLayersTo,
  renameLayer,
  selectLayer,
  setLayerProps,
  shiftLayer,
  topLevelSelection,
  ungroupLayer,
  type SelectMode,
} from '../ops/layerOps';
import { insertLayer } from '../doc/layerTree';

/**
 * Editor-level layer actions: structural ops from layerOps plus whatever GPU work
 * they need (allocating, cloning, merging surfaces). Each records one history entry.
 */

/**
 * New empty pixel layer above the active one. Empty layers start as a 1×1 transparent
 * surface; painting grows them on demand, so empty layers cost no memory.
 */
export function newPixelLayer(editor: Editor): LayerId | null {
  const doc = editor.doc;
  if (!doc) return null;
  const surface = editor.surfaces.createBlank(1, 1, 'rgba8');
  const layer = createPixelLayer({ name: nextLayerName(doc.layers), surfaceId: surface.id });
  editor.commit('New Layer', (d) => addLayer(d, layer));
  return layer.id;
}

/** New empty group above the active layer. */
export function newGroup(editor: Editor): void {
  editor.commit('New Group', (d) => addLayer(d, createGroupLayer({ name: nextLayerName(d.layers, 'Group') })));
}

export function groupSelected(editor: Editor): void {
  editor.commit('Group Layers', (d) => groupLayers(d, d.selectedLayerIds, nextLayerName(d.layers, 'Group')));
}

export function ungroupActive(editor: Editor): void {
  const doc = editor.doc;
  const layer = doc ? findLayer(doc.layers, doc.activeLayerId) : null;
  if (!layer || layer.type !== 'group') return;
  editor.commit('Ungroup Layers', (d) => ungroupLayer(d, layer.id));
}

export function deleteSelectedLayers(editor: Editor): void {
  const doc = editor.doc;
  if (!doc || doc.selectedLayerIds.length === 0) return;
  const label = doc.selectedLayerIds.length > 1 ? 'Delete Layers' : 'Delete Layer';
  editor.commit(label, (d) => deleteLayers(d, d.selectedLayerIds));
}

export function setLayerVisibility(editor: Editor, id: LayerId, visible: boolean): void {
  editor.commit(visible ? 'Show Layer' : 'Hide Layer', (d) => setLayerProps(d, id, { visible }));
}

export function renameLayerAction(editor: Editor, id: LayerId, name: string): void {
  editor.commit('Rename Layer', (d) => renameLayer(d, id, name));
}

/** Layer selection is not an undoable edit (matches common editor behaviour). */
export function selectLayerAction(editor: Editor, id: LayerId, mode: SelectMode = 'replace'): void {
  editor.updateDocSilently((d) => selectLayer(d, id, mode));
}

export function activeLayer(editor: Editor): Layer | null {
  const doc = editor.doc;
  return doc ? findLayer(doc.layers, doc.activeLayerId) : null;
}

/** Opacity changes from sliders merge into one history entry per gesture. */
export function setLayerOpacity(editor: Editor, id: LayerId, opacity: number, mergeKey?: string): void {
  editor.commit('Layer Opacity', (d) => setLayerProps(d, id, { opacity: Math.max(0, Math.min(1, opacity)) }), mergeKey);
}

export function setLayerBlendMode(editor: Editor, id: LayerId, blendMode: LayerBlendMode): void {
  editor.commit('Blend Mode', (d) => setLayerProps(d, id, { blendMode }));
}

export function setLayerLocks(editor: Editor, id: LayerId, locks: Partial<LayerLocks>): void {
  const layer = activeLayerById(editor, id);
  if (!layer) return;
  editor.commit('Lock Layer', (d) => setLayerProps(d, id, { locks: { ...layer.locks, ...locks } }));
}

function activeLayerById(editor: Editor, id: LayerId): Layer | null {
  const doc = editor.doc;
  return doc ? findLayer(doc.layers, id) : null;
}

export function reorderLayers(editor: Editor, ids: LayerId[], parentId: LayerId | null, index: number): void {
  editor.commit('Move Layers', (d) => moveLayersTo(d, ids, parentId, index));
}

export function shiftActiveLayer(editor: Editor, direction: 1 | -1 | 'top' | 'bottom'): void {
  const doc = editor.doc;
  if (!doc?.activeLayerId) return;
  const id = doc.activeLayerId;
  const label = direction === 'top' ? 'Bring to Front' : direction === 'bottom' ? 'Send to Back' : direction === 1 ? 'Bring Forward' : 'Send Backward';
  editor.commit(label, (d) => shiftLayer(d, id, direction));
}

/** Alt+[ / Alt+]: activates the layer below/above in panel order. */
export function selectAdjacentLayer(editor: Editor, direction: 'up' | 'down'): void {
  const doc = editor.doc;
  if (!doc) return;
  const rows = panelOrder(doc.layers);
  const i = rows.findIndex((r) => r.layer.id === doc.activeLayerId);
  const next = rows[direction === 'up' ? i - 1 : i + 1];
  if (next) selectLayerAction(editor, next.layer.id);
}

// ------------------------------------------------------------ duplication

function copyName(layers: readonly Layer[], name: string): string {
  const base = name.replace(/ copy( \d+)?$/, '');
  const names = new Set<string>();
  walkLayers(layers, (l) => {
    names.add(l.name);
  });
  if (!names.has(`${base} copy`)) return `${base} copy`;
  for (let i = 2; ; i++) if (!names.has(`${base} copy ${i}`)) return `${base} copy ${i}`;
}

/** Deep-copies a layer with new ids and cloned pixel/mask surfaces. */
export function cloneLayer(editor: Editor, layer: Layer, name?: string): Layer {
  const mask = layer.mask ? { ...layer.mask, surfaceId: editor.surfaces.clone(layer.mask.surfaceId).id } : null;
  const base = { ...layer, id: createId(layer.type === 'group' ? 'group' : 'layer'), name: name ?? layer.name, mask };
  switch (base.type) {
    case 'pixel':
      return { ...base, surfaceId: editor.surfaces.clone(base.surfaceId).id };
    case 'group':
      return { ...base, children: base.children.map((c) => cloneLayer(editor, c)) };
    default:
      return base;
  }
}

/** Ctrl+J: duplicates the selected layers directly above themselves. */
export function duplicateSelectedLayers(editor: Editor): void {
  const doc = editor.doc;
  if (!doc) return;
  const targets = topLevelSelection(doc);
  if (targets.length === 0) return;
  editor.commit(targets.length > 1 ? 'Duplicate Layers' : 'Duplicate Layer', (d) => {
    let layers = d.layers;
    const copies: LayerId[] = [];
    for (const id of targets) {
      const layer = findLayer(layers, id);
      const loc = locateLayer(layers, id);
      if (!layer || !loc) continue;
      const copy = cloneLayer(editor, layer, copyName(layers, layer.name));
      layers = insertLayer(layers, loc.parent?.id ?? null, loc.index + 1, copy);
      copies.push(copy.id);
    }
    return {
      ...d,
      layers,
      activeLayerId: copies[copies.length - 1] ?? d.activeLayerId,
      selectedLayerIds: copies,
      editTarget: 'content',
    };
  });
}

// ------------------------------------------------------------ merging

/** Composites `layers` (as they appear in `doc`) over transparency into a new surface. */
export function renderLayersToSurface(editor: Editor, doc: DocState, layers: readonly Layer[], region: Rect) {
  const gpu = editor.gpu;
  const acc = editor.compositor.renderRegion(doc, region, layers);
  const surface = editor.surfaces.createBlank(region.width, region.height, 'rgba8');
  const program = gpu.program('copy', copyProgram).use();
  gpu.bindTexture(0, acc.texture);
  program.int('u_src', 0).vec2('u_offset', 0, 0);
  gpu.noBlend();
  gpu.drawRect(program, editor.surfaces.target(surface.id), { x: 0, y: 0, width: region.width, height: region.height });
  gpu.bindTexture(0, null);
  gpu.pool.release(acc);
  editor.surfaces.markChanged(surface.id);
  return surface;
}

function surfaceRect(editor: Editor, layer: Layer): Rect | null {
  if (layer.type !== 'pixel') return null;
  const s = editor.surfaces.tryGet(layer.surfaceId);
  return s ? { x: layer.x, y: layer.y, width: s.width, height: s.height } : null;
}

/** Reason Merge Down is unavailable, or true. */
export function canMergeDown(doc: DocState | null): true | string {
  if (!doc) return 'Open or create a document first';
  const layer = findLayer(doc.layers, doc.activeLayerId);
  if (!layer) return 'No layer selected';
  const loc = locateLayer(doc.layers, layer.id)!;
  const below = loc.siblings[loc.index - 1];
  if (!below) return 'There is no layer below to merge into';
  if (layer.type !== 'pixel' && layer.type !== 'text') return 'Only pixel and text layers can be merged down';
  if (below.type !== 'pixel') return 'The layer below is not a pixel layer';
  if (!layer.visible || !below.visible) return 'Both layers must be visible';
  if (below.locks.pixels) return 'The layer below is locked';
  return true;
}

/**
 * Ctrl+E: composites the active layer onto the pixel layer below. The lower layer's
 * mask is applied; it keeps its own opacity and blend mode.
 */
export function mergeDown(editor: Editor): void {
  const doc = editor.doc;
  if (!doc || canMergeDown(doc) !== true) return;
  const upper = findLayer(doc.layers, doc.activeLayerId)!;
  const loc = locateLayer(doc.layers, upper.id)!;
  const lower = loc.siblings[loc.index - 1] as Extract<Layer, { type: 'pixel' }>;
  const lowerRect = surfaceRect(editor, lower)!;
  const upperRect = surfaceRect(editor, upper) ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  const region = unionRects(lowerRect, upperRect);
  const flatLower: Layer = { ...lower, opacity: 1, blendMode: 'normal' };
  const surface = renderLayersToSurface(editor, doc, [flatLower, upper], region);
  editor.commit('Merge Down', (d) => {
    let layers = removeLayer(d.layers, upper.id);
    layers = updateLayer(layers, lower.id, (l) => ({ ...l, surfaceId: surface.id, x: region.x, y: region.y, mask: null }) as Layer);
    return { ...d, layers, activeLayerId: lower.id, selectedLayerIds: [lower.id], editTarget: 'content' };
  });
}

/** Merges all visible layers into one pixel layer (hidden layers are kept). */
export function mergeVisible(editor: Editor): void {
  const doc = editor.doc;
  if (!doc) return;
  const visible = doc.layers.filter((l) => l.visible);
  if (visible.length < 2) {
    editor.notify('info', 'At least two visible layers are needed to merge.');
    return;
  }
  const region = { x: 0, y: 0, width: doc.width, height: doc.height };
  const surface = renderLayersToSurface(editor, doc, visible, region);
  const merged = createPixelLayer({ name: 'Merged', surfaceId: surface.id });
  editor.commit('Merge Visible', (d) => {
    const topIndex = Math.max(...d.layers.map((l, i) => (l.visible ? i : -1)));
    const kept = d.layers.filter((l) => !l.visible);
    const hiddenBelow = d.layers.slice(0, topIndex).filter((l) => !l.visible).length;
    const layers = [...kept];
    layers.splice(hiddenBelow, 0, merged);
    return { ...d, layers, activeLayerId: merged.id, selectedLayerIds: [merged.id], editTarget: 'content' };
  });
}

/** Flattens every visible layer into a single layer (hidden layers are discarded). */
export function flattenImage(editor: Editor): void {
  const doc = editor.doc;
  if (!doc) return;
  const region = { x: 0, y: 0, width: doc.width, height: doc.height };
  const surface = renderLayersToSurface(editor, doc, doc.layers.filter((l) => l.visible), region);
  const flat = createPixelLayer({ name: 'Background', surfaceId: surface.id });
  editor.commit('Flatten Image', (d) => ({
    ...d,
    layers: [flat],
    activeLayerId: flat.id,
    selectedLayerIds: [flat.id],
    editTarget: 'content',
  }));
}

/** New layer from a surface, inserted above the active layer. */
export function addLayerFromSurface(editor: Editor, surfaceId: string, name: string, x: number, y: number, label: string): LayerId | null {
  const doc = editor.doc;
  if (!doc) return null;
  const layer = createPixelLayer({ name, surfaceId, x, y });
  editor.commit(label, (d) => addLayer(d, layer, insertionPoint(d)));
  return layer.id;
}
