import { describe, expect, it } from 'vitest';
import {
  clampPan,
  docToScreen,
  fitView,
  formatZoom,
  nextZoomStep,
  prevZoomStep,
  screenToDoc,
  zoomAt,
} from './viewMath';
import { rulerSteps } from '../../ui/viewport/rulerMath';

describe('view math', () => {
  it('round-trips document and screen coordinates', () => {
    const v = { zoom: 2.5, panX: 13, panY: -7 };
    const p = screenToDoc(v, docToScreen(v, { x: 10.25, y: 3 }));
    expect(p.x).toBeCloseTo(10.25);
    expect(p.y).toBeCloseTo(3);
  });

  it('keeps the anchor fixed when zooming', () => {
    const v = { zoom: 0.5, panX: 100, panY: 40 };
    const anchor = { x: 321, y: 123 };
    const before = screenToDoc(v, anchor);
    const z = zoomAt(v, 1.7, anchor);
    const after = screenToDoc(z, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('snaps pan to whole device pixels at integer zoom for exact display', () => {
    const z = zoomAt({ zoom: 0.5, panX: 10.3, panY: 4.6 }, 1, { x: 200.4, y: 100.2 });
    expect(Number.isInteger(z.panX)).toBe(true);
    expect(Number.isInteger(z.panY)).toBe(true);
  });

  it('fits and centres documents', () => {
    const v = fitView(4000, 2000, 1000, 800, 20);
    expect(v.zoom).toBeCloseTo(960 / 4000);
    expect(v.panX + (4000 * v.zoom) / 2).toBeCloseTo(500, 0);
    expect(fitView(100, 100, 1000, 800, 20, 1).zoom).toBe(1);
  });

  it('steps through zoom presets', () => {
    expect(nextZoomStep(1)).toBe(2);
    expect(prevZoomStep(1)).toBeCloseTo(0.6667);
    expect(nextZoomStep(0.7)).toBe(1);
    expect(prevZoomStep(0.01)).toBe(0.01);
  });

  it('prevents scrolling the document fully out of view', () => {
    const v = clampPan({ zoom: 1, panX: -5000, panY: 5000 }, 1000, 1000, 800, 600, 64);
    expect(v.panX).toBe(64 - 1000);
    expect(v.panY).toBe(600 - 64);
  });

  it('formats zoom percentages', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.3333)).toBe('33.3%');
    expect(formatZoom(16)).toBe('1600%');
    expect(formatZoom(0.0625)).toBe('6.25%');
  });

  it('chooses readable ruler steps', () => {
    expect(rulerSteps(1)).toEqual({ major: 100, minor: 10 });
    expect(rulerSteps(0.1).major).toBe(1000);
    expect(rulerSteps(64).major).toBe(1);
  });
});
