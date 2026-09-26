import type { Editor } from '../Editor';
import {
  applyAffine,
  expandRect,
  isIdentityAffine,
  multiplyAffine,
  rotation,
  roundOutRect,
  scaling,
  transformedBounds,
  translation,
  unionRects,
  type Affine,
  type Point,
  type Rect,
} from '../geometry';
import type { DocState, Layer, LayerId } from '../doc/types';
import type { LayerSourceProvider } from '../render/Compositor';
import { movableLayerIds, transformLeaves } from '../ops/transformOps';
import { selectionContentBounds, transformLayersInDoc } from '../actions/transformActions';
import {
  HANDLE_RADIUS,
  ROTATE_CURSOR,
  drawHandle,
  drawPivot,
  hitHandle,
  pointInPolygon,
  resizeCursor,
  strokePolygon,
} from './overlay';
import type { Tool, ToolKeyEvent, ToolPointerEvent } from './types';

/** Transform parameters: M = T(c) · R(angle) · S(sx, sy) · T(−pivot). */
export interface TransformParams {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  /** Radians, clockwise on screen. */
  angle: number;
}

/** Handle positions as (u, v) fractions of the box: TL, T, TR, R, BR, B, BL, L. */
const HANDLE_UV: readonly [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];

export function transformMatrix(p: TransformParams, pivot: Point): Affine {
  return multiplyAffine(
    translation(p.cx, p.cy),
    multiplyAffine(rotation(p.angle), multiplyAffine(scaling(p.sx, p.sy), translation(-pivot.x, -pivot.y))),
  );
}

/**
 * New parameters for dragging a scale handle to `pointer`, keeping the opposite handle
 * (or the centre, with `fromCenter`) fixed. Corner handles scale proportionally unless
 * `toggleProportional` is set; edge handles the other way round.
 */
export function scaleFromHandle(
  params0: TransformParams,
  bounds: Rect,
  handle: number,
  pointer: Point,
  opts: { fromCenter: boolean; toggleProportional: boolean },
): TransformParams {
  const [u, v] = HANDLE_UV[handle]!;
  const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const handleLocal = { x: bounds.x + u * bounds.width, y: bounds.y + v * bounds.height };
  const anchorLocal = opts.fromCenter ? pivot : { x: bounds.x + (1 - u) * bounds.width, y: bounds.y + (1 - v) * bounds.height };
  const anchorDoc = applyAffine(transformMatrix(params0, pivot), anchorLocal);
  const cos = Math.cos(params0.angle);
  const sin = Math.sin(params0.angle);
  const d = { x: pointer.x - anchorDoc.x, y: pointer.y - anchorDoc.y };
  // Pointer offset in the box's rotated axes.
  const dxr = d.x * cos + d.y * sin;
  const dyr = -d.x * sin + d.y * cos;
  const hx = handleLocal.x - anchorLocal.x;
  const hy = handleLocal.y - anchorLocal.y;
  let sx = hx !== 0 ? dxr / hx : params0.sx;
  let sy = hy !== 0 ? dyr / hy : params0.sy;
  const corner = u !== 0.5 && v !== 0.5;
  const proportional = corner ? !opts.toggleProportional : opts.toggleProportional;
  if (proportional) {
    if (corner) {
      // Project the pointer onto the box diagonal through the anchor.
      const ex = hx * params0.sx;
      const ey = hy * params0.sy;
      const k = (dxr * ex + dyr * ey) / (ex * ex + ey * ey || 1);
      sx = params0.sx * k;
      sy = params0.sy * k;
    } else if (hx !== 0) {
      sy = params0.sy * (sx / params0.sx);
    } else {
      sx = params0.sx * (sy / params0.sy);
    }
  }
  const minScale = 1e-3;
  if (Math.abs(sx) < minScale) sx = sx < 0 ? -minScale : minScale;
  if (Math.abs(sy) < minScale) sy = sy < 0 ? -minScale : minScale;
  // Solve for the centre so the anchor stays where it was.
  const px = (anchorLocal.x - pivot.x) * sx;
  const py = (anchorLocal.y - pivot.y) * sy;
  return {
    cx: anchorDoc.x - (px * cos - py * sin),
    cy: anchorDoc.y - (px * sin + py * cos),
    sx,
    sy,
    angle: params0.angle,
  };
}

interface Session {
  ids: LayerId[];
  leafIds: Set<LayerId>;
  bounds: Rect;
  pivot: Point;
  params: TransformParams;
  contentRects: Map<LayerId, Rect>;
  doc: DocState;
  dirty: Rect;
}

type DragKind = 'move' | 'scale' | 'rotate';

/**
 * Free Transform (Ctrl/Cmd+T). A modal interaction: while active it receives all
 * canvas input, previews the transform live on the GPU and resamples on commit.
 */
export class TransformTool implements Tool {
  readonly id = 'transform' as const;
  private session: Session | null = null;
  private drag: { kind: DragKind; handle: number; start: Point; params0: TransformParams } | null = null;
  private hoverCursor = 'move';
  private readonly provider: LayerSourceProvider;

  constructor(private readonly editor: Editor) {
    this.provider = {
      sourceFor: (layer: Layer) => {
        const s = this.session;
        if (!s || !s.leafIds.has(layer.id) || layer.type !== 'pixel') return undefined;
        const surface = editor.surfaces.tryGet(layer.surfaceId);
        if (!surface) return undefined;
        const m = this.matrix();
        return {
          texture: editor.surfaces.texture(layer.surfaceId),
          x: layer.x,
          y: layer.y,
          width: surface.width,
          height: surface.height,
          transform: multiplyAffine(m, translation(layer.x, layer.y)),
          maskTransform:
            layer.mask && layer.mask.linked ? multiplyAffine(m, translation(layer.mask.x, layer.mask.y)) : undefined,
        };
      },
    };
  }

  get isActive(): boolean {
    return this.session !== null;
  }

  /** Starts Free Transform on the selected layers. */
  async begin(): Promise<void> {
    const editor = this.editor;
    const doc = editor.doc;
    if (!doc || this.session) return;
    const { ids, locked } = movableLayerIds(doc);
    if (ids.length === 0) {
      editor.notify('info', locked.length ? 'The selected layer is position-locked.' : 'Select a layer to transform.');
      return;
    }
    const pixelLocked = transformLeaves(doc, ids).some((l) => l.locks.pixels && l.type === 'pixel');
    if (pixelLocked) {
      editor.notify('info', 'A selected layer has locked pixels and cannot be transformed.');
      return;
    }
    const { bounds, contentRects } = await selectionContentBounds(editor, doc, ids);
    if (editor.doc !== doc) return;
    if (!bounds) {
      editor.notify('info', 'The selected layers are empty — there is nothing to transform.');
      return;
    }
    const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    this.session = {
      ids,
      leafIds: new Set(transformLeaves(doc, ids).map((l) => l.id)),
      bounds,
      pivot,
      params: { cx: pivot.x, cy: pivot.y, sx: 1, sy: 1, angle: 0 },
      contentRects,
      doc,
      dirty: bounds,
    };
    editor.compositor.providers.unshift(this.provider);
    editor.tools.setMode(this);
    this.publish();
  }

  matrix(): Affine {
    const s = this.session;
    return s ? transformMatrix(s.params, s.pivot) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  private transformedDocBounds(): Rect {
    const s = this.session!;
    return roundOutRect(transformedBounds(this.matrix(), s.bounds));
  }

  /** Mirrors numeric state to the store and invalidates the preview region. */
  private publish(): void {
    const s = this.session;
    if (!s) return;
    const now = expandRect(this.transformedDocBounds(), 2);
    this.editor.compositor.invalidate(unionRects(s.dirty, now));
    s.dirty = now;
    this.editor.store.set({
      interaction: {
        kind: 'transform',
        cx: s.params.cx,
        cy: s.params.cy,
        scaleX: s.params.sx * 100,
        scaleY: s.params.sy * 100,
        angle: (s.params.angle * 180) / Math.PI,
        width: s.bounds.width,
        height: s.bounds.height,
      },
    });
    this.editor.requestOverlay();
  }

  setParams(params: Partial<TransformParams>): void {
    const s = this.session;
    if (!s) return;
    s.params = { ...s.params, ...params };
    this.publish();
  }

  /** Numeric entry from the options bar (percent / degrees). */
  setNumeric(v: { cx?: number; cy?: number; scaleX?: number; scaleY?: number; angle?: number }): void {
    const s = this.session;
    if (!s) return;
    this.setParams({
      cx: v.cx ?? s.params.cx,
      cy: v.cy ?? s.params.cy,
      sx: v.scaleX !== undefined ? v.scaleX / 100 : s.params.sx,
      sy: v.scaleY !== undefined ? v.scaleY / 100 : s.params.sy,
      angle: v.angle !== undefined ? (v.angle * Math.PI) / 180 : s.params.angle,
    });
  }

  flip(axis: 'horizontal' | 'vertical'): void {
    const s = this.session;
    if (!s) return;
    this.setParams(axis === 'horizontal' ? { sx: -s.params.sx } : { sy: -s.params.sy });
  }

  private end(): void {
    const s = this.session;
    if (!s) return;
    const i = this.editor.compositor.providers.indexOf(this.provider);
    if (i >= 0) this.editor.compositor.providers.splice(i, 1);
    // Removing the preview changes both where the content was drawn and where it
    // originally sits.
    this.editor.compositor.invalidate(unionRects(s.dirty, expandRect(s.bounds, 2)));
    this.session = null;
    this.drag = null;
    this.editor.store.set({ interaction: null });
    this.editor.tools.setMode(null);
    this.editor.requestRender();
  }

  commit(): void {
    const s = this.session;
    if (!s) return;
    const m = this.matrix();
    const mode = this.editor.store.get().toolOptions.transform.interpolation;
    this.end();
    if (isIdentityAffine(m, 1e-7)) return;
    try {
      this.editor.commit('Free Transform', (d) =>
        transformLayersInDoc(this.editor, d, s.ids, m, { mode, contentRects: s.contentRects }),
      );
    } catch (err) {
      this.editor.notify('error', 'The transform could not be applied.', String(err));
    }
  }

  cancel(): void {
    this.end();
  }

  onCommitRequest(): void {
    this.commit();
  }

  onCancelRequest(): void {
    this.cancel();
  }

  // --------------------------------------------------------------- input

  private screenHandles(): Point[] {
    const s = this.session!;
    const m = this.matrix();
    return HANDLE_UV.map(([u, v]) =>
      this.editor.view.docToScreen(applyAffine(m, { x: s.bounds.x + u * s.bounds.width, y: s.bounds.y + v * s.bounds.height })),
    );
  }

  private hitTest(screen: Point): { kind: DragKind; handle: number; cursor: string } {
    const handles = this.screenHandles();
    const dpr = this.editor.view.dpr;
    const h = hitHandle(handles, screen, (HANDLE_RADIUS + 4) * dpr);
    const center = this.editor.view.docToScreen({ x: this.session!.params.cx, y: this.session!.params.cy });
    if (h >= 0) {
      const p = handles[h]!;
      return { kind: 'scale', handle: h, cursor: resizeCursor(Math.atan2(p.y - center.y, p.x - center.x)) };
    }
    const quad = [handles[0]!, handles[2]!, handles[4]!, handles[6]!];
    if (pointInPolygon(quad, screen)) return { kind: 'move', handle: -1, cursor: 'move' };
    return { kind: 'rotate', handle: -1, cursor: ROTATE_CURSOR };
  }

  cursor(): string {
    return this.hoverCursor;
  }

  onPointerDown(e: ToolPointerEvent): void {
    const s = this.session;
    if (!s) return;
    const hit = this.hitTest(e.screen);
    this.drag = { kind: hit.kind, handle: hit.handle, start: e.doc, params0: { ...s.params } };
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    const s = this.session;
    if (!s) return;
    if (!pressed || !this.drag) {
      const cursor = this.hitTest(e.screen).cursor;
      if (cursor !== this.hoverCursor) {
        this.hoverCursor = cursor;
        this.editor.tools.refreshCursor();
      }
      return;
    }
    const { kind, params0, start, handle } = this.drag;
    if (kind === 'move') {
      let dx = e.doc.x - start.x;
      let dy = e.doc.y - start.y;
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Pure translations of unscaled, unrotated content stay pixel-exact.
      if (params0.angle === 0 && Math.abs(params0.sx) === 1 && Math.abs(params0.sy) === 1) {
        dx = Math.round(dx);
        dy = Math.round(dy);
      }
      this.setParams({ cx: params0.cx + dx, cy: params0.cy + dy });
    } else if (kind === 'rotate') {
      const c = { x: params0.cx, y: params0.cy };
      const a0 = Math.atan2(start.y - c.y, start.x - c.x);
      const a1 = Math.atan2(e.doc.y - c.y, e.doc.x - c.x);
      let angle = params0.angle + (a1 - a0);
      if (e.shift) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      this.setParams({ angle });
    } else {
      this.setParams(
        scaleFromHandle(params0, s.bounds, handle, e.doc, { fromCenter: e.alt, toggleProportional: e.shift }),
      );
    }
  }

  onPointerUp(): void {
    this.drag = null;
  }

  onCancel(): void {
    if (this.drag) this.setParams(this.drag.params0);
    this.drag = null;
  }

  onKeyDown(e: ToolKeyEvent): boolean {
    const s = this.session;
    if (!s) return false;
    if (e.key === 'Enter') {
      this.commit();
      return true;
    }
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    const step = e.shift ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (d) {
      this.setParams({ cx: s.params.cx + d[0], cy: s.params.cy + d[1] });
      return true;
    }
    return false;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.session) return;
    const dpr = this.editor.view.dpr;
    const handles = this.screenHandles();
    strokePolygon(ctx, dpr, [handles[0]!, handles[2]!, handles[4]!, handles[6]!]);
    for (const h of handles) drawHandle(ctx, h, dpr);
    drawPivot(ctx, this.editor.view.docToScreen({ x: this.session.params.cx, y: this.session.params.cy }), dpr);
  }

  hasActiveGesture(): boolean {
    return this.drag !== null;
  }
}
