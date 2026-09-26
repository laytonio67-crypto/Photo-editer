import type { Editor } from '../Editor';
import type { Layer, Selection } from '../doc/types';
import { expandRect, intersectRects, isEmptyRect, roundOutRect, unionRects, type Point, type Rect } from '../geometry';
import { createTexture } from '../gl/texture';
import { contentBounds } from '../render/AlphaBounds';
import { combineProgram, coverageBlurProgram } from './shaders';

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export type SelectionShape =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'polygon'; points: Point[] };

/** A coverage map placed in document space (texture + placement + default outside). */
export interface Coverage {
  texture: WebGLTexture;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 */
  defaultValue: number;
  channel: 'r' | 'a';
}

const MODE_INDEX: Record<SelectionMode, number> = { replace: 0, add: 1, subtract: 2, intersect: 3 };
const MODE_INVERT = 4;

export function shapeBounds(shape: SelectionShape): Rect {
  if (shape.kind !== 'polygon') return shape.rect;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of shape.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function docRectOf(editor: Editor): Rect {
  const doc = editor.doc!;
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

/** Rect of the selection's surface in document space. */
function surfaceRect(editor: Editor, sel: Selection): Rect {
  const s = editor.surfaces.get(sel.surfaceId);
  return { x: sel.x, y: sel.y, width: s.width, height: s.height };
}

/** The canvas area a selection can differ from zero in. */
function selectionExtent(editor: Editor, sel: Selection, docRect: Rect): Rect {
  return sel.defaultValue > 0 ? docRect : intersectRects(surfaceRect(editor, sel), docRect);
}

export function selectionCoverage(editor: Editor, sel: Selection): Coverage {
  const r = surfaceRect(editor, sel);
  return {
    texture: editor.surfaces.texture(sel.surfaceId),
    ...r,
    defaultValue: sel.defaultValue / 255,
    channel: 'r',
  };
}

/**
 * Rasterises a shape into a temporary texture whose alpha is coverage. Rectangles are
 * pixel-aligned (hard edges); ellipses and polygons are anti-aliased by Canvas 2D.
 * Call `dispose` when done.
 */
export function rasterizeShape(
  editor: Editor,
  shape: SelectionShape,
  docRect: Rect,
): { coverage: Coverage; dispose: () => void } | null {
  const b = intersectRects(roundOutRect(shapeBounds(shape)), docRect);
  if (isEmptyRect(b)) return null;
  const canvas = new OffscreenCanvas(b.width, b.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.translate(-b.x, -b.y);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  if (shape.kind === 'rect') {
    const x0 = Math.round(shape.rect.x);
    const y0 = Math.round(shape.rect.y);
    ctx.rect(x0, y0, Math.round(shape.rect.x + shape.rect.width) - x0, Math.round(shape.rect.y + shape.rect.height) - y0);
  } else if (shape.kind === 'ellipse') {
    const { x, y, width, height } = shape.rect;
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.fill('nonzero');
  const gl = editor.gpu.gl;
  const texture = createTexture(gl, 'rgba8', b.width, b.height);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, b.width, b.height, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return {
    coverage: { texture, x: b.x, y: b.y, width: b.width, height: b.height, defaultValue: 0, channel: 'a' },
    dispose: () => gl.deleteTexture(texture),
  };
}

/** Renders op(A, B) into a new R8 surface covering `extent`; returns its id. */
function renderCombined(editor: Editor, a: Coverage | null, b: Coverage | null, mode: number, extent: Rect): string {
  const gpu = editor.gpu;
  const out = editor.surfaces.createBlank(extent.width, extent.height, 'r8');
  const program = gpu.program('selCombine', combineProgram).use();
  const bind = (unit: number, prefix: string, c: Coverage | null): void => {
    gpu.bindTexture(unit, c ? c.texture : gpu.dummyR8);
    program
      .int(`u_${prefix}`, unit)
      .vec4(`u_${prefix}Rect`, c?.x ?? 0, c?.y ?? 0, c?.width ?? 0, c?.height ?? 0)
      .float(`u_${prefix}Default`, c?.defaultValue ?? 0)
      .int(`u_${prefix}Channel`, c?.channel === 'a' ? 3 : 0);
  };
  bind(0, 'a', a);
  bind(1, 'b', b);
  program.vec2('u_outOrigin', extent.x, extent.y).int('u_mode', mode);
  gpu.noBlend();
  gpu.drawRect(program, editor.surfaces.target(out.id), { x: 0, y: 0, width: extent.width, height: extent.height });
  gpu.bindTexture(0, null);
  gpu.bindTexture(1, null);
  editor.surfaces.markChanged(out.id);
  return out.id;
}

/** Combines a new coverage map with the current selection. */
export function combineCoverage(editor: Editor, current: Selection | null, b: Coverage, mode: SelectionMode): Selection | null {
  const docRect = docRectOf(editor);
  const bRect = intersectRects({ x: b.x, y: b.y, width: b.width, height: b.height }, docRect);
  if (!current || mode === 'replace') {
    if (mode === 'intersect') return null;
    if (mode === 'subtract') return current;
    if (isEmptyRect(bRect)) return null;
    const id = renderCombined(editor, null, b, MODE_INDEX.replace, bRect);
    return { surfaceId: id, x: bRect.x, y: bRect.y, defaultValue: 0, bounds: bRect };
  }
  const aExtent = selectionExtent(editor, current, docRect);
  let extent: Rect;
  let bounds: Rect;
  let defaultValue = current.defaultValue;
  switch (mode) {
    case 'add':
      extent = current.defaultValue > 0 ? docRect : unionRects(aExtent, bRect);
      bounds = unionRects(current.bounds, bRect);
      break;
    case 'subtract':
      extent = aExtent;
      bounds = current.bounds;
      break;
    case 'intersect':
      extent = intersectRects(aExtent, bRect);
      bounds = intersectRects(current.bounds, bRect);
      defaultValue = 0;
      break;
  }
  if (isEmptyRect(extent) || isEmptyRect(bounds)) return null;
  const id = renderCombined(editor, selectionCoverage(editor, current), b, MODE_INDEX[mode], extent);
  return { surfaceId: id, x: extent.x, y: extent.y, defaultValue, bounds: intersectRects(bounds, docRect) };
}

/** Applies a shape to the current selection with a boolean mode (null = no selection). */
export function applyShape(editor: Editor, current: Selection | null, shape: SelectionShape, mode: SelectionMode): Selection | null {
  const raster = rasterizeShape(editor, shape, docRectOf(editor));
  if (!raster) return mode === 'add' || mode === 'subtract' ? current : null;
  try {
    return combineCoverage(editor, current, raster.coverage, mode);
  } finally {
    raster.dispose();
  }
}

/** Selection covering the whole canvas. */
export function selectAll(editor: Editor): Selection {
  const s = editor.surfaces.createBlank(1, 1, 'r8', [1, 0, 0, 1]);
  return { surfaceId: s.id, x: 0, y: 0, defaultValue: 255, bounds: docRectOf(editor) };
}

/** Inverts a coverage map over its full surface extent (used for masks). */
export function invertCoverage(editor: Editor, c: Coverage): string {
  return renderCombined(editor, c, null, MODE_INVERT, { x: c.x, y: c.y, width: c.width, height: c.height });
}

/** Inverts a selection (no selection inverts to everything). */
export function invertSelection(editor: Editor, current: Selection | null): Selection | null {
  if (!current) return selectAll(editor);
  const docRect = docRectOf(editor);
  const extent = intersectRects(surfaceRect(editor, current), docRect);
  if (isEmptyRect(extent)) return current.defaultValue > 0 ? null : selectAll(editor);
  const id = renderCombined(editor, selectionCoverage(editor, current), null, MODE_INVERT, extent);
  const defaultValue = 255 - current.defaultValue;
  return { surfaceId: id, x: extent.x, y: extent.y, defaultValue, bounds: defaultValue > 0 ? docRect : extent };
}

/** Separable Gaussian blur of a coverage map into a new R8 surface covering `extent`. */
export function blurCoverage(editor: Editor, src: Coverage, extent: Rect, radius: number): string {
  const gpu = editor.gpu;
  const sigma = Math.max(0.5, radius / 2);
  const taps = Math.min(512, Math.ceil(sigma * 3));
  const program = gpu.program('covBlur', coverageBlurProgram).use();
  const temp = editor.surfaces.createBlank(extent.width, extent.height, 'r8');
  const out = editor.surfaces.createBlank(extent.width, extent.height, 'r8');
  const pass = (from: Coverage, toId: string, dir: [number, number]): void => {
    gpu.bindTexture(0, from.texture);
    program
      .int('u_src', 0)
      .vec4('u_srcRect', from.x, from.y, from.width, from.height)
      .float('u_srcDefault', from.defaultValue)
      .int('u_srcChannel', from.channel === 'a' ? 3 : 0)
      .vec2('u_outOrigin', extent.x, extent.y)
      .vec2('u_dir', dir[0], dir[1])
      .float('u_sigma', sigma)
      .int('u_radius', taps);
    gpu.noBlend();
    gpu.drawRect(program, editor.surfaces.target(toId), { x: 0, y: 0, width: extent.width, height: extent.height });
  };
  pass(src, temp.id, [1, 0]);
  pass(
    {
      texture: editor.surfaces.texture(temp.id),
      ...extent,
      defaultValue: src.defaultValue,
      channel: 'r',
    },
    out.id,
    [0, 1],
  );
  gpu.bindTexture(0, null);
  editor.surfaces.delete(temp.id);
  editor.surfaces.markChanged(out.id);
  return out.id;
}

/** Feathers (softens) a selection edge by `radius` px. */
export function featherSelection(editor: Editor, current: Selection, radius: number): Selection {
  if (radius <= 0) return current;
  const docRect = docRectOf(editor);
  const grow = Math.ceil(radius * 1.5) + 1;
  const extent = intersectRects(expandRect(selectionExtent(editor, current, docRect), grow), docRect);
  const id = blurCoverage(editor, selectionCoverage(editor, current), extent, radius);
  return {
    surfaceId: id,
    x: extent.x,
    y: extent.y,
    defaultValue: current.defaultValue,
    bounds: current.defaultValue > 0 ? docRect : intersectRects(expandRect(current.bounds, grow), docRect),
  };
}

/** Selection from a pixel layer's transparency (Ctrl/Cmd-click a thumbnail). */
export function selectionFromLayer(editor: Editor, layer: Layer): Selection | null {
  if (layer.type !== 'pixel') return null;
  const s = editor.surfaces.get(layer.surfaceId);
  const src: Coverage = {
    texture: editor.surfaces.texture(layer.surfaceId),
    x: layer.x,
    y: layer.y,
    width: s.width,
    height: s.height,
    defaultValue: 0,
    channel: 'a',
  };
  return combineCoverage(editor, null, src, 'replace');
}

/** Tight document bounds of the selected area (coverage > 0), or null if empty. */
export async function tightSelectionBounds(editor: Editor, sel: Selection): Promise<Rect | null> {
  const docRect = docRectOf(editor);
  if (sel.defaultValue > 0) return docRect;
  const s = editor.surfaces.get(sel.surfaceId);
  const local = await contentBounds(editor.gpu, editor.surfaces.texture(sel.surfaceId), s.width, s.height, 'red');
  if (!local) return null;
  const r = intersectRects({ x: local.x + sel.x, y: local.y + sel.y, width: local.width, height: local.height }, docRect);
  return isEmptyRect(r) ? null : r;
}

/** Moves a selection outline by whole pixels. */
export function offsetSelection(sel: Selection, dx: number, dy: number, docRect: Rect): Selection {
  if (dx === 0 && dy === 0) return sel;
  return {
    ...sel,
    x: sel.x + dx,
    y: sel.y + dy,
    bounds:
      sel.defaultValue > 0 ? docRect : intersectRects({ ...sel.bounds, x: sel.bounds.x + dx, y: sel.bounds.y + dy }, docRect),
  };
}
