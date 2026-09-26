import { describe, expect, it } from 'vitest';
import { magicWandMask } from './floodFill';

/** Builds premultiplied RGBA from a grid of opaque grey values. */
function grid(rows: number[][]): { data: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      data.set([v, v, v, 255], (y * width + x) * 4);
    }),
  );
  return { data, width, height };
}

describe('magic wand', () => {
  const img = grid([
    [0, 0, 200, 0],
    [0, 200, 200, 0],
    [200, 200, 0, 0],
    [0, 0, 0, 10],
  ]);

  it('selects a contiguous region within tolerance', () => {
    const { mask, bounds } = magicWandMask(img.data, img.width, img.height, 0, 0, 5, true);
    expect(Array.from(mask).map((v) => (v ? 1 : 0))).toEqual([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('selects all matching pixels when not contiguous', () => {
    const { mask } = magicWandMask(img.data, img.width, img.height, 0, 0, 5, false);
    expect(Array.from(mask).filter(Boolean).length).toBe(10);
  });

  it('honours tolerance', () => {
    const { mask } = magicWandMask(img.data, img.width, img.height, 3, 3, 10, true);
    // Seed 10 grows into the connected zeros on the right/bottom.
    expect(mask[3 * 4 + 3]).toBe(255);
    expect(mask[3 * 4 + 0]).toBe(255);
    expect(mask[0]).toBe(0);
  });

  it('returns an empty mask for out-of-range seeds', () => {
    expect(magicWandMask(img.data, 4, 4, 9, 9, 5, true).bounds).toBeNull();
  });
});
