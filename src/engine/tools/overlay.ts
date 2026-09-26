import type { Point } from '../geometry';

/** Handle half-size in CSS pixels. */
export const HANDLE_RADIUS = 4;

/** Two-tone hairline path so outlines stay visible on any image content. */
export function strokeContrast(ctx: CanvasRenderingContext2D, dpr: number, path: () => void, dashed = false): void {
  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  if (dashed) ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
}

/** Crisp polygon outline through device-pixel points. */
export function strokePolygon(ctx: CanvasRenderingContext2D, dpr: number, pts: readonly Point[], dashed = false): void {
  strokeContrast(
    ctx,
    dpr,
    () => {
      pts.forEach((p, i) => {
        const x = Math.round(p.x) + 0.5;
        const y = Math.round(p.y) + 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    },
    dashed,
  );
}

export function drawHandle(ctx: CanvasRenderingContext2D, p: Point, dpr: number): void {
  const r = Math.round(HANDLE_RADIUS * dpr);
  const x = Math.round(p.x) - r + 0.5;
  const y = Math.round(p.y) - r + 0.5;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.fillRect(x, y, r * 2, r * 2);
  ctx.strokeRect(x, y, r * 2, r * 2);
  ctx.restore();
}

export function drawPivot(ctx: CanvasRenderingContext2D, p: Point, dpr: number): void {
  const r = 4 * dpr;
  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  for (const [color, width] of [
    ['rgba(0,0,0,0.8)', 3],
    ['#ffffff', 1],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.moveTo(p.x - r * 1.8, p.y);
    ctx.lineTo(p.x + r * 1.8, p.y);
    ctx.moveTo(p.x, p.y - r * 1.8);
    ctx.lineTo(p.x, p.y + r * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Index of the handle within `radius` device px of `p`, or -1. */
export function hitHandle(handles: readonly Point[], p: Point, radius: number): number {
  let best = -1;
  let bestD = radius;
  handles.forEach((h, i) => {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Point-in-convex/concave polygon test (even-odd). */
export function pointInPolygon(pts: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

/** Resize cursor for a handle direction (radians, screen space, y down). */
export function resizeCursor(angle: number): string {
  const octant = Math.round((((angle % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4;
  return RESIZE_CURSORS[octant]!;
}

/** Curved double-arrow cursor for rotation. */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 14a8 8 0 0 1 14 0" stroke="#000" stroke-width="4"/><path d="M3 11l2 3 3-2M21 11l-2 3-3-2" stroke="#000" stroke-width="4"/><path d="M5 14a8 8 0 0 1 14 0" stroke="#fff" stroke-width="1.6"/><path d="M3 11l2 3 3-2M21 11l-2 3-3-2" stroke="#fff" stroke-width="1.6"/></g></svg>',
)}") 12 12, crosshair`;
