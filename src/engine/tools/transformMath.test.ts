import { describe, expect, it } from 'vitest';
import { applyAffine } from '../geometry';
import { scaleFromHandle, transformMatrix, type TransformParams } from './TransformTool';
import { cropRatioValue, cropResize } from './CropTool';
import { isPixelExact } from '../render/Resampler';
import { dropDestination } from '../../ui/panels/layerDrop';
import { createDocState, createGroupLayer, createPixelLayer } from '../doc/factory';

const bounds = { x: 100, y: 50, width: 200, height: 100 };
const pivot = { x: 200, y: 100 };
const identity: TransformParams = { cx: 200, cy: 100, sx: 1, sy: 1, angle: 0 };

describe('free transform math', () => {
  it('identity parameters map the box onto itself', () => {
    const m = transformMatrix(identity, pivot);
    expect(applyAffine(m, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it('dragging the BR corner keeps TL fixed and scales proportionally by default', () => {
    const p = scaleFromHandle(identity, bounds, 4, { x: 500, y: 150 }, { fromCenter: false, toggleProportional: false });
    const m = transformMatrix(p, pivot);
    const tl = applyAffine(m, { x: 100, y: 50 });
    expect(tl.x).toBeCloseTo(100);
    expect(tl.y).toBeCloseTo(50);
    expect(p.sx).toBeCloseTo(p.sy);
    expect(p.sx).toBeGreaterThan(1);
  });

  it('Shift on a corner scales freely', () => {
    const p = scaleFromHandle(identity, bounds, 4, { x: 500, y: 150 }, { fromCenter: false, toggleProportional: true });
    expect(p.sx).toBeCloseTo(2);
    expect(p.sy).toBeCloseTo(1);
  });

  it('Alt scales about the centre', () => {
    const p = scaleFromHandle(identity, bounds, 3, { x: 400, y: 100 }, { fromCenter: true, toggleProportional: false });
    expect(p.sx).toBeCloseTo(2);
    expect(p.cx).toBeCloseTo(200);
  });

  it('edge handles respect rotation', () => {
    const rotated: TransformParams = { ...identity, angle: Math.PI / 2 };
    // After 90° the right edge points down; dragging it further down stretches x.
    const m0 = transformMatrix(rotated, pivot);
    const rightMid = applyAffine(m0, { x: 300, y: 100 });
    const p = scaleFromHandle(rotated, bounds, 3, { x: rightMid.x, y: rightMid.y + 100 }, { fromCenter: false, toggleProportional: false });
    expect(p.sx).toBeCloseTo(1.5);
    expect(p.sy).toBeCloseTo(1);
  });

  it('recognises lossless transforms', () => {
    expect(isPixelExact({ a: 0, b: 1, c: -1, d: 0, e: 20, f: 0 })).toBe(true);
    expect(isPixelExact({ a: -1, b: 0, c: 0, d: 1, e: 40, f: 0 })).toBe(true);
    expect(isPixelExact({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })).toBe(false);
    expect(isPixelExact({ a: 1, b: 0, c: 0, d: 1, e: 0.5, f: 0 })).toBe(false);
  });
});

describe('crop math', () => {
  it('maps ratio presets', () => {
    expect(cropRatioValue('free', 400, 300)).toBeNull();
    expect(cropRatioValue('original', 400, 300)).toBeCloseTo(4 / 3);
    expect(cropRatioValue('16:9', 1, 1)).toBeCloseTo(16 / 9);
  });

  it('resizes from corners with a fixed ratio keeping the opposite corner', () => {
    const r = cropResize({ x: 0, y: 0, width: 100, height: 100 }, 1, 1, { x: 200, y: 120 }, 1);
    expect(r).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it('normalises when dragged past the opposite edge', () => {
    const r = cropResize({ x: 50, y: 50, width: 100, height: 100 }, 0, 0.5, { x: 200, y: 0 }, null);
    expect(r).toEqual({ x: 150, y: 50, width: 50, height: 100 });
  });
});

describe('layer drop destinations', () => {
  const a = createPixelLayer({ name: 'A', surfaceId: 'a' });
  const b = createPixelLayer({ name: 'B', surfaceId: 'b' });
  const g = createGroupLayer({ name: 'G', children: [b] });
  const doc = createDocState({ name: 'd', width: 10, height: 10, layers: [a, g] });

  it('drops above/below siblings and into groups', () => {
    expect(dropDestination(doc, { id: a.id, zone: 'above' })).toEqual({ parentId: null, index: 1 });
    expect(dropDestination(doc, { id: a.id, zone: 'below' })).toEqual({ parentId: null, index: 0 });
    expect(dropDestination(doc, { id: g.id, zone: 'into' })).toEqual({ parentId: g.id, index: 1 });
    // Below an expanded group's row means "top of that group".
    expect(dropDestination(doc, { id: g.id, zone: 'below' })).toEqual({ parentId: g.id, index: 1 });
    expect(dropDestination(doc, { id: b.id, zone: 'below' })).toEqual({ parentId: g.id, index: 0 });
  });
});
