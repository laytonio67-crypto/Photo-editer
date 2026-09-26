import type { Editor } from '../Editor';
import { findLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerMask, Selection } from '../doc/types';
import { intersectRects, isEmptyRect, type Rect } from '../geometry';
import { tightSelectionBounds } from '../selection/SelectionOps';
import { fillSelection } from '../paint/PixelOps';
import { addLayerFromSurface, renderLayersToSurface } from './layerActions';

/** Pixels copied inside the editor, with their original document position. */
export interface ClipboardContent {
  surfaceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function selectionAsMask(sel: Selection): LayerMask {
  return { surfaceId: sel.surfaceId, x: sel.x, y: sel.y, defaultValue: sel.defaultValue, enabled: true, linked: true };
}

/** Straight-alpha PNG of a surface, for the system clipboard. */
async function surfaceToPng(editor: Editor, surfaceId: string): Promise<Blob> {
  const s = editor.surfaces.get(surfaceId);
  const px = await editor.surfaces.read(surfaceId);
  const img = new ImageData(s.width, s.height);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!;
    if (a === 0) continue;
    img.data[i] = Math.min(255, Math.round((px[i]! * 255) / a));
    img.data[i + 1] = Math.min(255, Math.round((px[i + 1]! * 255) / a));
    img.data[i + 2] = Math.min(255, Math.round((px[i + 2]! * 255) / a));
    img.data[i + 3] = a;
  }
  const canvas = new OffscreenCanvas(s.width, s.height);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Copies the selected pixels of the active layer (or of all visible layers when
 * `merged`) into the editor clipboard and, when permitted, the system clipboard.
 */
export async function copySelection(editor: Editor, merged: boolean): Promise<boolean> {
  const doc = editor.doc;
  if (!doc) return false;
  const layer = findLayer(doc.layers, doc.activeLayerId);
  if (!merged && layer?.type !== 'pixel') {
    editor.notify('info', 'Select a pixel layer to copy from (or use Copy Merged).');
    return false;
  }
  const docRect = { x: 0, y: 0, width: doc.width, height: doc.height };
  let area: Rect | null = doc.selection ? await tightSelectionBounds(editor, doc.selection) : docRect;
  if (area && !merged && layer?.type === 'pixel') {
    const s = editor.surfaces.get(layer.surfaceId);
    area = intersectRects(area, { x: layer.x, y: layer.y, width: s.width, height: s.height });
  }
  if (!area || isEmptyRect(area) || editor.doc !== doc) {
    editor.notify('info', 'The selected area is empty.');
    return false;
  }
  let surfaceId: string;
  if (merged) {
    const flat = renderLayersToSurface(editor, doc, doc.layers.filter((l) => l.visible), area);
    surfaceId = flat.id;
    if (doc.selection) {
      const asLayer: Layer = {
        id: 'clip',
        type: 'pixel',
        name: 'clip',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locks: { transparency: false, pixels: false, position: false },
        mask: selectionAsMask(doc.selection),
        clipped: false,
        surfaceId: flat.id,
        x: area.x,
        y: area.y,
      };
      surfaceId = renderLayersToSurface(editor, doc, [asLayer], area).id;
      editor.surfaces.delete(flat.id);
    }
  } else {
    const source = layer as Extract<Layer, { type: 'pixel' }>;
    const asLayer: Layer = {
      ...source,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      mask: doc.selection ? selectionAsMask(doc.selection) : null,
    };
    surfaceId = renderLayersToSurface(editor, doc, [asLayer], area).id;
  }
  setClipboard(editor, { surfaceId, ...area });
  // Best effort: also offer the pixels to other applications.
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const blob = await surfaceToPng(editor, surfaceId);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  } catch {
    // Permission denied or unsupported: the in-app clipboard still works.
  }
  return true;
}

export function setClipboard(editor: Editor, content: ClipboardContent | null): void {
  const prev = editor.clipboard;
  if (prev) editor.unpinSurface(prev.surfaceId);
  editor.clipboard = content;
  if (content) editor.pinSurface(content.surfaceId);
  editor.collectGarbage();
}

export async function cutSelection(editor: Editor): Promise<void> {
  if (await copySelection(editor, false)) await fillSelection(editor, 'clear', 'Cut');
}

/** Pastes the editor clipboard as a new layer at its original position (centred if off-canvas). */
export function pasteClipboard(editor: Editor): boolean {
  const doc: DocState | null = editor.doc;
  const clip = editor.clipboard;
  if (!doc || !clip || !editor.surfaces.has(clip.surfaceId)) return false;
  const copy = editor.surfaces.clone(clip.surfaceId);
  const onCanvas = !isEmptyRect(intersectRects({ x: clip.x, y: clip.y, width: clip.width, height: clip.height }, { x: 0, y: 0, width: doc.width, height: doc.height }));
  const x = onCanvas ? clip.x : Math.round((doc.width - clip.width) / 2);
  const y = onCanvas ? clip.y : Math.round((doc.height - clip.height) / 2);
  addLayerFromSurface(editor, copy.id, 'Pasted Layer', x, y, 'Paste');
  return true;
}
