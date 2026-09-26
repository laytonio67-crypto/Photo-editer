import { clamp, type Point, type Rect } from '../geometry';

/**
 * View transform: screen = doc · zoom + pan, where screen is in *device* pixels
 * relative to the canvas' top-left. zoom = 1 means one document pixel per device
 * pixel ("100%"), which is what makes pixel-accurate inspection possible on HiDPI.
 */
export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

/** Discrete zoom steps used by zoom in/out (Photoshop-like). */
export const ZOOM_STEPS = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6,
  7, 8, 12, 16, 20, 24, 32, 48, 64,
];

export function docToScreen(v: ViewTransform, p: Point): Point {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

export function screenToDoc(v: ViewTransform, p: Point): Point {
  return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
}

/** Zooms to `zoom` keeping the document point under `anchor` (screen px) fixed. */
export function zoomAt(v: ViewTransform, zoom: number, anchor: Point): ViewTransform {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const k = z / v.zoom;
  return snapPan({
    zoom: z,
    panX: anchor.x - (anchor.x - v.panX) * k,
    panY: anchor.y - (anchor.y - v.panY) * k,
  });
}

export function nextZoomStep(zoom: number): number {
  for (const step of ZOOM_STEPS) if (step > zoom * 1.0001) return step;
  return MAX_ZOOM;
}

export function prevZoomStep(zoom: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i]!;
    if (step < zoom / 1.0001) return step;
  }
  return MIN_ZOOM;
}

/**
 * At zoom ≥ 1 with integral zoom, integer pan keeps document pixels aligned to device
 * pixels, so nearest-neighbour display is exact. Pan is rounded whenever zoom is an
 * integer; fractional zooms keep sub-pixel pan for smooth zooming.
 */
export function snapPan(v: ViewTransform): ViewTransform {
  if (Number.isInteger(v.zoom) || Math.abs(v.zoom - Math.round(v.zoom)) < 1e-9) {
    return { zoom: Math.round(v.zoom), panX: Math.round(v.panX), panY: Math.round(v.panY) };
  }
  return v;
}

/** Zoom and pan that fit a document into a viewport with padding, centred. */
export function fitView(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  padding: number,
  maxZoom = Infinity,
): ViewTransform {
  const availW = Math.max(1, viewWidth - padding * 2);
  const availH = Math.max(1, viewHeight - padding * 2);
  const zoom = clamp(Math.min(availW / docWidth, availH / docHeight, maxZoom), MIN_ZOOM, MAX_ZOOM);
  return centerView(docWidth, docHeight, viewWidth, viewHeight, zoom);
}

export function centerView(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  zoom: number,
): ViewTransform {
  return snapPan({
    zoom,
    panX: (viewWidth - docWidth * zoom) / 2,
    panY: (viewHeight - docHeight * zoom) / 2,
  });
}

/**
 * Keeps at least `margin` screen pixels of the document visible so it can never be
 * scrolled completely out of view.
 */
export function clampPan(
  v: ViewTransform,
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  margin = 64,
): ViewTransform {
  const w = docWidth * v.zoom;
  const h = docHeight * v.zoom;
  const mx = Math.min(margin, w);
  const my = Math.min(margin, h);
  const panX = clamp(v.panX, mx - w, viewWidth - mx);
  const panY = clamp(v.panY, my - h, viewHeight - my);
  if (panX === v.panX && panY === v.panY) return v;
  return { zoom: v.zoom, panX, panY };
}

/** Document rect currently visible in the viewport (unclamped). */
export function visibleDocRect(v: ViewTransform, viewWidth: number, viewHeight: number): Rect {
  const tl = screenToDoc(v, { x: 0, y: 0 });
  const br = screenToDoc(v, { x: viewWidth, y: viewHeight });
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Human-readable zoom percentage, e.g. "33.3%", "100%", "1600%". */
export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  if (pct >= 100 || Number.isInteger(pct)) return `${Math.round(pct)}%`;
  if (pct >= 10) return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
  return `${pct.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}%`;
}
