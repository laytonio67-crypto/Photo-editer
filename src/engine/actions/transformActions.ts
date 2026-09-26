import type { Editor } from '../Editor';
import { findLayer, updateLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerId, LayerMask } from '../doc/types';
import {
  affine,
  multiplyAffine,
  scaling,
  translation,
  unionRects,
  type Affine,
  type Rect,
} from '../geometry';
import { cropSurface, resampleSurface, type ResampleMode } from '../render/Resampler';
import { contentBounds } from '../render/AlphaBounds';
import { mapAllLayers, movableLayerIds, offsetAllLayers, resizeCanvasPure, transformLeaves, translateLayer } from '../ops/transformOps';

export interface TransformOptions {
  mode?: ResampleMode;
  /** Layer-local content rects (tight alpha bounds) to limit resampling. */
  contentRects?: ReadonlyMap<LayerId, Rect>;
  /** Transform unlinked masks too (whole-canvas operations). */
  includeUnlinkedMasks?: boolean;
}

function isIntegerTranslation(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && Number.isInteger(m.e) && Number.isInteger(m.f);
}

function transformMask(editor: Editor, mask: LayerMask | null, m: Affine, opts: TransformOptions): LayerMask | null {
  if (!mask || (!mask.linked && !opts.includeUnlinkedMasks)) return mask;
  if (!editor.surfaces.has(mask.surfaceId)) return mask;
  const local = multiplyAffine(m, translation(mask.x, mask.y));
  const r = resampleSurface(editor.gpu, editor.surfaces, mask.surfaceId, local, {
    mode: opts.mode,
    outsideValue: mask.defaultValue / 255,
  });
  return r ? { ...mask, surfaceId: r.surface.id, x: r.x, y: r.y } : mask;
}

/** Resamples one non-group layer through `m` (document → document). */
function transformLeaf(editor: Editor, layer: Layer, m: Affine, opts: TransformOptions): Layer {
  if (isIntegerTranslation(m) && !opts.includeUnlinkedMasks) return translateLayer(layer, m.e, m.f);
  switch (layer.type) {
    case 'pixel': {
      const mask = transformMask(editor, layer.mask, m, opts);
      const local = multiplyAffine(m, translation(layer.x, layer.y));
      const r = resampleSurface(editor.gpu, editor.surfaces, layer.surfaceId, local, {
        mode: opts.mode,
        sourceRect: opts.contentRects?.get(layer.id),
      });
      if (!r) {
        // Transformed out of existence (e.g. zero scale): keep an empty layer.
        const empty = editor.surfaces.createBlank(1, 1, 'rgba8');
        return { ...layer, surfaceId: empty.id, x: 0, y: 0, mask };
      }
      return { ...layer, surfaceId: r.surface.id, x: r.x, y: r.y, mask };
    }
    case 'text': {
      // Text stays vector: fold the transform into position/rotation/scale.
      const p = { x: m.a * layer.x + m.c * layer.y + m.e, y: m.b * layer.x + m.d * layer.y + m.f };
      const sx = Math.hypot(m.a, m.b);
      const sy = (m.a * m.d - m.b * m.c) / (sx || 1);
      const rot = Math.atan2(m.b, m.a);
      return {
        ...layer,
        x: p.x,
        y: p.y,
        rotation: layer.rotation + rot,
        scaleX: layer.scaleX * sx,
        scaleY: layer.scaleY * sy,
        mask: transformMask(editor, layer.mask, m, opts),
      };
    }
    case 'adjustment':
      return { ...layer, mask: transformMask(editor, layer.mask, m, opts) };
    case 'group':
      return layer;
  }
}

/** Applies `m` to the given layers (groups expand to their descendants). */
export function transformLayersInDoc(
  editor: Editor,
  doc: DocState,
  ids: readonly LayerId[],
  m: Affine,
  opts: TransformOptions = {},
): DocState {
  let layers = doc.layers;
  for (const leaf of transformLeaves(doc, ids)) {
    layers = updateLayer(layers, leaf.id, (l) => transformLeaf(editor, l, m, opts));
  }
  // Group masks follow their group.
  const groups: Layer[] = [];
  const collectGroups = (layer: Layer): void => {
    if (layer.type !== 'group') return;
    groups.push(layer);
    layer.children.forEach(collectGroups);
  };
  for (const id of ids) {
    const l = findLayer(doc.layers, id);
    if (l) collectGroups(l);
  }
  for (const g of groups) {
    if (!g.mask) continue;
    const mask = transformMask(editor, g.mask, m, opts);
    if (mask !== g.mask) layers = updateLayer(layers, g.id, (l) => ({ ...l, mask }));
  }
  return layers === doc.layers ? doc : { ...doc, layers };
}

/** Whole-canvas transform: every layer and mask. */
function transformAll(editor: Editor, doc: DocState, m: Affine, mode: ResampleMode): DocState {
  return transformLayersInDoc(
    editor,
    doc,
    doc.layers.map((l) => l.id),
    m,
    { mode, includeUnlinkedMasks: true },
  );
}

// ------------------------------------------------------------ content bounds

const boundsCache = new WeakMap<Editor, Map<string, Rect | null>>();

/** Tight bounds (document coords) of a layer's visible pixels; null when empty. */
export async function layerContentBounds(editor: Editor, layer: Layer): Promise<Rect | null> {
  switch (layer.type) {
    case 'pixel': {
      const s = editor.surfaces.tryGet(layer.surfaceId);
      if (!s) return null;
      let cache = boundsCache.get(editor);
      if (!cache) {
        cache = new Map();
        boundsCache.set(editor, cache);
      }
      const key = `${s.id}:${s.version}`;
      let local = cache.get(key);
      if (local === undefined) {
        local = await contentBounds(editor.gpu, editor.surfaces.texture(s.id), s.width, s.height);
        if (cache.size > 256) cache.clear();
        cache.set(key, local);
      }
      return local ? { x: local.x + layer.x, y: local.y + layer.y, width: local.width, height: local.height } : null;
    }
    case 'group': {
      let acc: Rect | null = null;
      for (const child of layer.children) {
        if (!child.visible) continue;
        const b = await layerContentBounds(editor, child);
        if (b) acc = acc ? unionRects(acc, b) : b;
      }
      return acc;
    }
    case 'text':
      return editor.textBounds?.(layer) ?? null;
    case 'adjustment':
      return null;
  }
}

/** Union of content bounds of several layers plus per-pixel-layer local content rects. */
export async function selectionContentBounds(
  editor: Editor,
  doc: DocState,
  ids: readonly LayerId[],
): Promise<{ bounds: Rect | null; contentRects: Map<LayerId, Rect> }> {
  let bounds: Rect | null = null;
  const contentRects = new Map<LayerId, Rect>();
  for (const leaf of transformLeaves(doc, ids)) {
    const b = await layerContentBounds(editor, leaf);
    if (!b) continue;
    bounds = bounds ? unionRects(bounds, b) : b;
    if (leaf.type === 'pixel') {
      contentRects.set(leaf.id, { x: b.x - leaf.x, y: b.y - leaf.y, width: b.width, height: b.height });
    }
  }
  return { bounds, contentRects };
}

// ------------------------------------------------------------ layer commands

function lockedNotice(editor: Editor, count: number): void {
  editor.notify('info', count === 1 ? 'The layer is position-locked.' : 'Some layers are position-locked and were skipped.');
}

/** Flips selected layers in place about their content centre. */
export async function flipLayers(editor: Editor, axis: 'horizontal' | 'vertical'): Promise<void> {
  const doc = editor.doc;
  if (!doc) return;
  const { ids, locked } = movableLayerIds(doc);
  if (locked.length) lockedNotice(editor, locked.length);
  if (ids.length === 0) return;
  const { bounds, contentRects } = await selectionContentBounds(editor, doc, ids);
  if (!bounds || editor.doc !== doc) return;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const m =
    axis === 'horizontal' ? affine(-1, 0, 0, 1, 2 * cx, 0) : affine(1, 0, 0, -1, 0, 2 * cy);
  editor.commit(axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', (d) =>
    transformLayersInDoc(editor, d, ids, m, { mode: 'nearest', contentRects }),
  );
}

/** Rotates selected layers by a multiple of 90° about their content centre. */
export async function rotateLayers(editor: Editor, degrees: 90 | -90 | 180): Promise<void> {
  const doc = editor.doc;
  if (!doc) return;
  const { ids, locked } = movableLayerIds(doc);
  if (locked.length) lockedNotice(editor, locked.length);
  if (ids.length === 0) return;
  const { bounds, contentRects } = await selectionContentBounds(editor, doc, ids);
  if (!bounds || editor.doc !== doc) return;
  // Rotate about the centre, snapped so pixel centres land on pixel centres.
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const r = degrees === 180 ? affine(-1, 0, 0, -1, 0, 0) : degrees === 90 ? affine(0, 1, -1, 0, 0, 0) : affine(0, -1, 1, 0, 0, 0);
  let m = multiplyAffine(translation(cx, cy), multiplyAffine(r, translation(-cx, -cy)));
  // Odd-sized bounds rotated by 90° would land on half pixels: nudge to integers.
  m = { ...m, e: Math.round(m.e), f: Math.round(m.f) };
  const label = degrees === 180 ? 'Rotate 180°' : degrees === 90 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter Clockwise';
  editor.commit(label, (d) => transformLayersInDoc(editor, d, ids, m, { mode: 'nearest', contentRects }));
}

// ------------------------------------------------------------ canvas commands

export function flipCanvas(editor: Editor, axis: 'horizontal' | 'vertical'): void {
  const doc = editor.doc;
  if (!doc) return;
  const m = axis === 'horizontal' ? affine(-1, 0, 0, 1, doc.width, 0) : affine(1, 0, 0, -1, 0, doc.height);
  editor.commit(axis === 'horizontal' ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', (d) => ({
    ...transformAll(editor, d, m, 'nearest'),
    selection: null,
  }));
}

export function rotateCanvas(editor: Editor, degrees: 90 | -90 | 180): void {
  const doc = editor.doc;
  if (!doc) return;
  const { width: W, height: H } = doc;
  const m =
    degrees === 90
      ? affine(0, 1, -1, 0, H, 0)
      : degrees === -90
        ? affine(0, -1, 1, 0, 0, W)
        : affine(-1, 0, 0, -1, W, H);
  const size = degrees === 180 ? { width: W, height: H } : { width: H, height: W };
  const label = degrees === 180 ? 'Rotate Canvas 180°' : degrees === 90 ? 'Rotate Canvas 90° CW' : 'Rotate Canvas 90° CCW';
  editor.commit(label, (d) => ({ ...transformAll(editor, d, m, 'nearest'), ...size, selection: null }));
}

/** Resamples the whole image to a new pixel size. */
export function resizeImage(editor: Editor, width: number, height: number, mode: ResampleMode, resolution?: number): void {
  const doc = editor.doc;
  if (!doc) return;
  if (width === doc.width && height === doc.height) {
    if (resolution && resolution !== doc.resolution) editor.commit('Image Size', (d) => ({ ...d, resolution }));
    return;
  }
  const m = scaling(width / doc.width, height / doc.height);
  editor.commit('Image Size', (d) => ({
    ...transformAll(editor, d, m, mode),
    width,
    height,
    resolution: resolution ?? d.resolution,
    selection: null,
  }));
}

export function resizeCanvas(editor: Editor, width: number, height: number, anchorX: number, anchorY: number): void {
  editor.commit('Canvas Size', (d) => ({ ...resizeCanvasPure(d, width, height, anchorX, anchorY), selection: null }));
}

/**
 * Crops (or extends) the canvas to `rect`. Without `deletePixels` layers keep their
 * off-canvas pixels (non-destructive), so the crop can be widened again later.
 */
export function cropDocument(editor: Editor, rect: Rect, deletePixels: boolean): void {
  const r = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
  editor.commit('Crop', (d) => {
    let next: DocState = { ...offsetAllLayers(d, -r.x, -r.y), width: r.width, height: r.height, selection: null };
    if (deletePixels) {
      const canvas = { x: 0, y: 0, width: r.width, height: r.height };
      next = mapAllLayers(next, (layer) => {
        if (layer.type !== 'pixel') return layer;
        const s = editor.surfaces.get(layer.surfaceId);
        const inside =
          layer.x >= 0 && layer.y >= 0 && layer.x + s.width <= canvas.width && layer.y + s.height <= canvas.height;
        if (inside) return layer;
        const cropped = cropSurface(editor.surfaces, layer.surfaceId, {
          x: -layer.x,
          y: -layer.y,
          width: canvas.width,
          height: canvas.height,
        });
        return { ...layer, surfaceId: cropped.id, x: 0, y: 0 };
      });
    }
    return next;
  });
}

/** Resizes the selected layers' content to an exact pixel size (anchored top-left). */
export async function resizeLayersTo(editor: Editor, width: number, height: number): Promise<void> {
  const doc = editor.doc;
  if (!doc || width < 1 || height < 1) return;
  const { ids, locked } = movableLayerIds(doc);
  if (locked.length) lockedNotice(editor, locked.length);
  if (ids.length === 0) return;
  const { bounds, contentRects } = await selectionContentBounds(editor, doc, ids);
  if (!bounds || editor.doc !== doc) return;
  if (bounds.width === width && bounds.height === height) return;
  const m = multiplyAffine(
    translation(bounds.x, bounds.y),
    multiplyAffine(scaling(width / bounds.width, height / bounds.height), translation(-bounds.x, -bounds.y)),
  );
  const mode = editor.store.get().toolOptions.transform.interpolation;
  editor.commit('Resize Layer', (d) => transformLayersInDoc(editor, d, ids, m, { mode, contentRects }));
}
