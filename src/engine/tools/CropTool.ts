import type { Editor } from '../Editor';
import type { Point, Rect } from '../geometry';
import { cropDocument } from '../actions/transformActions';
import type { CropRatio } from './options';
import { HANDLE_RADIUS, drawHandle, hitHandle, resizeCursor, strokePolygon } from './overlay';
import type { Tool, ToolKeyEvent, ToolPointerEvent } from './types';

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

export function cropRatioValue(ratio: CropRatio, docWidth: number, docHeight: number): number | null {
  if (ratio === 'free') return null;
  if (ratio === 'original') return docWidth / docHeight;
  const [a, b] = ratio.split(':').map(Number);
  return a && b ? a / b : null;
}

/** Normalises a rect that may have negative size. */
function normalize(r: Rect): Rect {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

/**
 * Resizes `rect0` by dragging handle (u, v) to `p`, honouring an aspect ratio.
 * Exported for unit tests.
 */
export function cropResize(rect0: Rect, u: number, v: number, p: Point, ratio: number | null): Rect {
  let x0 = rect0.x;
  let y0 = rect0.y;
  let x1 = rect0.x + rect0.width;
  let y1 = rect0.y + rect0.height;
  if (u === 0) x0 = p.x;
  if (u === 1) x1 = p.x;
  if (v === 0) y0 = p.y;
  if (v === 1) y1 = p.y;
  if (ratio) {
    let w = x1 - x0;
    let h = y1 - y0;
    if (u !== 0.5 && v !== 0.5) {
      // Corner: follow the dominant axis, keep the opposite corner fixed.
      if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / ratio);
      else w = (Math.sign(w) || 1) * Math.abs(h) * ratio;
      if (u === 0) x0 = x1 - w;
      else x1 = x0 + w;
      if (v === 0) y0 = y1 - h;
      else y1 = y0 + h;
    } else if (u === 0.5) {
      // Top/bottom edge: width follows, centred.
      const cx = (x0 + x1) / 2;
      w = Math.abs(h) * ratio;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
    } else {
      const cy = (y0 + y1) / 2;
      h = Math.abs(w) / ratio;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    }
  }
  return normalize({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, width: Math.max(1, Math.round(r.x + r.width) - x), height: Math.max(1, Math.round(r.y + r.height) - y) };
}

/** Crop tool: adjust the crop box, Enter commits, Esc resets. */
export class CropTool implements Tool {
  readonly id = 'crop' as const;
  private rect: Rect | null = null;
  private drag: { kind: 'new' | 'move' | 'scale'; handle: number; start: Point; rect0: Rect } | null = null;
  private hoverCursor = 'crosshair';

  private docKey = '';

  constructor(private readonly editor: Editor) {
    // Reset the box when the document is replaced or resized (undo, new document…).
    editor.store.subscribe(() => {
      const doc = editor.store.get().doc;
      const key = doc ? `${doc.id}:${doc.width}x${doc.height}` : '';
      if (key === this.docKey) return;
      this.docKey = key;
      if (this.rect && !this.drag) {
        this.rect = this.fullRect();
        this.applyRatio();
      }
    });
  }

  private fullRect(): Rect | null {
    const doc = this.editor.doc;
    return doc ? { x: 0, y: 0, width: doc.width, height: doc.height } : null;
  }

  private publish(): void {
    const r = this.rect;
    this.editor.store.set({ interaction: r ? { kind: 'crop', x: r.x, y: r.y, width: r.width, height: r.height } : null });
    this.editor.requestOverlay();
  }

  activate(): void {
    this.rect = this.fullRect();
    this.applyRatio();
    this.publish();
  }

  deactivate(): void {
    this.rect = null;
    this.drag = null;
    this.editor.store.set({ interaction: null });
  }

  private ratio(): number | null {
    const doc = this.editor.doc;
    if (!doc) return null;
    return cropRatioValue(this.editor.store.get().toolOptions.crop.ratio, doc.width, doc.height);
  }

  /** Fits the current box to the selected ratio (centred), e.g. after changing the preset. */
  applyRatio(): void {
    const ratio = this.ratio();
    const r = this.rect ?? this.fullRect();
    if (!r) return;
    if (!ratio) {
      this.rect = r;
    } else {
      let w = r.width;
      let h = w / ratio;
      if (h > r.height) {
        h = r.height;
        w = h * ratio;
      }
      this.rect = roundRect({ x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h });
    }
    this.publish();
  }

  setRect(r: Rect): void {
    this.rect = roundRect(r);
    this.publish();
  }

  reset(): void {
    this.rect = this.fullRect();
    this.applyRatio();
  }

  commit(): void {
    const r = this.rect;
    const doc = this.editor.doc;
    if (!r || !doc) return;
    if (r.x === 0 && r.y === 0 && r.width === doc.width && r.height === doc.height) return;
    cropDocument(this.editor, r, this.editor.store.get().toolOptions.crop.deletePixels);
    this.rect = this.fullRect();
    this.publish();
    this.editor.view.fitNoUpscale();
  }

  cursor(): string {
    return this.hoverCursor;
  }

  private screenHandles(r: Rect): Point[] {
    return HANDLE_UV.map(([u, v]) => this.editor.view.docToScreen({ x: r.x + u * r.width, y: r.y + v * r.height }));
  }

  private hit(screen: Point, doc: Point): { kind: 'new' | 'move' | 'scale'; handle: number; cursor: string } {
    const r = this.rect;
    if (!r) return { kind: 'new', handle: -1, cursor: 'crosshair' };
    const handles = this.screenHandles(r);
    const h = hitHandle(handles, screen, (HANDLE_RADIUS + 4) * this.editor.view.dpr);
    if (h >= 0) {
      const [u, v] = HANDLE_UV[h]!;
      return { kind: 'scale', handle: h, cursor: resizeCursor(Math.atan2(v - 0.5, u - 0.5)) };
    }
    const inside = doc.x >= r.x && doc.y >= r.y && doc.x <= r.x + r.width && doc.y <= r.y + r.height;
    return inside ? { kind: 'move', handle: -1, cursor: 'move' } : { kind: 'new', handle: -1, cursor: 'crosshair' };
  }

  onPointerDown(e: ToolPointerEvent): void {
    if (!this.rect) this.rect = this.fullRect();
    if (!this.rect) return;
    const hit = this.hit(e.screen, e.doc);
    this.drag = { kind: hit.kind, handle: hit.handle, start: e.doc, rect0: { ...this.rect } };
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (!pressed || !this.drag) {
      const cursor = this.hit(e.screen, e.doc).cursor;
      if (cursor !== this.hoverCursor) {
        this.hoverCursor = cursor;
        this.editor.tools.refreshCursor();
      }
      return;
    }
    const { kind, start, rect0, handle } = this.drag;
    const ratio = e.shift && !this.ratio() ? 1 : this.ratio();
    if (kind === 'move') {
      this.rect = roundRect({ ...rect0, x: rect0.x + e.doc.x - start.x, y: rect0.y + e.doc.y - start.y });
    } else if (kind === 'new') {
      let w = e.doc.x - start.x;
      let h = e.doc.y - start.y;
      if (ratio) {
        if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / ratio);
        else w = (Math.sign(w) || 1) * Math.abs(h) * ratio;
      }
      this.rect = roundRect(normalize({ x: start.x, y: start.y, width: w, height: h }));
    } else {
      const [u, v] = HANDLE_UV[handle]!;
      this.rect = roundRect(cropResize(rect0, u, v, e.doc, ratio));
    }
    this.publish();
  }

  onPointerUp(): void {
    this.drag = null;
    if (this.rect && (this.rect.width < 2 || this.rect.height < 2)) this.reset();
  }

  onCancel(): void {
    if (this.drag) this.rect = this.drag.rect0;
    this.drag = null;
    this.publish();
  }

  onKeyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Enter') {
      this.commit();
      return true;
    }
    if (e.key === 'Escape') {
      this.reset();
      return true;
    }
    return false;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    if (!r) return;
    const view = this.editor.view;
    const dpr = view.dpr;
    const tl = view.docToScreen({ x: r.x, y: r.y });
    const br = view.docToScreen({ x: r.x + r.width, y: r.y + r.height });
    // Shade everything outside the crop box.
    ctx.save();
    ctx.fillStyle = 'rgba(12,12,14,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.fill('evenodd');
    ctx.restore();
    const overlay = this.editor.store.get().toolOptions.crop.overlay;
    if (overlay !== 'none') {
      const n = overlay === 'thirds' ? 3 : 6;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = Math.round(tl.x + ((br.x - tl.x) * i) / n) + 0.5;
        const y = Math.round(tl.y + ((br.y - tl.y) * i) / n) + 0.5;
        ctx.moveTo(x, tl.y);
        ctx.lineTo(x, br.y);
        ctx.moveTo(tl.x, y);
        ctx.lineTo(br.x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    strokePolygon(ctx, dpr, [tl, { x: br.x, y: tl.y }, br, { x: tl.x, y: br.y }]);
    for (const h of this.screenHandles(r)) drawHandle(ctx, h, dpr);
  }

  hasActiveGesture(): boolean {
    return this.drag !== null;
  }
}
