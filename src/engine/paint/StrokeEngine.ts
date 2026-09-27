/**
 * Turns raw pointer samples into evenly spaced brush dabs.
 *
 *  1. Smoothing — "lazy mouse": the brush trails the pointer on a string of length
 *     `smoothingRadius` and only moves when the string is taut. Jitter inside the radius
 *     is absorbed; on release the brush catches up to the pointer.
 *  2. Interpolation — centripetal Catmull-Rom through the smoothed points, so fast
 *     strokes with sparse samples still curve naturally without cusps or overshoot.
 *  3. Spacing — dabs are placed at fixed arc-length intervals (a fraction of the current,
 *     pressure-dependent diameter), carrying the remainder across segments.
 */

export interface StrokeSample {
  x: number;
  y: number;
  /** 0..1 */
  pressure: number;
}

export type Dab = StrokeSample;

export interface StrokeOptions {
  /** Distance between dabs in px for a given pressure. */
  spacing: (pressure: number) => number;
  /** Lazy-mouse string length in px (0 disables smoothing). */
  smoothingRadius: number;
}

function dist(a: StrokeSample, b: StrokeSample): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Centripetal Catmull-Rom point between p1 and p2 at u ∈ [0, 1] (Barry–Goldman form). */
export function catmullRom(p0: StrokeSample, p1: StrokeSample, p2: StrokeSample, p3: StrokeSample, u: number): StrokeSample {
  const knot = (a: StrokeSample, b: StrokeSample) => Math.max(Math.sqrt(dist(a, b)), 1e-4);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: StrokeSample, b: StrokeSample, ta: number, tb: number): StrokeSample => {
    const wa = (tb - t) / (tb - ta);
    const wb = (t - ta) / (tb - ta);
    return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, pressure: 0 };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  const c = mix(b1, b2, t1, t2);
  return { x: c.x, y: c.y, pressure: p1.pressure + (p2.pressure - p1.pressure) * u };
}

export class StrokeEngine {
  private points: StrokeSample[] = [];
  private brush: StrokeSample | null = null;
  private pointer: StrokeSample | null = null;
  /** Arc length travelled since the last dab. */
  private carry = 0;
  /** Index of the next segment start to render. */
  private next = 0;

  constructor(private readonly options: StrokeOptions) {}

  /** Starts a stroke; the first dab is stamped immediately. */
  begin(s: StrokeSample): Dab[] {
    this.points = [{ ...s }];
    this.brush = { ...s };
    this.pointer = { ...s };
    this.carry = 0;
    this.next = 0;
    return [{ ...s }];
  }

  /** Adds a pointer sample; returns dabs that are now final. */
  add(s: StrokeSample): Dab[] {
    if (!this.brush) return this.begin(s);
    this.pointer = { ...s };
    const r = this.options.smoothingRadius;
    let b: StrokeSample;
    if (r > 0) {
      const d = dist(this.brush, s);
      if (d <= r) {
        this.brush = { ...this.brush, pressure: s.pressure };
        return [];
      }
      const k = (d - r) / d;
      b = { x: this.brush.x + (s.x - this.brush.x) * k, y: this.brush.y + (s.y - this.brush.y) * k, pressure: s.pressure };
    } else {
      b = { ...s };
    }
    this.brush = b;
    return this.push(b);
  }

  private push(p: StrokeSample): Dab[] {
    const last = this.points[this.points.length - 1]!;
    if (dist(last, p) < 0.2) {
      last.pressure = p.pressure;
      return [];
    }
    this.points.push(p);
    // A segment P[i]→P[i+1] is final once P[i+2] exists (needed for its tangent).
    const dabs: Dab[] = [];
    while (this.next + 2 < this.points.length) {
      this.walk(this.next, dabs);
      this.next++;
    }
    return dabs;
  }

  /** Finishes the stroke (the brush catches up to the pointer when smoothing). */
  end(): Dab[] {
    const dabs: Dab[] = [];
    if (this.pointer && this.brush && this.options.smoothingRadius > 0) dabs.push(...this.push({ ...this.pointer }));
    while (this.next + 1 < this.points.length) {
      this.walk(this.next, dabs);
      this.next++;
    }
    this.brush = null;
    return dabs;
  }

  /** Places dabs along segment i (P[i] → P[i+1]). */
  private walk(i: number, out: Dab[]): void {
    const pts = this.points;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const steps = Math.max(1, Math.ceil(dist(p1, p2)));
    let prev = p1;
    for (let k = 1; k <= steps; k++) {
      const cur = catmullRom(p0, p1, p2, p3, k / steps);
      let len = dist(prev, cur);
      let from = prev;
      for (;;) {
        const spacing = Math.max(0.25, this.options.spacing(from.pressure));
        if (this.carry + len < spacing) break;
        const f = (spacing - this.carry) / len;
        const dab = {
          x: from.x + (cur.x - from.x) * f,
          y: from.y + (cur.y - from.y) * f,
          pressure: from.pressure + (cur.pressure - from.pressure) * f,
        };
        out.push(dab);
        len -= spacing - this.carry;
        from = dab;
        this.carry = 0;
      }
      this.carry += len;
      prev = cur;
    }
  }
}
