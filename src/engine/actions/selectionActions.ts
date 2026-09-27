import type { Editor } from '../Editor';
import { findLayer } from '../doc/layerTree';
import type { LayerId } from '../doc/types';
import {
  featherSelection,
  invertSelection,
  selectAll,
  selectionFromLayer,
  tightSelectionBounds,
} from '../selection/SelectionOps';
import { cropDocument } from './transformActions';

export function selectAllAction(editor: Editor): void {
  editor.commit('Select All', (d) => ({ ...d, selection: selectAll(editor) }));
}

export function deselect(editor: Editor): void {
  const sel = editor.doc?.selection;
  if (!sel) return;
  editor.lastSelection = sel;
  editor.commit('Deselect', (d) => ({ ...d, selection: null }));
}

export function reselect(editor: Editor): void {
  const sel = editor.lastSelection;
  if (!sel || !editor.surfaces.has(sel.surfaceId)) return;
  editor.commit('Reselect', (d) => ({ ...d, selection: sel }));
}

export function inverseSelection(editor: Editor): void {
  editor.commit('Inverse', (d) => ({ ...d, selection: invertSelection(editor, d.selection) }));
}

export function featherSelectionAction(editor: Editor, radius: number): void {
  editor.commit(`Feather ${radius}px`, (d) =>
    d.selection ? { ...d, selection: featherSelection(editor, d.selection, radius) } : d,
  );
}

/** Loads a layer's transparency as the selection (Ctrl/Cmd-click a layer thumbnail). */
export function loadLayerTransparency(editor: Editor, layerId?: LayerId): void {
  const doc = editor.doc;
  if (!doc) return;
  const layer = findLayer(doc.layers, layerId ?? doc.activeLayerId);
  if (!layer || layer.type !== 'pixel') {
    editor.notify('info', 'Only pixel layers have transparency to load as a selection.');
    return;
  }
  const sel = selectionFromLayer(editor, layer);
  editor.commit('Load Selection', (d) => ({ ...d, selection: sel }));
}

/** Image ▸ Crop to the selection's bounding box. */
export async function cropToSelection(editor: Editor): Promise<void> {
  const doc = editor.doc;
  if (!doc?.selection) return;
  const bounds = await tightSelectionBounds(editor, doc.selection);
  if (!bounds || editor.doc !== doc) {
    editor.notify('info', 'The selection is empty.');
    return;
  }
  cropDocument(editor, bounds, false);
}
