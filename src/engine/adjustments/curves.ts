import type { CurvePoint, CurvesAdjustment, LevelsAdjustment, LevelsChannel } from './types';

/**
 * Tone-curve math for Curves and Levels. Everything here is pure so it can be unit
 * tested and reused by the UI (curve drawing) and the renderer (LUT textures).
 */

export const IDENTITY_CURVE: readonly CurvePoint[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 255, y: 255 }),
]);

export const IDENTITY_LEVELS: LevelsChannel = Object.freeze({
  inBlack: 0,
  inWhite: 255,
  gamma: 1,
  outBlack: 0,
  outWhite: 255,
});

/** Sorts points by x and drops duplicates (the later point wins). */
export function normalizeCurve(points: readonly CurvePoint[]): CurvePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of sorted) {
    const x = Math.max(0, Math.min(255, p.x));
    const y = Math.max(0, Math.min(255, p.y));
    if (out.length && out[out.length - 1]!.x === x) out[out.length - 1] = { x, y };
    else out.push({ x, y });
  }
  return out;
}

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson). Unlike a natural cubic
 * spline it never overshoots between points, so pulling one point can't make other
 * tones clip or ring. Outside the first/last point the curve is flat (like Photoshop).
 * Returns a function of x in 0..255 giving y in 0..255.
 */
export function curveFunction(points: readonly CurvePoint[]): (x: number) => number {
  const p = normalizeCurve(points);
  if (p.length === 0) return (x) => x;
  if (p.length === 1) {
    const y = p[0]!.y;
    return () => y;
  }
  const n = p.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1]!.x - p[i]!.x);
    m.push((p[i + 1]!.y - p[i]!.y) / dx[i]!);
  }
  // Initial tangents: secant at the ends, average inside (zero at local extrema).
  const t: number[] = new Array(n);
  t[0] = m[0]!;
  t[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  }
  // Limit tangents so each segment stays monotone.
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i]!;
      t[i + 1] = tau * b * m[i]!;
    }
  }
  return (x: number) => {
    if (x <= p[0]!.x) return p[0]!.y;
    if (x >= p[n - 1]!.x) return p[n - 1]!.y;
    let i = 0;
    while (i < n - 2 && x > p[i + 1]!.x) i++;
    const h = dx[i]!;
    const s = (x - p[i]!.x) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const y =
      (2 * s3 - 3 * s2 + 1) * p[i]!.y +
      (s3 - 2 * s2 + s) * h * t[i]! +
      (-2 * s3 + 3 * s2) * p[i + 1]!.y +
      (s3 - s2) * h * t[i + 1]!;
    return Math.max(0, Math.min(255, y));
  };
}

/** Photoshop Levels for one channel; input and output are 0..1. */
export function levelsFunction(l: LevelsChannel): (v: number) => number {
  const range = Math.max(1, l.inWhite - l.inBlack);
  const invGamma = 1 / Math.max(0.01, l.gamma);
  return (v: number) => {
    const x = Math.max(0, Math.min(1, (v * 255 - l.inBlack) / range));
    const g = Math.pow(x, invGamma);
    return Math.max(0, Math.min(1, (l.outBlack + g * (l.outWhite - l.outBlack)) / 255));
  };
}

export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  const p = normalizeCurve(points);
  return p.every((q) => q.x === q.y) && p.length >= 2 && p[0]!.x === 0 && p[p.length - 1]!.x === 255;
}

export function isIdentityLevels(l: LevelsChannel): boolean {
  return l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255;
}

/**
 * 256-entry RGBA lookup table (values 0..1). Per-channel functions run first, then the
 * composite (master) function — the same order as stacking a channel adjustment under
 * an RGB one.
 */
export function composeLut(
  master: (v: number) => number,
  red: (v: number) => number,
  green: (v: number) => number,
  blue: (v: number) => number,
): Float32Array {
  const lut = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i * 4] = master(red(v));
    lut[i * 4 + 1] = master(green(v));
    lut[i * 4 + 2] = master(blue(v));
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

export function curvesLut(adj: CurvesAdjustment): Float32Array {
  const fn = (points: readonly CurvePoint[]) => {
    const f = curveFunction(points);
    return (v: number) => f(v * 255) / 255;
  };
  return composeLut(fn(adj.rgb), fn(adj.r), fn(adj.g), fn(adj.b));
}

export function levelsLut(adj: LevelsAdjustment): Float32Array {
  return composeLut(levelsFunction(adj.rgb), levelsFunction(adj.r), levelsFunction(adj.g), levelsFunction(adj.b));
}

/**
 * Automatic levels: black/white input points that clip `clip` (fraction) of the
 * pixels at each end of a 256-bin histogram.
 */
export function autoLevels(histogram: ArrayLike<number>, clip = 0.001): { inBlack: number; inWhite: number } {
  let total = 0;
  for (let i = 0; i < 256; i++) total += histogram[i] ?? 0;
  if (total === 0) return { inBlack: 0, inWhite: 255 };
  const limit = total * clip;
  let acc = 0;
  let inBlack = 0;
  for (let i = 0; i < 256; i++) {
    acc += histogram[i] ?? 0;
    if (acc > limit) {
      inBlack = i;
      break;
    }
  }
  acc = 0;
  let inWhite = 255;
  for (let i = 255; i >= 0; i--) {
    acc += histogram[i] ?? 0;
    if (acc > limit) {
      inWhite = i;
      break;
    }
  }
  if (inWhite - inBlack < 2) return { inBlack: 0, inWhite: 255 };
  return { inBlack, inWhite };
}
