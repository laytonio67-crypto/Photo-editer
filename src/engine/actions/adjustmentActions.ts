import type { Editor } from '../Editor';
import { ADJUSTMENTS } from '../adjustments/registry';
import type { Adjustment, AdjustmentKind } from '../adjustments/types';
import { createAdjustmentLayer } from '../doc/factory';
import { findLayer, locateLayer, nextLayerName, updateLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerId, LayerMask } from '../doc/types';
import { addLayer, replaceLayer } from '../ops/layerOps';

/**
 * Adjustment layers and clipping masks. Adjustment parameters are plain data on the
 * layer, so every edit is an ordinary (undoable) document change and rendering picks it
 * up through the diff → full recomposite path.
 */

/**
 * New adjustment layer above the active layer. Like other pro editors it always comes
 * with a mask: the active selection when there is one, otherwise "reveal all" (a 1×1
 * surface whose outside value is white, so it costs no memory until painted).
 */
export function addAdjustmentLayer(editor: Editor, kind: AdjustmentKind): LayerId | null {
  const doc = editor.doc;
  if (!doc) return null;
  const info = ADJUSTMENTS[kind];
  let mask: LayerMask;
  if (doc.selection) {
    const copy = editor.surfaces.clone(doc.selection.surfaceId);
    mask = { surfaceId: copy.id, x: doc.selection.x, y: doc.selection.y, defaultValue: doc.selection.defaultValue, enabled: true, linked: true };
  } else {
    const s = editor.surfaces.createBlank(1, 1, 'r8', [1, 0, 0, 1]);
    mask = { surfaceId: s.id, x: 0, y: 0, defaultValue: 255, enabled: true, linked: true };
  }
  const layer = { ...createAdjustmentLayer({ name: nextLayerName(doc.layers, info.label), adjustment: info.defaults() }), mask };
  editor.commit(`New ${info.label} Layer`, (d) => ({ ...addLayer(d, layer), selection: d.selection ? null : d.selection }));
  return layer.id;
}

/**
 * Replaces an adjustment layer's parameters. Pass a `mergeKey` for continuous edits
 * (slider drags) so they collapse into one history entry.
 */
export function setAdjustment(editor: Editor, id: LayerId, adjustment: Adjustment, mergeKey?: string): void {
  editor.commit(
    ADJUSTMENTS[adjustment.kind].label,
    (d) => updateAdjustment(d, id, adjustment),
    mergeKey,
  );
}

/** Pure form of setAdjustment (used by scrub transactions). */
export function updateAdjustment(doc: DocState, id: LayerId, adjustment: Adjustment): DocState {
  return replaceLayer(doc, id, (l) => (l.type === 'adjustment' && l.adjustment.kind === adjustment.kind ? { ...l, adjustment } : l));
}

// ------------------------------------------------------------ clipping masks

/** The layer a clipped layer at `index` clips to (first unclipped layer below), if any. */
export function clippingBase(siblings: readonly Layer[], index: number): Layer | null {
  for (let i = index - 1; i >= 0; i--) {
    const l = siblings[i]!;
    if (!l.clipped) return l;
  }
  return siblings[0] ?? null;
}

/** Reason the active layer can't be clipped/released, or true. */
export function canToggleClipping(doc: DocState | null): true | string {
  if (!doc) return 'Open or create a document first';
  const layer = findLayer(doc.layers, doc.activeLayerId);
  if (!layer) return 'No layer selected';
  if (layer.clipped) return true;
  const loc = locateLayer(doc.layers, layer.id)!;
  if (loc.index === 0) return 'There is no layer below to clip to';
  const below = loc.siblings[loc.index - 1]!;
  const base = below.clipped ? clippingBase(loc.siblings, loc.index - 1) : below;
  if (base?.type === 'adjustment') return 'Adjustment layers have no content to clip to';
  return true;
}

/**
 * Alt+Mod+G: clips the active layer to the layer below, or releases it. Releasing a
 * layer in the middle of a clipping group also releases the clipped layers above it,
 * as they would otherwise clip to the released layer.
 */
export function toggleClippingMask(editor: Editor): void {
  const doc = editor.doc;
  if (!doc || canToggleClipping(doc) !== true) return;
  const layer = findLayer(doc.layers, doc.activeLayerId)!;
  if (!layer.clipped) {
    editor.commit('Create Clipping Mask', (d) => ({ ...d, layers: updateLayer(d.layers, layer.id, (l) => ({ ...l, clipped: true })) }));
    return;
  }
  const loc = locateLayer(doc.layers, layer.id)!;
  const release: LayerId[] = [];
  for (let i = loc.index; i < loc.siblings.length && loc.siblings[i]!.clipped; i++) release.push(loc.siblings[i]!.id);
  editor.commit('Release Clipping Mask', (d) => {
    let layers = d.layers;
    for (const id of release) layers = updateLayer(layers, id, (l) => ({ ...l, clipped: false }));
    return { ...d, layers };
  });
}
