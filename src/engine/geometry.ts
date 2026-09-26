/** Geometry primitives shared by the engine and UI. All rects are in pixels. */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_RECT: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function intersectRects(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Union of two rects; empty rects are ignored. */
export function unionRects(a: Rect, b: Rect): Rect {
  if (isEmptyRect(a)) return { ...b };
  if (isEmptyRect(b)) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function expandRect(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, width: r.width + amount * 2, height: r.height + amount * 2 };
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

/** Smallest integer rect that fully contains `r`. */
export function roundOutRect(r: Rect): Rect {
  const x0 = Math.floor(r.x);
  const y0 = Math.floor(r.y);
  const x1 = Math.ceil(r.x + r.width);
  const y1 = Math.ceil(r.y + r.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Normalised rect spanned by two corner points (in either order). */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Splits `r` into tiles no larger than `tileSize` on either side. Tiles are aligned to
 * a global grid (multiples of tileSize) so repeated partial updates reuse the same
 * tile boundaries.
 */
export function tileRect(r: Rect, tileSize: number): Rect[] {
  const tiles: Rect[] = [];
  if (isEmptyRect(r)) return tiles;
  const tx0 = Math.floor(r.x / tileSize);
  const ty0 = Math.floor(r.y / tileSize);
  const tx1 = Math.ceil((r.x + r.width) / tileSize);
  const ty1 = Math.ceil((r.y + r.height) / tileSize);
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const cell = { x: tx * tileSize, y: ty * tileSize, width: tileSize, height: tileSize };
      const part = intersectRects(cell, r);
      if (!isEmptyRect(part)) tiles.push(part);
    }
  }
  return tiles;
}

/**
 * 2D affine matrix [a c e; b d f; 0 0 1] (same layout as DOMMatrix / Canvas2D):
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function affine(a: number, b: number, c: number, d: number, e: number, f: number): Affine {
  return { a, b, c, d, e, f };
}

/** Returns m1 × m2 (apply m2 first, then m1). */
export function multiplyAffine(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function translation(tx: number, ty: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaling(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotation(radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function isIdentityAffine(m: Affine, eps = 1e-9): boolean {
  return (
    Math.abs(m.a - 1) < eps &&
    Math.abs(m.b) < eps &&
    Math.abs(m.c) < eps &&
    Math.abs(m.d - 1) < eps &&
    Math.abs(m.e) < eps &&
    Math.abs(m.f) < eps
  );
}

/** Axis-aligned bounds of a rect after applying an affine transform. */
export function transformedBounds(m: Affine, r: Rect): Rect {
  const pts = [
    applyAffine(m, { x: r.x, y: r.y }),
    applyAffine(m, { x: r.x + r.width, y: r.y }),
    applyAffine(m, { x: r.x, y: r.y + r.height }),
    applyAffine(m, { x: r.x + r.width, y: r.y + r.height }),
  ];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
