import type { Editor } from '../Editor';
import { createPixelLayer } from '../doc/factory';
import { findLayer, nextLayerName } from '../doc/layerTree';
import type { LayerId } from '../doc/types';
import { addLayer, deleteLayers, renameLayer, selectLayer, setLayerProps, type SelectMode } from '../ops/layerOps';

/**
 * Editor-level layer actions: structural ops from layerOps plus whatever GPU work
 * they need (allocating surfaces). Each records one history entry.
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

export function activeLayer(editor: Editor) {
  const doc = editor.doc;
  return doc ? findLayer(doc.layers, doc.activeLayerId) : null;
}
