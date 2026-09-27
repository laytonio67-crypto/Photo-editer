import type { Editor } from '../Editor';
import { expandRect, intersectRects, type Point, type Rect } from '../geometry';
import { healRegion } from '../paint/Healing';
import type { PaintTarget } from '../paint/PaintTarget';
import type { BrushOptions, CloneOptions } from './options';
import { StrokeTool, type StrokePaint, type StrokeSession } from './StrokeTool';
import type { ToolKeyEvent, ToolPointerEvent } from './types';

/**
 * Clone Stamp and Healing Brush. Alt-click sets the source point; strokes then copy
 * pixels from the source at a fixed offset. The Healing Brush additionally corrects the
 * copied pixels on release so their colour and shading blend into the destination
 * (see paint/Healing.ts).
 */
export class CloneTool extends StrokeTool {
  /** Source point (document px) set by Alt-click, and the document it belongs to. */
  private source: { point: Point; docId: string } | null = null;
  /** Aligned mode: source − destination offset, fixed by the first stroke. */
  private offset: Point | null = null;
  private altDown = false;
  private warnedNoHealing = false;

  constructor(
    editor: Editor,
    readonly id: 'cloneStamp' | 'healingBrush',
  ) {
    super(editor);
  }

  protected options(): CloneOptions {
    return this.editor.store.get().toolOptions[this.id];
  }

  protected setOptions(patch: Partial<BrushOptions>): void {
    this.editor.setToolOptions(this.id, patch);
  }

  protected label(): string {
    return this.id === 'cloneStamp' ? 'Clone Stamp' : 'Healing Brush';
  }

  /** The source point, if one is set for the open document (for tests and the UI). */
  get sourcePoint(): Point | null {
    const doc = this.editor.doc;
    return this.source && doc && this.source.docId === doc.id ? this.source.point : null;
  }

  protected override onAltPress(e: ToolPointerEvent): boolean {
    const doc = this.editor.doc;
    if (!doc) return true;
    this.source = { point: { x: e.doc.x, y: e.doc.y }, docId: doc.id };
    this.offset = null;
    this.editor.requestOverlay();
    return true;
  }

  protected prepare(target: PaintTarget, e: ToolPointerEvent): StrokePaint | string {
    const editor = this.editor;
    const doc = editor.doc!;
    if (target.part === 'mask') {
      return `The ${this.label()} paints layer pixels. Select the layer’s image thumbnail to edit its pixels.`;
    }
    const sourcePoint = this.sourcePoint;
    if (!sourcePoint) return `Alt-click to set the ${this.label()} source point first.`;
    const opts = this.options();
    // Whole-pixel offsets keep cloned pixels crisp (no resampling).
    const delta =
      opts.aligned && this.offset
        ? this.offset
        : { x: Math.round(sourcePoint.x - e.doc.x), y: Math.round(sourcePoint.y - e.doc.y) };
    if (opts.aligned) this.offset = delta;
    const base = { op: 'clone' as const, color: { r: 0, g: 0, b: 0 }, preserveAlpha: target.preserveAlpha };
    if (opts.sample === 'all') {
      // Snapshot the visible composite so the stroke never samples its own paint.
      editor.flush();
      const composite = editor.compositor.compositeTarget;
      if (!composite) return 'Nothing to sample.';
      const gpu = editor.gpu;
      const rect = { x: 0, y: 0, width: doc.width, height: doc.height };
      const snapshot = gpu.pool.acquire(doc.width, doc.height, 'rgba8');
      gpu.blit(composite, snapshot, rect);
      return { ...base, source: { texture: snapshot.texture, rect, delta }, release: () => gpu.pool.release(snapshot) };
    }
    // The layer surface itself stays untouched until the stroke is committed.
    return {
      ...base,
      source: {
        texture: editor.surfaces.texture(target.surfaceId),
        rect: { x: target.x, y: target.y, width: target.width, height: target.height },
        delta,
      },
    };
  }

  protected override finish(s: StrokeSession): Rect | null {
    if (this.id !== 'healingBrush' || !s.dirty || !s.paint.source) return null;
    const editor = this.editor;
    if (!editor.caps.halfFloatRenderable) {
      if (!this.warnedNoHealing) {
        this.warnedNoHealing = true;
        editor.notify('info', 'This graphics device cannot render the healing solve; the stroke was applied as a clone.');
      }
      return null;
    }
    const { target } = s;
    // One extra pixel so the solve's border lies outside the stroke.
    const region = intersectRects(expandRect(s.dirty, 1), { x: 0, y: 0, width: target.width, height: target.height });
    healRegion(editor.gpu, {
      out: s.preview,
      oldTexture: editor.surfaces.texture(target.surfaceId),
      region,
      docOffset: { x: target.x, y: target.y },
      stroke: s.coverage.texture,
      opacity: s.opts.opacity,
      selection: s.selection,
      source: s.paint.source,
      preserveAlpha: target.preserveAlpha,
    });
    return region;
  }

  deactivate(): void {
    this.altDown = false;
  }

  override onKeyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Alt') {
      this.altDown = true;
      this.editor.tools.refreshCursor();
      this.editor.requestOverlay();
      return true;
    }
    return super.onKeyDown(e);
  }

  onKeyUp(e: ToolKeyEvent): boolean {
    if (e.key !== 'Alt') return false;
    this.altDown = false;
    this.editor.tools.refreshCursor();
    this.editor.requestOverlay();
    return true;
  }

  /** Where the source marker is drawn (document px), if anywhere. */
  private markerPoint(pointer: Point | null): Point | null {
    const s = this.session;
    if (s?.paint.source && pointer) return { x: pointer.x + s.paint.source.delta.x, y: pointer.y + s.paint.source.delta.y };
    if (this.offset && this.options().aligned && pointer && this.sourcePoint) {
      return { x: pointer.x + this.offset.x, y: pointer.y + this.offset.y };
    }
    return this.sourcePoint;
  }

  override drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.editor.tools.pointer;
    const view = this.editor.view;
    const dpr = view.dpr;
    const alt = this.altDown || Boolean(p?.alt);
    if (p && !alt) this.drawBrushOutline(ctx, p.screen);
    const marker = this.markerPoint(p?.doc ?? null);
    if (marker && !alt) {
      // Crosshair at the sampling point.
      const c = view.docToScreen(marker);
      const r = 6 * dpr;
      ctx.save();
      for (const [color, w] of [
        ['rgba(0,0,0,0.75)', 3],
        ['rgba(255,255,255,0.95)', 1],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w * dpr;
        ctx.beginPath();
        ctx.moveTo(c.x - r, c.y);
        ctx.lineTo(c.x + r, c.y);
        ctx.moveTo(c.x, c.y - r);
        ctx.lineTo(c.x, c.y + r);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (p && alt) {
      // Target reticle: Alt-click sets the source here.
      const r = 9 * dpr;
      ctx.save();
      for (const [color, w] of [
        ['rgba(0,0,0,0.75)', 3],
        ['rgba(255,255,255,0.95)', 1],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w * dpr;
        ctx.beginPath();
        ctx.arc(p.screen.x, p.screen.y, r, 0, Math.PI * 2);
        ctx.moveTo(p.screen.x - r * 1.6, p.screen.y);
        ctx.lineTo(p.screen.x + r * 1.6, p.screen.y);
        ctx.moveTo(p.screen.x, p.screen.y - r * 1.6);
        ctx.lineTo(p.screen.x, p.screen.y + r * 1.6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  override cursor(): string {
    return this.altDown ? 'none' : super.cursor();
  }
}
