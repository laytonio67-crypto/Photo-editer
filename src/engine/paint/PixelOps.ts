import type { Editor } from '../Editor';
import type { RGB } from '../doc/types';
import type { FramebufferLike } from '../gl/gpu';
import { intersectRects, isEmptyRect, type Point, type Rect } from '../geometry';
import type { Coverage } from '../selection/SelectionOps';
import { selectionCoverage, tightSelectionBounds } from '../selection/SelectionOps';
import { growTarget, resolvePaintTarget, type PaintTarget } from './PaintTarget';
import { paintCompositeProgram } from './shaders';

export type PaintOp = 'paint' | 'erase' | 'clone' | 'mask';

const OP_INDEX: Record<PaintOp, number> = { paint: 0, erase: 1, clone: 2, mask: 3 };

export interface PaintCompositeParams {
  dst: FramebufferLike;
  /** Rect in destination pixel coordinates to write. */
  dstRect: Rect;
  /** Previous pixels: `old[p + oldOffset]` for destination pixel p. */
  old: { texture: WebGLTexture; offset: Point };
  /** Document position of destination pixel (0,0). */
  docOffset: Point;
  stroke?: { texture: WebGLTexture; offset: Point } | null;
  selection?: Coverage | null;
  op: PaintOp;
  opacity: number;
  /** 0..255 RGB; for masks only `r` (grey) is used. */
  color: RGB;
  preserveAlpha: boolean;
  source?: { texture: WebGLTexture; rect: Rect; delta: Point } | null;
}

/** Runs the paint-composite shader (see shaders.ts) over one rect. */
export function runPaintComposite(editor: Editor, p: PaintCompositeParams): void {
  const gpu = editor.gpu;
  const program = gpu.program('paintComposite', paintCompositeProgram).use();
  gpu.bindTexture(0, p.old.texture);
  gpu.bindTexture(1, p.stroke?.texture ?? gpu.dummyR8);
  gpu.bindTexture(2, p.selection?.texture ?? gpu.dummyR8);
  gpu.bindTexture(3, p.source?.texture ?? gpu.dummyRGBA);
  program
    .int('u_old', 0)
    .vec2('u_oldOffset', p.old.offset.x, p.old.offset.y)
    .vec2('u_docOffset', p.docOffset.x, p.docOffset.y)
    .int('u_stroke', 1)
    .int('u_hasStroke', p.stroke ? 1 : 0)
    .vec2('u_strokeOffset', p.stroke?.offset.x ?? 0, p.stroke?.offset.y ?? 0)
    .int('u_sel', 2)
    .int('u_hasSel', p.selection ? 1 : 0)
    .vec4('u_selRect', p.selection?.x ?? 0, p.selection?.y ?? 0, p.selection?.width ?? 0, p.selection?.height ?? 0)
    .float('u_selDefault', p.selection?.defaultValue ?? 0)
    .int('u_op', OP_INDEX[p.op])
    .float('u_opacity', p.opacity)
    .vec3('u_color', p.color.r / 255, p.color.g / 255, p.color.b / 255)
    .int('u_preserveAlpha', p.preserveAlpha ? 1 : 0)
    .int('u_source', 3)
    .vec4('u_sourceRect', p.source?.rect.x ?? 0, p.source?.rect.y ?? 0, p.source?.rect.width ?? 0, p.source?.rect.height ?? 0)
    .vec2('u_sourceDelta', p.source?.delta.x ?? 0, p.source?.delta.y ?? 0);
  gpu.noBlend();
  gpu.drawRect(program, p.dst, p.dstRect);
  for (const unit of [0, 1, 2, 3]) gpu.bindTexture(unit, null);
}

/** Grey value used when painting masks with a colour (Rec. 601 luma, like pro editors). */
export function maskGrey(c: RGB): RGB {
  const v = Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  return { r: v, g: v, b: v };
}

/**
 * Rewrites `rect` (surface coordinates) of a paint target in place and returns the
 * history patch. The old pixels are copied aside first because a shader cannot read the
 * texture it renders into; the "before" readback is queued before the write.
 */
export function editTargetRegion(
  editor: Editor,
  target: PaintTarget,
  rect: Rect,
  params: Omit<PaintCompositeParams, 'dst' | 'dstRect' | 'old' | 'docOffset'>,
) {
  const gpu = editor.gpu;
  const surfaceTarget = editor.surfaces.target(target.surfaceId);
  const copy = gpu.pool.acquire(rect.width, rect.height, target.format);
  gpu.blit(surfaceTarget, copy, rect, 0, 0);
  const before = editor.surfaces.read(target.surfaceId, rect);
  runPaintComposite(editor, {
    ...params,
    dst: surfaceTarget,
    dstRect: rect,
    old: { texture: copy.texture, offset: { x: -rect.x, y: -rect.y } },
    docOffset: { x: target.x, y: target.y },
  });
  gpu.pool.release(copy);
  editor.surfaces.markChanged(target.surfaceId, rect);
  return { surfaceId: target.surfaceId, rect, before, after: null };
}

/**
 * Fills (or clears) the selection — or the whole layer without one — on the active
 * target. Used by Edit ▸ Fill, Delete and Cut.
 */
export async function fillSelection(
  editor: Editor,
  mode: 'foreground' | 'background' | 'clear',
  label: string,
  opacity = 1,
): Promise<boolean> {
  const doc = editor.doc;
  if (!doc) return false;
  const resolved = resolvePaintTarget(editor);
  if (typeof resolved === 'string') {
    editor.notify('info', resolved);
    return false;
  }
  const docRect = { x: 0, y: 0, width: doc.width, height: doc.height };
  const area = doc.selection ? await tightSelectionBounds(editor, doc.selection) : docRect;
  if (!area || editor.doc !== doc) return false;
  const tx = editor.beginTransaction();
  if (!tx) return false;
  try {
    let target = resolved;
    if (mode !== 'clear') {
      const grown = growTarget(editor, doc, target, area);
      target = grown.target;
      if (grown.doc !== doc) tx.update(() => grown.doc);
    }
    const local = intersectRects(
      { x: area.x - target.x, y: area.y - target.y, width: area.width, height: area.height },
      { x: 0, y: 0, width: target.width, height: target.height },
    );
    if (isEmptyRect(local)) {
      tx.cancel();
      return false;
    }
    const state = editor.store.get();
    const isMask = target.part === 'mask';
    const color = mode === 'background' ? state.background : state.foreground;
    const clearing = mode === 'clear';
    const patch = editTargetRegion(editor, target, local, {
      selection: doc.selection ? selectionCoverage(editor, doc.selection) : null,
      op: isMask ? 'mask' : clearing ? 'erase' : 'paint',
      opacity,
      // Clearing a mask hides (black); filling a mask uses the colour's grey value.
      color: isMask ? (clearing ? { r: 0, g: 0, b: 0 } : maskGrey(color)) : color,
      preserveAlpha: target.preserveAlpha,
    });
    tx.addPatch(patch);
    tx.commit(label);
    return true;
  } catch (err) {
    tx.cancel();
    editor.notify('error', `${label} failed.`, String(err));
    return false;
  }
}
