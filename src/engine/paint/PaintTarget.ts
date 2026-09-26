import type { Editor } from '../Editor';
import { findLayer, isEffectivelyVisible, updateLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerId, SurfaceId } from '../doc/types';
import { containsRect, isEmptyRect, unionRects, type Rect } from '../geometry';

/** The pixels a paint operation writes to: a layer's content or its mask. */
export interface PaintTarget {
  layerId: LayerId;
  part: 'content' | 'mask';
  surfaceId: SurfaceId;
  /** Document position of the surface. */
  x: number;
  y: number;
  width: number;
  height: number;
  format: 'rgba8' | 'r8';
  /** Content with "lock transparent pixels": painting keeps existing alpha. */
  preserveAlpha: boolean;
  /** Mask value outside the surface (0..255). */
  maskDefault: number;
}

/** Why the active layer can't be painted on, or null if it can. */
export function paintTargetProblem(doc: DocState, layer: Layer | null): string | null {
  if (!layer) return 'Select a layer to paint on.';
  const part = doc.editTarget === 'mask' && layer.mask ? 'mask' : 'content';
  if (part === 'content') {
    if (layer.type === 'group') return 'Groups have no pixels of their own — select a layer inside the group.';
    if (layer.type === 'adjustment') return 'Adjustment layers have no pixels — add or select the layer mask to paint.';
    if (layer.type === 'text') return 'Text layers are vector — rasterize the layer (Layer ▸ Rasterize) to paint on it.';
    if (layer.locks.pixels) return 'The layer’s pixels are locked.';
  }
  if (!isEffectivelyVisible(doc.layers, layer.id)) return 'The target layer is hidden.';
  return null;
}

export function resolvePaintTarget(editor: Editor): PaintTarget | string {
  const doc = editor.doc;
  if (!doc) return 'Open or create a document first.';
  const layer = findLayer(doc.layers, doc.activeLayerId);
  const problem = paintTargetProblem(doc, layer);
  if (problem || !layer) return problem ?? 'Select a layer to paint on.';
  if (doc.editTarget === 'mask' && layer.mask) {
    const s = editor.surfaces.get(layer.mask.surfaceId);
    return {
      layerId: layer.id,
      part: 'mask',
      surfaceId: s.id,
      x: layer.mask.x,
      y: layer.mask.y,
      width: s.width,
      height: s.height,
      format: 'r8',
      preserveAlpha: false,
      maskDefault: layer.mask.defaultValue,
    };
  }
  if (layer.type !== 'pixel') return 'This layer has no pixels.';
  const s = editor.surfaces.get(layer.surfaceId);
  return {
    layerId: layer.id,
    part: 'content',
    surfaceId: s.id,
    x: layer.x,
    y: layer.y,
    width: s.width,
    height: s.height,
    format: 'rgba8',
    preserveAlpha: layer.locks.transparency,
    maskDefault: 255,
  };
}

/**
 * Makes sure the target surface covers `need` (document rect). If it doesn't, a larger
 * surface is allocated, the old pixels copied in, and a document referencing it is
 * returned. Layers therefore grow on demand, so empty layers stay tiny.
 */
export function growTarget(editor: Editor, doc: DocState, target: PaintTarget, need: Rect): { doc: DocState; target: PaintTarget } {
  const current = { x: target.x, y: target.y, width: target.width, height: target.height };
  if (isEmptyRect(need) || containsRect(current, need)) return { doc, target };
  // A 1×1 empty layer shouldn't pull its stray pixel position into the new bounds.
  const grown = target.width * target.height <= 1 && target.part === 'content' ? need : unionRects(current, need);
  const max = editor.caps.maxDocumentSize;
  if (grown.width > max || grown.height > max) {
    throw new Error(`The layer would exceed the ${max}px GPU limit.`);
  }
  const fill = target.format === 'r8' ? [target.maskDefault / 255, 0, 0, 1] : undefined;
  const surface = editor.surfaces.createBlank(grown.width, grown.height, target.format, fill);
  if (!(target.width * target.height <= 1 && target.part === 'content')) {
    editor.surfaces.copyRegion(
      target.surfaceId,
      { x: 0, y: 0, width: target.width, height: target.height },
      surface.id,
      target.x - grown.x,
      target.y - grown.y,
    );
  }
  const layers = updateLayer(doc.layers, target.layerId, (l) => {
    if (target.part === 'mask' && l.mask) return { ...l, mask: { ...l.mask, surfaceId: surface.id, x: grown.x, y: grown.y } };
    if (l.type === 'pixel') return { ...l, surfaceId: surface.id, x: grown.x, y: grown.y };
    return l;
  });
  return {
    doc: { ...doc, layers },
    target: { ...target, surfaceId: surface.id, x: grown.x, y: grown.y, width: grown.width, height: grown.height },
  };
}
