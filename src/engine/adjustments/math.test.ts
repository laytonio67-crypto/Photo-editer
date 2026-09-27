import { describe, expect, it } from 'vitest';
import { applyPointwise, blackWhiteGrey, hslToRgb, rgbToHsl, whiteBalanceGains, type RGB3 } from './math';
import { ADJUSTMENTS, ADJUSTMENT_ORDER, defaultAdjustment } from './registry';
import type { Adjustment } from './types';

const SAMPLES: RGB3[] = [
  [0, 0, 0],
  [1, 1, 1],
  [0.5, 0.5, 0.5],
  [0.8, 0.2, 0.1],
  [0.1, 0.6, 0.3],
  [0.25, 0.35, 0.9],
];

describe('adjustment defaults', () => {
  it('neutral defaults leave colours unchanged', () => {
    for (const kind of ADJUSTMENT_ORDER) {
      const adj = defaultAdjustment(kind);
      if (!ADJUSTMENTS[kind].isIdentity(adj)) continue;
      for (const c of SAMPLES) {
        const out = applyPointwise(adj, c);
        for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(c[i]!, 5);
      }
    }
  });

  it('filters declare a neighbourhood margin, point operations do not', () => {
    expect(ADJUSTMENTS.gaussianBlur.margin({ kind: 'gaussianBlur', radius: 10 })).toBe(31);
    expect(ADJUSTMENTS.curves.margin(defaultAdjustment('curves'))).toBe(0);
  });
});

describe('point-wise formulas', () => {
  it('brightness keeps black and white and lifts midtones', () => {
    const adj: Adjustment = { kind: 'brightnessContrast', brightness: 50, contrast: 0 };
    expect(applyPointwise(adj, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(applyPointwise(adj, [1, 1, 1])[0]).toBeCloseTo(1, 6);
    expect(applyPointwise(adj, [0.5, 0.5, 0.5])[0]).toBeGreaterThan(0.55);
  });

  it('contrast pivots around mid grey', () => {
    const adj: Adjustment = { kind: 'brightnessContrast', brightness: 0, contrast: 60 };
    expect(applyPointwise(adj, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5, 6);
    expect(applyPointwise(adj, [0.3, 0.3, 0.3])[0]).toBeLessThan(0.3);
    expect(applyPointwise(adj, [0.7, 0.7, 0.7])[0]).toBeGreaterThan(0.7);
  });

  it('+1 stop of exposure doubles linear light', () => {
    const out = applyPointwise({ kind: 'exposure', exposure: 1, offset: 0, gamma: 1 }, [0.5, 0.5, 0.5]);
    // 0.5 sRGB ≈ 0.214 linear → 0.428 linear ≈ 0.686 sRGB
    expect(out[0]).toBeCloseTo(0.6858, 3);
  });

  it('hue rotation by 120° maps red to green', () => {
    const out = applyPointwise({ kind: 'hueSaturation', hue: 120, saturation: 0, lightness: 0, colorize: false }, [1, 0, 0]);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it('saturation −100 produces greys', () => {
    const out = applyPointwise({ kind: 'hueSaturation', hue: 0, saturation: -100, lightness: 0, colorize: false }, [0.8, 0.2, 0.1]);
    expect(out[0]).toBeCloseTo(out[1], 6);
    expect(out[1]).toBeCloseTo(out[2], 6);
  });

  it('vibrance boosts muted colours more than saturated ones', () => {
    const adj: Adjustment = { kind: 'vibrance', vibrance: 50, saturation: 0 };
    const spread = (c: RGB3) => Math.max(...c) - Math.min(...c);
    const muted: RGB3 = [0.5, 0.45, 0.4];
    const vivid: RGB3 = [0.9, 0.1, 0.1];
    const mutedGain = spread(applyPointwise(adj, muted)) / spread(muted);
    const vividGain = spread(applyPointwise(adj, vivid)) / spread(vivid);
    expect(mutedGain).toBeGreaterThan(vividGain);
  });

  it('white balance keeps neutral grey luminance and warms with temperature', () => {
    const g = whiteBalanceGains(40, 0);
    expect(0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]).toBeCloseTo(1, 6);
    const out = applyPointwise({ kind: 'whiteBalance', temperature: 40, tint: 0 }, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it('black & white reproduces the sector weights', () => {
    const w = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
    expect(blackWhiteGrey([1, 0, 0], w)).toBeCloseTo(0.4, 6);
    expect(blackWhiteGrey([1, 1, 0], w)).toBeCloseTo(0.6, 6);
    expect(blackWhiteGrey([0, 0, 1], w)).toBeCloseTo(0.2, 6);
    expect(blackWhiteGrey([1, 0, 1], w)).toBeCloseTo(0.8, 6);
    expect(blackWhiteGrey([1, 1, 1], w)).toBeCloseTo(1, 6);
  });

  it('HSL conversions round-trip', () => {
    for (const c of SAMPLES) {
      const back = hslToRgb(rgbToHsl(c));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(c[i]!, 6);
    }
  });
});
