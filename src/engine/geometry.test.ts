import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  intersectRects,
  invertAffine,
  multiplyAffine,
  rotation,
  roundOutRect,
  scaling,
  tileRect,
  transformedBounds,
  translation,
  unionRects,
} from './geometry';

describe('rects', () => {
  it('intersects and unions', () => {
    expect(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(intersectRects({ x: 0, y: 0, width: 4, height: 4 }, { x: 5, y: 5, width: 2, height: 2 }).width).toBe(0);
    expect(unionRects({ x: 0, y: 0, width: 0, height: 0 }, { x: 2, y: 3, width: 4, height: 5 })).toEqual({
      x: 2,
      y: 3,
      width: 4,
      height: 5,
    });
    expect(unionRects({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 1, width: 1, height: 4 })).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 5,
    });
  });

  it('rounds out fractional rects', () => {
    expect(roundOutRect({ x: 0.5, y: -0.2, width: 2, height: 1.1 })).toEqual({ x: 0, y: -1, width: 3, height: 2 });
  });

  it('tiles on a global grid covering the rect exactly', () => {
    const r = { x: 100, y: 50, width: 2100, height: 1000 };
    const tiles = tileRect(r, 1024);
    const area = tiles.reduce((s, t) => s + t.width * t.height, 0);
    expect(area).toBe(r.width * r.height);
    for (const t of tiles) {
      expect(t.width).toBeLessThanOrEqual(1024);
      expect(Math.floor(t.x / 1024)).toBe(Math.floor((t.x + t.width - 1) / 1024));
    }
  });
});

describe('affine', () => {
  it('composes and inverts', () => {
    const m = multiplyAffine(translation(10, 5), multiplyAffine(rotation(Math.PI / 3), scaling(2, 3)));
    const inv = invertAffine(m)!;
    const p = { x: 7, y: -4 };
    const q = applyAffine(inv, applyAffine(m, p));
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });

  it('returns null for singular matrices', () => {
    expect(invertAffine(scaling(0, 1))).toBeNull();
  });

  it('computes transformed bounds', () => {
    const b = transformedBounds(rotation(Math.PI / 2), { x: 0, y: 0, width: 4, height: 2 });
    expect(b.x).toBeCloseTo(-2);
    expect(b.y).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(2);
    expect(b.height).toBeCloseTo(4);
  });
});
