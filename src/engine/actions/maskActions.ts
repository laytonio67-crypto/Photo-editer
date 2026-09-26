import type { Editor } from '../Editor';
import { findLayer, updateLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerMask } from '../doc/types';
import { invertCoverage, invertSelection } from '../selection/SelectionOps';
import { renderLayersToSurface } from './layerActions';

function activeLayer(doc: DocState | null): Layer | null {
  return doc ? findLayer(doc.layers, doc.activeLayerId) : null;
}

export function canAddMask(doc: DocState | null): true | string {
  const layer = activeLayer(doc);
  if (!layer) return 'Select a layer first';
  if (layer.mask) return 'The layer already has a mask';
  return true;
}

export function needsMask(doc: DocState | null): true | string {
  const layer = activeLayer(doc);
  if (!layer) return 'Select a layer first';
  return layer.mask ? true : 'The layer has no mask';
}

/**
 * Adds a layer mask. With a selection the mask reveals (or hides) the selection;
 * otherwise it reveals (or hides) everything.
 */
export function addLayerMask(editor: Editor, hide: boolean): void {
  const doc = editor.doc;
  const layer = activeLayer(doc);
  if (!doc || !layer || layer.mask) return;
  let mask: LayerMask;
  if (doc.selection) {
    const sel = hide ? invertSelection(editor, doc.selection) : doc.selection;
    if (sel) {
      const copy = editor.surfaces.clone(sel.surfaceId);
      mask = { surfaceId: copy.id, x: sel.x, y: sel.y, defaultValue: sel.defaultValue, enabled: true, linked: true };
    } else {
      const s = editor.surfaces.createBlank(1, 1, 'r8', [0, 0, 0, 1]);
      mask = { surfaceId: s.id, x: 0, y: 0, defaultValue: 0, enabled: true, linked: true };
    }
  } else {
    const v = hide ? 0 : 1;
    const s = editor.surfaces.createBlank(1, 1, 'r8', [v, 0, 0, 1]);
    mask = { surfaceId: s.id, x: 0, y: 0, defaultValue: v * 255, enabled: true, linked: true };
  }
  editor.commit('Add Layer Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, mask })),
    editTarget: 'mask',
    selection: d.selection ? null : d.selection,
  }));
}

export function deleteLayerMask(editor: Editor): void {
  const layer = activeLayer(editor.doc);
  if (!layer?.mask) return;
  editor.commit('Delete Layer Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, mask: null })),
    editTarget: 'content',
  }));
}

export function toggleLayerMask(editor: Editor): void {
  const layer = activeLayer(editor.doc);
  const mask = layer?.mask;
  if (!layer || !mask) return;
  editor.commit(mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, mask: { ...mask, enabled: !mask.enabled } })),
  }));
}

export function toggleMaskLink(editor: Editor): void {
  const layer = activeLayer(editor.doc);
  const mask = layer?.mask;
  if (!layer || !mask) return;
  editor.commit(mask.linked ? 'Unlink Mask' : 'Link Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, mask: { ...mask, linked: !mask.linked } })),
  }));
}

/** Inverts the mask values (and its outside default). */
export function invertLayerMask(editor: Editor): void {
  const layer = activeLayer(editor.doc);
  const mask = layer?.mask;
  if (!layer || !mask) return;
  const s = editor.surfaces.get(mask.surfaceId);
  const surfaceId = invertCoverage(editor, {
    texture: editor.surfaces.texture(mask.surfaceId),
    x: mask.x,
    y: mask.y,
    width: s.width,
    height: s.height,
    defaultValue: mask.defaultValue / 255,
    channel: 'r',
  });
  editor.commit('Invert Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({
      ...l,
      mask: { ...mask, surfaceId, defaultValue: 255 - mask.defaultValue },
    })),
  }));
}

/** Bakes the mask into the layer's pixels and removes it. */
export function applyLayerMask(editor: Editor): void {
  const doc = editor.doc;
  const layer = activeLayer(doc);
  if (!doc || !layer?.mask || layer.type !== 'pixel') {
    if (layer?.mask) editor.notify('info', 'Only pixel layers can have their mask applied.');
    return;
  }
  const s = editor.surfaces.get(layer.surfaceId);
  const region = { x: layer.x, y: layer.y, width: s.width, height: s.height };
  const flat: Layer = { ...layer, opacity: 1, blendMode: 'normal', visible: true, mask: { ...layer.mask, enabled: true } };
  const surface = renderLayersToSurface(editor, doc, [flat], region);
  editor.commit('Apply Layer Mask', (d) => ({
    ...d,
    layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, surfaceId: surface.id, mask: null }) as Layer),
    editTarget: 'content',
  }));
}

/** Chooses whether painting affects the layer pixels or its mask (not an undoable edit). */
export function setEditTarget(editor: Editor, target: 'content' | 'mask'): void {
  editor.updateDocSilently((d) => {
    const layer = activeLayer(d);
    if (target === 'mask' && !layer?.mask) return d;
    return d.editTarget === target ? d : { ...d, editTarget: target };
  });
}
