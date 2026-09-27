import type { Editor, Transaction } from '../Editor';
import type { Layer, RGB } from '../doc/types';
import { intersectRects, isEmptyRect, roundOutRect, unionRects, type Point, type Rect } from '../geometry';
import type { RenderTarget } from '../gl/renderTarget';
import type { LayerSourceProvider } from '../render/Compositor';
import { DabRenderer, type GpuDab } from '../paint/DabRenderer';
import { growTarget, resolvePaintTarget, type PaintTarget } from '../paint/PaintTarget';
import { runPaintComposite, type PaintOp } from '../paint/PixelOps';
import { StrokeEngine, type Dab } from '../paint/StrokeEngine';
import { selectionCoverage, type Coverage } from '../selection/SelectionOps';
import type { BrushOptions } from './options';
import type { Tool, ToolId, ToolKeyEvent, ToolPointerEvent } from './types';

/** What a stroke paints besides its dabs: operation, colour and optional clone source. */
export interface StrokePaint {
  op: PaintOp;
  color: RGB;
  preserveAlpha: boolean;
  /** Clone source placed in document space; sampled at destination + delta. */
  source?: { texture: WebGLTexture; rect: Rect; delta: Point } | null;
  /** Frees resources held for the stroke (e.g. a composite snapshot). */
  release?: () => void;
}

export interface StrokeSession {
  tx: Transaction;
  target: PaintTarget;
  engine: StrokeEngine;
  /** Coverage accumulated by dabs (target-sized). */
  coverage: RenderTarget;
  /** Target pixels with the stroke applied, shown live instead of the real surface. */
  preview: RenderTarget;
  /** Region of the preview (target px) that differs from the surface. */
  dirty: Rect | null;
  selection: Coverage | null;
  paint: StrokePaint;
  opts: BrushOptions;
  firstDab: Dab | null;
  lastDab: Dab | null;
}

/** Step used by [ and ] at a given size: finer steps for small brushes. */
function sizeStep(size: number): number {
  return size < 10 ? 1 : size < 100 ? 10 : size < 200 ? 25 : size < 500 ? 50 : 100;
}

/** Next brush size for [ (−1) or ] (+1), stepping through the same sizes both ways. */
export function nextBrushSize(size: number, direction: 1 | -1): number {
  const next = direction > 0 ? size + sizeStep(size) : size - sizeStep(size - 1);
  return Math.max(1, Math.min(5000, next));
}

/**
 * Base of the dab-based painting tools (brush, eraser, clone stamp, healing brush).
 * Dabs accumulate in a coverage buffer (flow build-up); the stroke is composited over
 * the target at `opacity` into a preview surface that the compositor shows instead of
 * the layer, and merged into the layer on release as one undo step.
 */
export abstract class StrokeTool implements Tool {
  abstract readonly id: ToolId;
  protected session: StrokeSession | null = null;
  private readonly dabs: DabRenderer;
  private readonly provider: LayerSourceProvider;
  /** End of the previous stroke, for Shift-click straight lines. */
  private lastStrokeEnd: { layerId: string; point: Dab } | null = null;

  constructor(protected readonly editor: Editor) {
    this.dabs = new DabRenderer(editor.gpu);
    this.provider = {
      sourceFor: (layer: Layer) => {
        const s = this.session;
        if (!s || s.target.part !== 'content' || layer.id !== s.target.layerId || layer.type !== 'pixel') return undefined;
        return { texture: s.preview.texture, x: s.target.x, y: s.target.y, width: s.target.width, height: s.target.height };
      },
      maskFor: (layer: Layer) => {
        const s = this.session;
        if (!s || s.target.part !== 'mask' || layer.id !== s.target.layerId) return undefined;
        return s.preview.texture;
      },
    };
  }

  /** Current options of this tool. */
  protected abstract options(): BrushOptions;
  protected abstract setOptions(patch: Partial<BrushOptions>): void;
  /** History label of a stroke. */
  protected abstract label(): string;
  /** Paint setup for a stroke starting at `e` on `target`, or why painting is impossible. */
  protected abstract prepare(target: PaintTarget, e: ToolPointerEvent): StrokePaint | string;
  /** Alt+press (e.g. pick a colour or a clone source). Return true if handled. */
  protected onAltPress(_e: ToolPointerEvent): boolean {
    return false;
  }
  /**
   * Runs after the last dab, before the preview is written to the layer. May rewrite
   * part of the preview (healing); returns the rect (target px) it changed.
   */
  protected finish(_s: StrokeSession): Rect | null {
    return null;
  }
  /** Called once a stroke has been committed. */
  protected strokeCommitted(_s: StrokeSession): void {}

  cursor(): string {
    const zoom = this.editor.view.zoom;
    return this.options().size * zoom >= 8 ? 'none' : 'crosshair';
  }

  onPointerDown(e: ToolPointerEvent): void {
    const editor = this.editor;
    if (e.alt && this.onAltPress(e)) return;
    const resolved = resolvePaintTarget(editor);
    if (typeof resolved === 'string') {
      editor.notify('info', resolved);
      return;
    }
    const doc = editor.doc!;
    const tx = editor.beginTransaction();
    if (!tx) return;
    let target = resolved;
    try {
      const grown = growTarget(editor, doc, target, { x: 0, y: 0, width: doc.width, height: doc.height });
      target = grown.target;
      if (grown.doc !== doc) tx.update(() => grown.doc);
    } catch (err) {
      tx.cancel();
      editor.notify('error', 'Cannot paint on this layer.', String(err));
      return;
    }
    const paint = this.prepare(target, e);
    if (typeof paint === 'string') {
      tx.cancel();
      editor.notify('info', paint);
      return;
    }
    const gpu = editor.gpu;
    const coverageFormat = editor.caps.halfFloatRenderable ? 'r16f' : 'r8';
    const coverage = gpu.pool.acquire(target.width, target.height, coverageFormat);
    gpu.clear(coverage);
    const preview = gpu.pool.acquire(target.width, target.height, target.format);
    gpu.blit(editor.surfaces.target(target.surfaceId), preview, { x: 0, y: 0, width: target.width, height: target.height });
    const opts = { ...this.options() };
    const zoom = editor.view.zoom;
    const engine = new StrokeEngine({
      spacing: (p) => Math.max(0.5, opts.spacing * this.diameter(opts, p)),
      smoothingRadius: (opts.smoothing * 48 * editor.view.dpr) / zoom,
    });
    this.session = {
      tx,
      target: { ...target, preserveAlpha: paint.preserveAlpha },
      engine,
      coverage,
      preview,
      dirty: null,
      selection: doc.selection ? selectionCoverage(editor, doc.selection) : null,
      paint,
      opts,
      firstDab: null,
      lastDab: null,
    };
    editor.compositor.providers.unshift(this.provider);
    const sample = { x: e.doc.x, y: e.doc.y, pressure: e.pressure };
    const last = this.lastStrokeEnd;
    if (e.shift && last && last.layerId === target.layerId) {
      // Shift-click: straight line from the end of the previous stroke.
      engine.begin(last.point);
      this.draw([...engine.add(sample), ...engine.end()]);
      engine.begin(sample);
    } else {
      this.draw(engine.begin(sample));
    }
  }

  protected diameter(opts: BrushOptions, pressure: number): number {
    return opts.pressureSize ? Math.max(1, opts.size * Math.max(0.05, pressure)) : opts.size;
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (!pressed || !this.session) return;
    const samples = e.coalesced.length > 0 ? e.coalesced : [{ doc: e.doc, pressure: e.pressure }];
    const dabs: Dab[] = [];
    for (const c of samples) dabs.push(...this.session.engine.add({ x: c.doc.x, y: c.doc.y, pressure: c.pressure }));
    this.draw(dabs);
  }

  /** Renders dabs into the coverage buffer and refreshes the preview where they landed. */
  private draw(dabs: Dab[]): void {
    const s = this.session;
    if (!s || dabs.length === 0) return;
    const { target, opts } = s;
    const gpuDabs: GpuDab[] = [];
    let rect: Rect | null = null;
    for (const d of dabs) {
      const radius = this.diameter(opts, d.pressure) / 2;
      const alpha = opts.flow * (opts.pressureOpacity ? d.pressure : 1);
      const x = d.x - target.x;
      const y = d.y - target.y;
      gpuDabs.push({ x, y, radius, alpha });
      const r = roundOutRect({ x: x - radius - 2, y: y - radius - 2, width: radius * 2 + 4, height: radius * 2 + 4 });
      rect = rect ? unionRects(rect, r) : r;
    }
    s.firstDab ??= dabs[0]!;
    s.lastDab = dabs[dabs.length - 1]!;
    this.dabs.render(s.coverage, gpuDabs, opts.hardness);
    const area = intersectRects(rect!, { x: 0, y: 0, width: target.width, height: target.height });
    if (isEmptyRect(area)) return;
    runPaintComposite(this.editor, {
      dst: s.preview,
      dstRect: area,
      old: { texture: this.editor.surfaces.texture(target.surfaceId), offset: { x: 0, y: 0 } },
      docOffset: { x: target.x, y: target.y },
      stroke: { texture: s.coverage.texture, offset: { x: 0, y: 0 } },
      selection: s.selection,
      op: s.paint.op,
      opacity: opts.opacity,
      color: s.paint.color,
      preserveAlpha: target.preserveAlpha,
      source: s.paint.source ?? null,
    });
    this.markDirty(s, area);
  }

  protected markDirty(s: StrokeSession, area: Rect): void {
    const { target } = s;
    s.dirty = s.dirty ? unionRects(s.dirty, area) : area;
    this.editor.compositor.invalidate({ x: area.x + target.x, y: area.y + target.y, width: area.width, height: area.height });
    this.editor.requestRender();
  }

  onPointerUp(): void {
    const s = this.session;
    if (!s) return;
    this.draw(s.engine.end());
    const changed = s.dirty ? this.finish(s) : null;
    if (changed) this.markDirty(s, changed);
    const { target, dirty, tx } = s;
    if (dirty) {
      const before = this.editor.surfaces.read(target.surfaceId, dirty);
      this.editor.gpu.blit(s.preview, this.editor.surfaces.target(target.surfaceId), dirty);
      this.editor.surfaces.markChanged(target.surfaceId, dirty);
      tx.addPatch({ surfaceId: target.surfaceId, rect: dirty, before, after: null });
    }
    if (s.lastDab) this.lastStrokeEnd = { layerId: target.layerId, point: s.lastDab };
    this.cleanup();
    tx.commit(this.label());
    this.strokeCommitted(s);
  }

  onCancel(): void {
    const s = this.session;
    if (!s) return;
    this.cleanup();
    s.tx.cancel();
  }

  private cleanup(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    const i = this.editor.compositor.providers.indexOf(this.provider);
    if (i >= 0) this.editor.compositor.providers.splice(i, 1);
    if (s.dirty) {
      this.editor.compositor.invalidate({ x: s.dirty.x + s.target.x, y: s.dirty.y + s.target.y, width: s.dirty.width, height: s.dirty.height });
    }
    s.paint.release?.();
    this.editor.gpu.pool.release(s.coverage);
    this.editor.gpu.pool.release(s.preview);
    this.editor.requestRender();
  }

  /** Shared keys: [ ] size (Shift: hardness), digits opacity (Shift: flow). */
  onKeyDown(e: ToolKeyEvent): boolean {
    if (e.mod || e.alt) return false;
    const opts = this.options();
    const set = (patch: Partial<BrushOptions>) => {
      this.setOptions(patch);
      this.editor.tools.refreshCursor();
      this.editor.requestOverlay();
    };
    if (e.key === '[' || e.key === '{') {
      if (e.shift) set({ hardness: Math.max(0, Math.round((opts.hardness - 0.25) * 100) / 100) });
      else set({ size: nextBrushSize(opts.size, -1) });
      return true;
    }
    if (e.key === ']' || e.key === '}') {
      if (e.shift) set({ hardness: Math.min(1, Math.round((opts.hardness + 0.25) * 100) / 100) });
      else set({ size: nextBrushSize(opts.size, 1) });
      return true;
    }
    // Number keys set opacity (Shift: flow): 1 = 10% … 0 = 100%.
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      const v = n === 0 ? 1 : n / 10;
      set(e.shift ? { flow: v } : { opacity: v });
      return true;
    }
    return false;
  }

  /** Brush outline at the pointer (hidden when it would be smaller than the cursor). */
  protected drawBrushOutline(ctx: CanvasRenderingContext2D, at: Point): void {
    const view = this.editor.view;
    const dpr = view.dpr;
    const r = (this.options().size / 2) * view.zoom;
    if (r * 2 < 8) return;
    ctx.save();
    for (const [color, w] of [
      ['rgba(0,0,0,0.7)', 3],
      ['rgba(255,255,255,0.95)', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w * dpr;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.editor.tools.pointer;
    if (p) this.drawBrushOutline(ctx, p.screen);
  }

  hasActiveGesture(): boolean {
    return this.session !== null;
  }
}
