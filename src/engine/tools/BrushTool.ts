import type { Editor, Transaction } from '../Editor';
import type { Layer, RGB } from '../doc/types';
import { intersectRects, isEmptyRect, roundOutRect, unionRects, type Rect } from '../geometry';
import type { RenderTarget } from '../gl/renderTarget';
import type { LayerSourceProvider } from '../render/Compositor';
import { DabRenderer, type GpuDab } from '../paint/DabRenderer';
import { growTarget, resolvePaintTarget, type PaintTarget } from '../paint/PaintTarget';
import { maskGrey, runPaintComposite, type PaintOp } from '../paint/PixelOps';
import { StrokeEngine, type Dab } from '../paint/StrokeEngine';
import { selectionCoverage, type Coverage } from '../selection/SelectionOps';
import type { BrushOptions } from './options';
import { sampleColor } from './sampleColor';
import type { Tool, ToolKeyEvent, ToolPointerEvent } from './types';

interface StrokeSession {
  tx: Transaction;
  target: PaintTarget;
  engine: StrokeEngine;
  /** Coverage accumulated by dabs (target-sized). */
  coverage: RenderTarget;
  /** Target pixels with the stroke applied, shown live instead of the real surface. */
  preview: RenderTarget;
  dirty: Rect | null;
  selection: Coverage | null;
  op: PaintOp;
  color: RGB;
  opts: BrushOptions;
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
 * Brush and Eraser. Dabs accumulate in a coverage buffer (flow build-up); the stroke is
 * composited over the target at `opacity` into a preview surface that the compositor
 * shows instead of the layer, and merged into the layer on release as one undo step.
 */
export class BrushTool implements Tool {
  private session: StrokeSession | null = null;
  private readonly dabs: DabRenderer;
  private readonly provider: LayerSourceProvider;
  /** End of the previous stroke, for Shift-click straight lines. */
  private lastStrokeEnd: { layerId: string; point: Dab } | null = null;

  constructor(
    private readonly editor: Editor,
    readonly id: 'brush' | 'eraser',
  ) {
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

  private options(): BrushOptions {
    return this.editor.store.get().toolOptions[this.id];
  }

  cursor(): string {
    const zoom = this.editor.view.zoom;
    return this.options().size * zoom >= 8 ? 'none' : 'crosshair';
  }

  private paintColor(target: PaintTarget): { op: PaintOp; color: RGB; preserveAlpha: boolean } {
    const { foreground, background } = this.editor.store.get();
    if (target.part === 'mask') {
      // Masks: brush paints the foreground grey, eraser the background grey.
      return { op: 'mask', color: maskGrey(this.id === 'brush' ? foreground : background), preserveAlpha: false };
    }
    if (this.id === 'eraser') {
      // With locked transparency the eraser paints the background colour instead.
      return target.preserveAlpha
        ? { op: 'paint', color: background, preserveAlpha: true }
        : { op: 'erase', color: background, preserveAlpha: false };
    }
    return { op: 'paint', color: foreground, preserveAlpha: target.preserveAlpha };
  }

  onPointerDown(e: ToolPointerEvent): void {
    const editor = this.editor;
    if (e.alt && this.id === 'brush') {
      this.pick(e);
      return;
    }
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
    const gpu = editor.gpu;
    const coverageFormat = editor.caps.halfFloatRenderable ? 'r16f' : 'r8';
    const coverage = gpu.pool.acquire(target.width, target.height, coverageFormat);
    gpu.clear(coverage);
    const preview = gpu.pool.acquire(target.width, target.height, target.format);
    gpu.blit(editor.surfaces.target(target.surfaceId), preview, { x: 0, y: 0, width: target.width, height: target.height });
    const opts = { ...this.options() };
    const { op, color, preserveAlpha } = this.paintColor(target);
    const zoom = editor.view.zoom;
    const engine = new StrokeEngine({
      spacing: (p) => Math.max(0.5, opts.spacing * this.diameter(opts, p)),
      smoothingRadius: (opts.smoothing * 48 * editor.view.dpr) / zoom,
    });
    this.session = {
      tx,
      target: { ...target, preserveAlpha },
      engine,
      coverage,
      preview,
      dirty: null,
      selection: doc.selection ? selectionCoverage(editor, doc.selection) : null,
      op,
      color,
      opts,
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

  private diameter(opts: BrushOptions, pressure: number): number {
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
      op: s.op,
      opacity: opts.opacity,
      color: s.color,
      preserveAlpha: target.preserveAlpha,
    });
    s.dirty = s.dirty ? unionRects(s.dirty, area) : area;
    this.editor.compositor.invalidate({ x: area.x + target.x, y: area.y + target.y, width: area.width, height: area.height });
    this.editor.requestRender();
  }

  onPointerUp(): void {
    const s = this.session;
    if (!s) return;
    this.draw(s.engine.end());
    const { target, dirty, tx } = s;
    if (dirty) {
      const before = this.editor.surfaces.read(target.surfaceId, dirty);
      this.editor.gpu.blit(s.preview, this.editor.surfaces.target(target.surfaceId), dirty);
      this.editor.surfaces.markChanged(target.surfaceId, dirty);
      tx.addPatch({ surfaceId: target.surfaceId, rect: dirty, before, after: null });
    }
    if (s.lastDab) this.lastStrokeEnd = { layerId: target.layerId, point: s.lastDab };
    this.cleanup();
    tx.commit(this.id === 'brush' ? 'Brush Tool' : 'Eraser');
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
    this.editor.gpu.pool.release(s.coverage);
    this.editor.gpu.pool.release(s.preview);
    this.editor.requestRender();
  }

  /** Alt-click with the brush samples a colour, like the Eyedropper. */
  private pick(e: ToolPointerEvent): void {
    const opts = this.editor.store.get().toolOptions.eyedropper;
    const c = sampleColor(this.editor, e.doc, opts.sampleSize, opts.sample);
    if (c) this.editor.setColors({ foreground: c });
  }

  onKeyDown(e: ToolKeyEvent): boolean {
    if (e.mod || e.alt) return false;
    const opts = this.options();
    const set = (patch: Partial<BrushOptions>) => {
      this.editor.setToolOptions(this.id, patch);
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

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.editor.tools.pointer;
    if (!p) return;
    const view = this.editor.view;
    const dpr = view.dpr;
    const r = (this.options().size / 2) * view.zoom;
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    if (r * 2 >= 8) {
      for (const [color, w] of [
        ['rgba(0,0,0,0.7)', 3],
        ['rgba(255,255,255,0.95)', 1],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w * dpr;
        ctx.beginPath();
        ctx.arc(p.screen.x, p.screen.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  hasActiveGesture(): boolean {
    return this.session !== null;
  }
}

/** Eyedropper: click or drag to pick the foreground colour (Alt: background). */
export class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return 'crosshair';
  }

  private pick(e: ToolPointerEvent): void {
    const opts = this.editor.store.get().toolOptions.eyedropper;
    const c = sampleColor(this.editor, e.doc, opts.sampleSize, opts.sample);
    if (!c) return;
    this.editor.setColors(e.alt ? { background: c } : { foreground: c });
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.pick(e);
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (pressed) this.pick(e);
  }
}

