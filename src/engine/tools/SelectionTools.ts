import type { Editor, Transaction } from '../Editor';
import type { Selection } from '../doc/types';
import { findLayer } from '../doc/layerTree';
import { rectFromPoints, type Point, type Rect } from '../geometry';
import {
  applyShape,
  combineCoverage,
  featherSelection,
  offsetSelection,
  type SelectionMode,
  type SelectionShape,
} from '../selection/SelectionOps';
import { readPixelsAsync } from '../gl/readback';
import type { MagicWandRequest } from '../workers/magicWand.worker';
import { strokeContrast } from './overlay';
import type { Tool, ToolKeyEvent, ToolPointerEvent, ToolId } from './types';

/** Coverage (0..255) of a selection at a document point. */
export function selectionValueAt(editor: Editor, sel: Selection, p: Point): number {
  const s = editor.surfaces.get(sel.surfaceId);
  const x = Math.floor(p.x) - sel.x;
  const y = Math.floor(p.y) - sel.y;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return sel.defaultValue;
  return editor.surfaces.readSync(sel.surfaceId, { x, y, width: 1, height: 1 })[0] ?? 0;
}

/** Shift = add, Alt = subtract, both = intersect; otherwise the options-bar mode. */
export function modeFromModifiers(e: { shift: boolean; alt: boolean }, fallback: SelectionMode): SelectionMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return fallback;
}

const LABELS: Record<string, string> = {
  marqueeRect: 'Rectangular Marquee',
  marqueeEllipse: 'Elliptical Marquee',
  lasso: 'Lasso',
  polygonLasso: 'Polygonal Lasso',
  magicWand: 'Magic Wand',
};

/** Shared behaviour: boolean modes, feathering, moving outlines, nudging. */
abstract class SelectionTool implements Tool {
  abstract readonly id: ToolId;
  private moveDrag: { tx: Transaction; start: Point; dx: number; dy: number } | null = null;

  constructor(protected readonly editor: Editor) {}

  cursor(): string {
    return 'crosshair';
  }

  protected options() {
    return this.editor.store.get().toolOptions.selection;
  }

  /** Commits a new selection computed from the current one. */
  protected commit(fn: (current: Selection | null) => Selection | null): void {
    const feather = this.options().feather;
    try {
      this.editor.commit(LABELS[this.id] ?? 'Select', (d) => {
        let sel = fn(d.selection);
        if (sel && feather > 0 && sel !== d.selection) sel = featherSelection(this.editor, sel, feather);
        return sel === d.selection ? d : { ...d, selection: sel };
      });
    } catch (err) {
      this.editor.notify('error', 'The selection could not be created.', String(err));
    }
  }

  protected commitShape(shape: SelectionShape, mode: SelectionMode): void {
    this.commit((current) => applyShape(this.editor, current, shape, mode));
  }

  /** Starts dragging the selection outline if the press is inside it (replace mode). */
  protected tryStartMove(e: ToolPointerEvent): boolean {
    const doc = this.editor.doc;
    if (!doc?.selection || e.shift || e.alt || this.options().mode !== 'replace') return false;
    if (selectionValueAt(this.editor, doc.selection, e.doc) < 128) return false;
    const tx = this.editor.beginTransaction();
    if (!tx) return false;
    this.moveDrag = { tx, start: e.doc, dx: 0, dy: 0 };
    return true;
  }

  protected updateMove(e: ToolPointerEvent): boolean {
    const m = this.moveDrag;
    if (!m) return false;
    let dx = Math.round(e.doc.x - m.start.x);
    let dy = Math.round(e.doc.y - m.start.y);
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (dx !== m.dx || dy !== m.dy) {
      m.dx = dx;
      m.dy = dy;
      const base = m.tx.base;
      m.tx.update((d) => ({
        ...d,
        selection: base.selection ? offsetSelection(base.selection, dx, dy, { x: 0, y: 0, width: d.width, height: d.height }) : null,
      }));
    }
    return true;
  }

  protected endMove(): boolean {
    const m = this.moveDrag;
    if (!m) return false;
    this.moveDrag = null;
    if (m.dx || m.dy) m.tx.commit('Move Selection');
    else m.tx.cancel();
    return true;
  }

  onCancel(): void {
    this.moveDrag?.tx.cancel();
    this.moveDrag = null;
  }

  onKeyDown(e: ToolKeyEvent): boolean {
    const step = e.shift ? 10 : 1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = d[e.key];
    const doc = this.editor.doc;
    if (!delta || e.mod || e.alt || !doc?.selection) return false;
    this.editor.commit(
      'Nudge Selection',
      (x) => (x.selection ? { ...x, selection: offsetSelection(x.selection, delta[0], delta[1], { x: 0, y: 0, width: x.width, height: x.height }) } : x),
      'nudgeSelection',
    );
    return true;
  }

  hasActiveGesture(): boolean {
    return this.moveDrag !== null;
  }
}

/** Rectangular and elliptical marquees. Shift: square/circle, Alt: from centre (while dragging). */
export class MarqueeTool extends SelectionTool {
  private drag: { start: Point; current: Point; mode: SelectionMode; shift: boolean; alt: boolean } | null = null;

  constructor(
    editor: Editor,
    readonly id: 'marqueeRect' | 'marqueeEllipse',
  ) {
    super(editor);
  }

  private rect(): Rect | null {
    const d = this.drag;
    if (!d) return null;
    let w = d.current.x - d.start.x;
    let h = d.current.y - d.start.y;
    if (d.shift) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * s;
      h = Math.sign(h || 1) * s;
    }
    if (d.alt) return { x: d.start.x - Math.abs(w), y: d.start.y - Math.abs(h), width: Math.abs(w) * 2, height: Math.abs(h) * 2 };
    return rectFromPoints(d.start, { x: d.start.x + w, y: d.start.y + h });
  }

  onPointerDown(e: ToolPointerEvent): void {
    if (this.tryStartMove(e)) return;
    const snap = this.id === 'marqueeRect' ? { x: Math.round(e.doc.x), y: Math.round(e.doc.y) } : e.doc;
    this.drag = { start: snap, current: snap, mode: modeFromModifiers(e, this.options().mode), shift: false, alt: false };
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (!pressed) return;
    if (this.updateMove(e)) return;
    const d = this.drag;
    if (!d) return;
    d.current = this.id === 'marqueeRect' ? { x: Math.round(e.doc.x), y: Math.round(e.doc.y) } : e.doc;
    // Modifiers pressed after the drag started shape the marquee instead of choosing a mode.
    d.shift = e.shift && d.mode !== 'add' && d.mode !== 'intersect';
    d.alt = e.alt && d.mode !== 'subtract' && d.mode !== 'intersect';
    this.editor.requestOverlay();
  }

  onPointerUp(): void {
    if (this.endMove()) return;
    const r = this.rect();
    const mode = this.drag?.mode ?? 'replace';
    this.drag = null;
    this.editor.requestOverlay();
    if (!r || r.width < 1 || r.height < 1) {
      // A click without a drag deselects (replace mode).
      if (mode === 'replace' && this.editor.doc?.selection) this.commit(() => null);
      return;
    }
    this.commitShape({ kind: this.id === 'marqueeRect' ? 'rect' : 'ellipse', rect: r }, mode);
  }

  override onCancel(): void {
    super.onCancel();
    this.drag = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const r = this.rect();
    if (!r) return;
    const view = this.editor.view;
    const a = view.docToScreen({ x: r.x, y: r.y });
    const b = view.docToScreen({ x: r.x + r.width, y: r.y + r.height });
    strokeContrast(
      ctx,
      view.dpr,
      () => {
        if (this.id === 'marqueeRect') ctx.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
        else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      },
      true,
    );
  }

  override hasActiveGesture(): boolean {
    return this.drag !== null || super.hasActiveGesture();
  }
}

/** Freehand lasso: drag to draw; the path closes on release. */
export class LassoTool extends SelectionTool {
  readonly id = 'lasso' as const;
  private points: Point[] | null = null;
  private mode: SelectionMode = 'replace';

  onPointerDown(e: ToolPointerEvent): void {
    if (this.tryStartMove(e)) return;
    this.points = [e.doc];
    this.mode = modeFromModifiers(e, this.options().mode);
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (!pressed) return;
    if (this.updateMove(e)) return;
    const pts = this.points;
    if (!pts) return;
    const minStep = 1 / this.editor.view.zoom;
    const samples = e.coalesced.length ? e.coalesced.map((c) => c.doc) : [e.doc];
    for (const p of samples) {
      const last = pts[pts.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) pts.push(p);
    }
    this.editor.requestOverlay();
  }

  onPointerUp(): void {
    if (this.endMove()) return;
    const pts = this.points;
    this.points = null;
    this.editor.requestOverlay();
    if (!pts || pts.length < 3) {
      if (this.mode === 'replace' && this.editor.doc?.selection) this.commit(() => null);
      return;
    }
    this.commitShape({ kind: 'polygon', points: pts }, this.mode);
  }

  override onCancel(): void {
    super.onCancel();
    this.points = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const pts = this.points;
    if (!pts || pts.length < 2) return;
    const view = this.editor.view;
    strokeContrast(
      ctx,
      view.dpr,
      () => {
        pts.forEach((p, i) => {
          const s = view.docToScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
      },
      true,
    );
  }

  override hasActiveGesture(): boolean {
    return this.points !== null || super.hasActiveGesture();
  }
}

/**
 * Polygonal lasso: click to add corners; click the first point, double-click or press
 * Enter to close; Backspace removes the last corner; Esc cancels. Shift snaps to 45°.
 */
export class PolygonLassoTool extends SelectionTool {
  readonly id = 'polygonLasso' as const;
  private points: Point[] = [];
  private hover: Point | null = null;
  private mode: SelectionMode = 'replace';
  private lastClick = { time: 0, x: 0, y: 0 };

  private snap(p: Point, shift: boolean): Point {
    const last = this.points[this.points.length - 1];
    if (!shift || !last) return p;
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: last.x + Math.cos(angle) * len, y: last.y + Math.sin(angle) * len };
  }

  onPointerDown(e: ToolPointerEvent): void {
    if (this.points.length === 0) {
      if (this.tryStartMove(e)) return;
      this.mode = modeFromModifiers(e, this.options().mode);
      this.points = [e.doc];
      this.lastClick = { time: e.timeStamp, x: e.screen.x, y: e.screen.y };
      this.editor.requestOverlay();
      return;
    }
    const p = this.snap(e.doc, e.shift);
    const first = this.editor.view.docToScreen(this.points[0]!);
    const closeToStart = Math.hypot(e.screen.x - first.x, e.screen.y - first.y) < 8 * this.editor.view.dpr;
    // A double-click is two quick presses at (almost) the same spot.
    const doubleClick =
      e.timeStamp - this.lastClick.time < 400 &&
      Math.hypot(e.screen.x - this.lastClick.x, e.screen.y - this.lastClick.y) < 5 * this.editor.view.dpr;
    this.lastClick = { time: e.timeStamp, x: e.screen.x, y: e.screen.y };
    if (closeToStart || doubleClick) {
      this.finish();
      return;
    }
    this.points.push(p);
    this.editor.requestOverlay();
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (pressed && this.updateMove(e)) return;
    if (this.points.length > 0) {
      this.hover = this.snap(e.doc, e.shift);
      this.editor.requestOverlay();
    }
  }

  onPointerUp(): void {
    this.endMove();
  }

  private finish(): void {
    const pts = this.points;
    this.points = [];
    this.hover = null;
    this.editor.requestOverlay();
    if (pts.length >= 3) this.commitShape({ kind: 'polygon', points: pts }, this.mode);
  }

  capturesKey(e: ToolKeyEvent): boolean {
    return this.points.length > 0 && ['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key);
  }

  override onKeyDown(e: ToolKeyEvent): boolean {
    if (this.points.length > 0) {
      if (e.key === 'Enter') {
        this.finish();
        return true;
      }
      if (e.key === 'Escape') {
        this.points = [];
        this.hover = null;
        this.editor.requestOverlay();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.points.pop();
        this.editor.requestOverlay();
        return true;
      }
    }
    return super.onKeyDown(e);
  }

  deactivate(): void {
    this.points = [];
    this.hover = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.points.length === 0) return;
    const view = this.editor.view;
    const pts = this.hover ? [...this.points, this.hover] : this.points;
    strokeContrast(
      ctx,
      view.dpr,
      () => {
        pts.forEach((p, i) => {
          const s = view.docToScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
      },
      true,
    );
  }

  override hasActiveGesture(): boolean {
    return this.points.length > 0 || super.hasActiveGesture();
  }
}

/** Magic wand: selects similar colours; the region grows in a worker. */
export class MagicWandTool extends SelectionTool {
  readonly id = 'magicWand' as const;
  private worker: Worker | null = null;
  private busy = false;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/magicWand.worker.ts', import.meta.url), { type: 'module' });
    }
    return this.worker;
  }

  onPointerDown(e: ToolPointerEvent): void {
    if (this.busy) return;
    void this.select(e.doc, modeFromModifiers(e, this.options().mode));
  }

  private async select(p: Point, mode: SelectionMode): Promise<void> {
    const editor = this.editor;
    const doc = editor.doc;
    if (!doc) return;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const wand = editor.store.get().toolOptions.magicWand;
    this.busy = true;
    editor.store.set({ busy: 'Selecting similar colours…' });
    try {
      const gl = editor.gpu.gl;
      const rect = { x: 0, y: 0, width: doc.width, height: doc.height };
      let data: Uint8Array;
      const layer = findLayer(doc.layers, doc.activeLayerId);
      let origin = { x: 0, y: 0 };
      let size = { width: doc.width, height: doc.height };
      if (!wand.sampleAll && layer?.type === 'pixel') {
        const s = editor.surfaces.get(layer.surfaceId);
        origin = { x: layer.x, y: layer.y };
        size = { width: s.width, height: s.height };
        data = await editor.surfaces.read(layer.surfaceId);
      } else {
        editor.flush();
        const target = editor.compositor.compositeTarget!;
        data = await readPixelsAsync(gl, target.framebuffer, rect, { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 });
      }
      const request: MagicWandRequest = {
        data,
        width: size.width,
        height: size.height,
        x: x - origin.x,
        y: y - origin.y,
        tolerance: wand.tolerance,
        contiguous: wand.contiguous,
      };
      const worker = this.getWorker();
      const result = await new Promise<{ mask: Uint8Array; bounds: Rect | null }>((resolve, reject) => {
        worker.onmessage = (ev) => resolve(ev.data as { mask: Uint8Array; bounds: Rect | null });
        worker.onerror = (ev) => reject(new Error(ev.message));
        worker.postMessage(request, [data.buffer]);
      });
      if (editor.doc !== doc) return;
      if (!result.bounds) {
        if (mode === 'replace') this.commit(() => null);
        return;
      }
      // Upload only the bounding box of the region.
      const b = result.bounds;
      const cropped = new Uint8Array(b.width * b.height);
      for (let row = 0; row < b.height; row++) {
        const src = (b.y + row) * size.width + b.x;
        cropped.set(result.mask.subarray(src, src + b.width), row * b.width);
      }
      const surface = editor.surfaces.createFromPixels(b.width, b.height, 'r8', cropped);
      try {
        this.commit((current) =>
          combineCoverage(
            editor,
            current,
            {
              texture: editor.surfaces.texture(surface.id),
              x: origin.x + b.x,
              y: origin.y + b.y,
              width: b.width,
              height: b.height,
              defaultValue: 0,
              channel: 'r',
            },
            mode,
          ),
        );
      } finally {
        editor.surfaces.delete(surface.id);
      }
    } catch (err) {
      editor.notify('error', 'Magic Wand failed.', String(err));
    } finally {
      this.busy = false;
      editor.store.set({ busy: null });
    }
  }
}
