import { describe, expect, it } from 'vitest';
import { createAdjustmentLayer, createGroupLayer, createPixelLayer } from '../doc/factory';
import { combinedRgb, histogramFromPixels, histogramStats, layersBelow } from './histogram';
import { defaultAdjustment } from '../adjustments/registry';

describe('histogramFromPixels', () => {
  it('bins channels and luminance, skipping transparent pixels', () => {
    const data = new Uint8Array([255, 0, 0, 255, 10, 20, 30, 255, 99, 99, 99, 0]);
    const h = histogramFromPixels(data);
    expect(h.total).toBe(2);
    expect(h.r[255]).toBe(1);
    expect(h.r[10]).toBe(1);
    expect(h.r[99]).toBe(0);
    expect(h.g[0]).toBe(1);
    expect(h.b[30]).toBe(1);
    expect(h.luma[Math.round(0.2126 * 255)]).toBe(1);
    expect(combinedRgb(h)[0]).toBe(2); // red pixel's g and b
  });
});

describe('layersBelow', () => {
  it('drops the layer, everything above it, and later siblings of its ancestors', () => {
    const a = createPixelLayer({ name: 'a', surfaceId: 's1' });
    const b = createPixelLayer({ name: 'b', surfaceId: 's2' });
    const adj = createAdjustmentLayer({ name: 'levels', adjustment: defaultAdjustment('levels') });
    const c = createPixelLayer({ name: 'c', surfaceId: 's3' });
    const group = createGroupLayer({ name: 'g', children: [b, adj, c] });
    const top = createPixelLayer({ name: 'top', surfaceId: 's4' });
    const below = layersBelow([a, group, top], adj.id)!;
    expect(below.map((l) => l.name)).toEqual(['a', 'g']);
    const g = below[1]!;
    expect(g.type === 'group' && g.children.map((l) => l.name)).toEqual(['b']);
    expect(layersBelow([a], 'missing')).toBeNull();
    expect(layersBelow([a, top], top.id)!.map((l) => l.name)).toEqual(['a']);
  });
});

describe('histogramStats', () => {
  it('computes mean, standard deviation and median', () => {
    const bins = new Uint32Array(256);
    bins[10] = 1;
    bins[20] = 2;
    bins[30] = 1;
    const s = histogramStats(bins);
    expect(s.count).toBe(4);
    expect(s.mean).toBe(20);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(50), 9);
    expect(s.median).toBe(20);
    expect(histogramStats(new Uint32Array(256)).count).toBe(0);
  });
});
