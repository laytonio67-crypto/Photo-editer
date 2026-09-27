import type { Layer, LayerId } from '../doc/types';

/** 256-bin counts per channel. `luma` uses Rec. 709 weights on the 8-bit sRGB values. */
export interface HistogramData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Number of counted (non-transparent) pixels. */
  total: number;
}

export function emptyHistogram(): HistogramData {
  return { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), luma: new Uint32Array(256), total: 0 };
}

/**
 * Bins straight (un-premultiplied) RGBA8 pixels. Fully transparent pixels are skipped:
 * they have no colour to measure.
 */
export function histogramFromPixels(data: Uint8Array): HistogramData {
  const h = emptyHistogram();
  const { r, g, b, luma } = h;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const R = data[i]!;
    const G = data[i + 1]!;
    const B = data[i + 2]!;
    r[R]!++;
    g[G]!++;
    b[B]!++;
    luma[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]!++;
    total++;
  }
  h.total = total;
  return h;
}

/** Sum of the red, green and blue counts (for monochromatic auto levels). */
export function combinedRgb(h: HistogramData): Uint32Array {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) out[i] = h.r[i]! + h.g[i]! + h.b[i]!;
  return out;
}

/**
 * The layer tree as it is below `id`: the layer itself, everything above it, and every
 * later sibling of its ancestors are removed. This is the image an adjustment layer
 * receives as input. Returns null when `id` is not in the tree.
 */
export function layersBelow(layers: readonly Layer[], id: LayerId): Layer[] | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.id === id) return layers.slice(0, i);
    if (layer.type === 'group') {
      const inner = layersBelow(layer.children, id);
      if (inner) return [...layers.slice(0, i), { ...layer, children: inner }];
    }
  }
  return null;
}

export interface HistogramStats {
  mean: number;
  stdDev: number;
  median: number;
  count: number;
}

/** Mean, standard deviation and median level of a 256-bin histogram. */
export function histogramStats(bins: ArrayLike<number>): HistogramStats {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    const n = bins[i] ?? 0;
    count += n;
    sum += n * i;
  }
  if (count === 0) return { mean: 0, stdDev: 0, median: 0, count: 0 };
  const mean = sum / count;
  let variance = 0;
  let acc = 0;
  let median = -1;
  for (let i = 0; i < 256; i++) {
    const n = bins[i] ?? 0;
    variance += n * (i - mean) * (i - mean);
    acc += n;
    if (median < 0 && acc >= count / 2) median = i;
  }
  return { mean, stdDev: Math.sqrt(variance / count), median, count };
}
