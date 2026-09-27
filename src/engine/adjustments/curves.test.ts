import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CURVE,
  IDENTITY_LEVELS,
  autoLevels,
  composeLut,
  curveFunction,
  curvesLut,
  isIdentityCurve,
  levelsFunction,
  levelsLut,
  normalizeCurve,
} from './curves';

describe('curves', () => {
  it('interpolates through every control point', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 64, y: 40 },
      { x: 128, y: 150 },
      { x: 255, y: 240 },
    ];
    const f = curveFunction(pts);
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 6);
  });

  it('is the identity for the default curve', () => {
    const f = curveFunction(IDENTITY_CURVE);
    for (let x = 0; x <= 255; x += 17) expect(f(x)).toBeCloseTo(x, 6);
    expect(isIdentityCurve(IDENTITY_CURVE)).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 128, y: 140 }, { x: 255, y: 255 }])).toBe(false);
  });

  it('never overshoots between monotone points', () => {
    // A classic S-curve with a steep middle: a natural spline would overshoot.
    const f = curveFunction([
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 120, y: 240 },
      { x: 255, y: 255 },
    ]);
    let prev = -1;
    for (let x = 0; x <= 255; x++) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(255);
      prev = y;
    }
  });

  it('is flat outside the end points (like pro editors)', () => {
    const f = curveFunction([
      { x: 30, y: 20 },
      { x: 220, y: 230 },
    ]);
    expect(f(0)).toBe(20);
    expect(f(255)).toBe(230);
  });

  it('supports inverted and non-monotone curves', () => {
    const inverted = curveFunction([
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ]);
    expect(inverted(0)).toBe(255);
    expect(inverted(255)).toBe(0);
    expect(inverted(128)).toBeCloseTo(127, 0);
  });

  it('normalises unsorted and duplicate points', () => {
    expect(
      normalizeCurve([
        { x: 200, y: 10 },
        { x: 20, y: 30 },
        { x: 200, y: 50 },
        { x: 300, y: -4 },
      ]),
    ).toEqual([
      { x: 20, y: 30 },
      { x: 200, y: 50 },
      { x: 255, y: 0 },
    ]);
  });
});

describe('levels', () => {
  it('maps input black/white and output range', () => {
    const f = levelsFunction({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 10, outWhite: 250 });
    expect(f(50 / 255) * 255).toBeCloseTo(10, 6);
    expect(f(200 / 255) * 255).toBeCloseTo(250, 6);
    expect(f(0)).toBeCloseTo(10 / 255, 6);
    expect(f(1)).toBeCloseTo(250 / 255, 6);
    expect(f(125 / 255) * 255).toBeCloseTo(130, 6);
  });

  it('gamma > 1 brightens midtones', () => {
    const f = levelsFunction({ ...IDENTITY_LEVELS, gamma: 2 });
    expect(f(0.25)).toBeCloseTo(0.5, 6);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
  });

  it('builds identity LUTs from defaults', () => {
    const lut = levelsLut({ kind: 'levels', rgb: IDENTITY_LEVELS, r: IDENTITY_LEVELS, g: IDENTITY_LEVELS, b: IDENTITY_LEVELS });
    for (let i = 0; i < 256; i++) expect(lut[i * 4]).toBeCloseTo(i / 255, 6);
  });
});

describe('LUT composition', () => {
  it('applies channel curves before the master curve', () => {
    const lut = composeLut(
      (v) => v * 0.5,
      (v) => Math.min(1, v + 0.2),
      (v) => v,
      () => 1,
    );
    expect(lut[100 * 4]).toBeCloseTo((100 / 255 + 0.2) * 0.5, 6);
    expect(lut[100 * 4 + 1]).toBeCloseTo((100 / 255) * 0.5, 6);
    expect(lut[100 * 4 + 2]).toBeCloseTo(0.5, 6);
  });

  it('curves LUT reflects channel edits', () => {
    const lut = curvesLut({
      kind: 'curves',
      rgb: [...IDENTITY_CURVE],
      r: [
        { x: 0, y: 0 },
        { x: 128, y: 200 },
        { x: 255, y: 255 },
      ],
      g: [...IDENTITY_CURVE],
      b: [...IDENTITY_CURVE],
    });
    expect(lut[128 * 4]! * 255).toBeCloseTo(200, 3);
    expect(lut[128 * 4 + 1]! * 255).toBeCloseTo(128, 3);
  });
});

describe('auto levels', () => {
  it('finds black and white points ignoring sparse outliers', () => {
    const h = new Array(256).fill(0);
    h[3] = 1; // outlier
    for (let i = 40; i <= 210; i++) h[i] = 1000;
    h[250] = 1; // outlier
    expect(autoLevels(h, 0.001)).toEqual({ inBlack: 40, inWhite: 210 });
  });
});
