import { Emitter } from '../store';
import type { Point } from '../geometry';
import {
  centerView,
  clampPan,
  fitView,
  nextZoomStep,
  prevZoomStep,
  screenToDoc,
  docToScreen,
  snapPan,
  zoomAt,
  type ViewTransform,
} from './viewMath';

const FIT_PADDING_CSS = 24;

/**
 * Owns the viewport transform and canvas size. Emits `change` on every update; the
 * render loop and rulers listen directly so panning never re-renders React.
 */
export class ViewController {
  /** Displayed transform (pan snapped to device pixels at integer zoom). */
  transform: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  /**
   * Unsnapped transform. Incremental operations (drag-pan, wheel) accumulate here so
   * rounding for display never drifts.
   */
  private exact: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  /** Canvas size in device pixels. */
  width = 1;
  height = 1;
  dpr = 1;
  private docWidth = 0;
  private docHeight = 0;
  readonly events = new Emitter<{ change: ViewTransform; resize: { width: number; height: number } }>();

  setDocumentSize(width: number, height: number): void {
    this.docWidth = width;
    this.docHeight = height;
  }

  setViewportSize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    // Keep the view centre stable while resizing.
    const dx = (w - this.width) / 2;
    const dy = (h - this.height) / 2;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.events.emit('resize', { width: w, height: h });
    this.apply({ ...this.exact, panX: this.exact.panX + dx, panY: this.exact.panY + dy });
  }

  get zoom(): number {
    return this.transform.zoom;
  }

  private apply(t: ViewTransform): void {
    this.exact = this.docWidth > 0 ? clampPan(t, this.docWidth, this.docHeight, this.width, this.height) : t;
    const next = snapPan(this.exact);
    const prev = this.transform;
    if (next.zoom === prev.zoom && next.panX === prev.panX && next.panY === prev.panY) return;
    this.transform = next;
    this.events.emit('change', next);
  }

  set(t: ViewTransform): void {
    this.apply(t);
  }

  get center(): Point {
    return { x: this.width / 2, y: this.height / 2 };
  }

  zoomTo(zoom: number, anchor: Point = this.center): void {
    this.apply(zoomAt(this.exact, zoom, anchor));
  }

  zoomIn(anchor?: Point): void {
    this.zoomTo(nextZoomStep(this.transform.zoom), anchor);
  }

  zoomOut(anchor?: Point): void {
    this.zoomTo(prevZoomStep(this.transform.zoom), anchor);
  }

  panBy(dx: number, dy: number): void {
    this.apply({ ...this.exact, panX: this.exact.panX + dx, panY: this.exact.panY + dy });
  }

  /** Fits the whole document into the viewport. */
  fit(): void {
    if (this.docWidth <= 0) return;
    const padding = FIT_PADDING_CSS * this.dpr;
    this.apply(fitView(this.docWidth, this.docHeight, this.width, this.height, padding));
  }

  /** Zooms so the document covers the whole viewport. */
  fill(): void {
    if (this.docWidth <= 0) return;
    const zoom = Math.max(this.width / this.docWidth, this.height / this.docHeight);
    this.apply(centerView(this.docWidth, this.docHeight, this.width, this.height, zoom));
  }

  /** Fit, but never magnify beyond 100% (used when opening documents). */
  fitNoUpscale(): void {
    if (this.docWidth <= 0) return;
    const padding = FIT_PADDING_CSS * this.dpr;
    this.apply(fitView(this.docWidth, this.docHeight, this.width, this.height, padding, 1));
  }

  /** 100%: one document pixel per device pixel, centred on the viewport centre. */
  actualPixels(): void {
    const c = screenToDoc(this.exact, this.center);
    const t = { zoom: 1, panX: Math.round(this.width / 2 - c.x), panY: Math.round(this.height / 2 - c.y) };
    this.apply(t);
  }

  /** 100% of CSS pixels (document pixel = one CSS pixel), useful on HiDPI screens. */
  printSize(): void {
    this.zoomTo(1 / this.dpr);
  }

  centerDocument(): void {
    this.apply(centerView(this.docWidth, this.docHeight, this.width, this.height, this.transform.zoom));
  }

  screenToDoc(p: Point): Point {
    return screenToDoc(this.transform, p);
  }

  docToScreen(p: Point): Point {
    return docToScreen(this.transform, p);
  }
}
