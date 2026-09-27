import { describe, expect, it } from 'vitest';
import { StrokeEngine, catmullRom, type Dab } from './StrokeEngine';

function run(engine: StrokeEngine, pts: [number, number][], pressure = 1): Dab[] {
  const dabs = engine.begin({ x: pts[0]![0], y: pts[0]![1], pressure });
  for (const [x, y] of pts.slice(1)) dabs.push(...engine.add({ x, y, pressure }));
  dabs.push(...engine.end());
  return dabs;
}

describe('StrokeEngine', () => {
  it('places evenly spaced dabs along a straight line', () => {
    const e = new StrokeEngine({ spacing: () => 5, smoothingRadius: 0 });
    const dabs = run(e, [
      [0, 0],
      [13, 0],
      [37, 0],
      [100, 0],
    ]);
    expect(dabs[0]).toMatchObject({ x: 0, y: 0 });
    expect(dabs).toHaveLength(21); // 0, 5, …, 100
    for (let i = 1; i < dabs.length; i++) {
      expect(dabs[i]!.x - dabs[i - 1]!.x).toBeCloseTo(5, 5);
      expect(dabs[i]!.y).toBeCloseTo(0, 5);
    }
  });

  it('spaces dabs by the pressure-dependent size', () => {
    const e = new StrokeEngine({ spacing: (p) => 10 * p, smoothingRadius: 0 });
    const light = run(e, [
      [0, 0],
      [100, 0],
    ], 0.5);
    expect(light.length).toBe(21);
  });

  it('absorbs jitter within the smoothing radius and catches up at the end', () => {
    const e = new StrokeEngine({ spacing: () => 1, smoothingRadius: 10 });
    e.begin({ x: 0, y: 0, pressure: 1 });
    // Jitter within the string length produces no dabs.
    expect(e.add({ x: 3, y: 4, pressure: 1 })).toEqual([]);
    expect(e.add({ x: -5, y: 2, pressure: 1 })).toEqual([]);
    const moved = e.add({ x: 30, y: 0, pressure: 1 });
    const rest = e.end();
    const all = [...moved, ...rest];
    // The stroke reaches the final pointer position.
    expect(all[all.length - 1]!.x).toBeGreaterThan(28);
  });

  it('interpolates curves through the control points', () => {
    const p0 = { x: 0, y: 0, pressure: 0 };
    const p1 = { x: 10, y: 0, pressure: 0 };
    const p2 = { x: 20, y: 10, pressure: 1 };
    const p3 = { x: 20, y: 20, pressure: 1 };
    expect(catmullRom(p0, p1, p2, p3, 0)).toMatchObject({ x: 10, y: 0 });
    const end = catmullRom(p0, p1, p2, p3, 1);
    expect(end.x).toBeCloseTo(20);
    expect(end.y).toBeCloseTo(10);
    expect(catmullRom(p0, p1, p2, p3, 0.5).pressure).toBeCloseTo(0.5);
  });

  it('handles repeated identical samples without NaNs', () => {
    const e = new StrokeEngine({ spacing: () => 2, smoothingRadius: 0 });
    const dabs = run(e, [
      [5, 5],
      [5, 5],
      [5, 5],
      [9, 5],
    ]);
    for (const d of dabs) expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
  });
});
