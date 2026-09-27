import { linearToSrgb, srgbToLinear } from '../color/color';
import { curveFunction, levelsFunction } from './curves';
import type { Adjustment } from './types';

/**
 * Parameter mappings and a CPU reference for every point-wise adjustment. The GLSL in
 * shaders.ts implements exactly these formulas; tests compare the two. Colours are
 * straight (un-premultiplied) sRGB in 0..1.
 */

export type RGB3 = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- mappings

/** Brightness −150..150 → exponent applied to each channel (keeps black and white fixed). */
export function brightnessGamma(brightness: number): number {
  return Math.pow(2, -brightness / 100);
}

/** Contrast −100..100 → exponent of a symmetric S-curve around mid grey. */
export function contrastExponent(contrast: number): number {
  return Math.pow(2, (contrast / 100) * 1.2);
}

/**
 * Temperature/tint → per-channel gains in linear light, normalised so neutral greys
 * keep their luminance. Positive temperature warms (more red, less blue); positive
 * tint shifts towards magenta (less green).
 */
export function whiteBalanceGains(temperature: number, tint: number): RGB3 {
  const t = temperature / 100;
  const m = tint / 100;
  const r = Math.exp(0.35 * t + 0.08 * m);
  const g = Math.exp(-0.25 * m);
  const b = Math.exp(-0.35 * t + 0.08 * m);
  const k = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
  return [r * k, g * k, b * k];
}

/**
 * Shadows/Highlights exposure change in stops for a pixel whose neighbourhood has
 * (sRGB-encoded) luminance `lb`. Shadows fade out towards mid grey and highlights fade
 * in above it, so midtones are left mostly alone. `shadows`/`highlights` are −100..100.
 */
export function shadowsHighlightsStops(lb: number, shadows: number, highlights: number): number {
  const ws = 1 - smoothstep(0, 0.55, lb);
  const wh = smoothstep(0.45, 1, lb);
  return (shadows / 100) * 2.5 * ws + (highlights / 100) * 1.5 * wh;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Rec. 709 luminance of (encoded) RGB, as used for neighbourhood tone decisions. */
export function luma709(c: RGB3): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Shadows/Highlights for a pixel given its neighbourhood luminance (the renderer uses a
 * Gaussian-blurred copy of the image for `lb`).
 */
export function applyShadowsHighlights(c: RGB3, lb: number, shadows: number, highlights: number): RGB3 {
  const gain = Math.pow(2, shadowsHighlightsStops(lb, shadows, highlights));
  const l = lin(c);
  return enc([l[0] * gain, l[1] * gain, l[2] * gain]);
}

// --------------------------------------------------------------- colour math

export function rgbToHsl([r, g, b]: RGB3): RGB3 {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  const u = t - Math.floor(t);
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 0.5) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

export function hslToRgb([h, s, l]: RGB3): RGB3 {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

const lin = (c: RGB3): RGB3 => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
const enc = (c: RGB3): RGB3 => [linearToSrgb(clamp01(c[0])), linearToSrgb(clamp01(c[1])), linearToSrgb(clamp01(c[2]))];

/** Photoshop-style Black & White: weights per hue sector (percent). */
export function blackWhiteGrey(c: RGB3, w: { reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number }): number {
  const [r, g, b] = c;
  const R = w.reds / 100;
  const Y = w.yellows / 100;
  const G = w.greens / 100;
  const C = w.cyans / 100;
  const B = w.blues / 100;
  const M = w.magentas / 100;
  let v: number;
  // min + (mid − min)·secondary + (max − mid)·primary, per ordering of the channels.
  if (r >= g && g >= b) v = b + (g - b) * Y + (r - g) * R;
  else if (r >= b && b >= g) v = g + (b - g) * M + (r - b) * R;
  else if (g >= r && r >= b) v = b + (r - b) * Y + (g - r) * G;
  else if (g >= b && b >= r) v = r + (b - r) * C + (g - b) * G;
  else if (b >= r && r >= g) v = g + (r - g) * M + (b - r) * B;
  else v = r + (g - r) * C + (b - g) * B;
  return clamp01(v);
}

// ------------------------------------------------------------ CPU reference

/**
 * Applies a point-wise adjustment to one colour. Neighbourhood filters (blur, sharpen,
 * shadows/highlights) return the input unchanged — they need the surrounding pixels.
 */
export function applyPointwise(adj: Adjustment, c: RGB3): RGB3 {
  switch (adj.kind) {
    case 'brightnessContrast': {
      const g = brightnessGamma(adj.brightness);
      const s = contrastExponent(adj.contrast);
      return c.map((v) => {
        const x = Math.pow(Math.max(v, 0), g);
        return x < 0.5 ? 0.5 * Math.pow(2 * x, s) : 1 - 0.5 * Math.pow(Math.max(2 * (1 - x), 0), s);
      }) as RGB3;
    }
    case 'exposure': {
      const mult = Math.pow(2, adj.exposure);
      const inv = 1 / Math.max(0.01, adj.gamma);
      const l = lin(c).map((v) => Math.pow(Math.max(v * mult + adj.offset, 0), inv)) as RGB3;
      return enc(l);
    }
    case 'levels': {
      const master = levelsFunction(adj.rgb);
      return [master(levelsFunction(adj.r)(c[0])), master(levelsFunction(adj.g)(c[1])), master(levelsFunction(adj.b)(c[2]))];
    }
    case 'curves': {
      const f = (pts: typeof adj.rgb) => {
        const fn = curveFunction(pts);
        return (v: number) => fn(v * 255) / 255;
      };
      const master = f(adj.rgb);
      return [master(f(adj.r)(c[0])), master(f(adj.g)(c[1])), master(f(adj.b)(c[2]))];
    }
    case 'hueSaturation': {
      const hsl = rgbToHsl(c);
      if (adj.colorize) {
        hsl[0] = (((adj.hue / 360) % 1) + 1) % 1;
        hsl[1] = clamp01(adj.saturation / 100);
      } else {
        hsl[0] = (((hsl[0] + adj.hue / 360) % 1) + 1) % 1;
        hsl[1] = clamp01(hsl[1] * (1 + adj.saturation / 100));
      }
      const rgb = hslToRgb(hsl);
      const l = adj.lightness / 100;
      return rgb.map((v) => (l > 0 ? v + (1 - v) * l : v * (1 + l))) as RGB3;
    }
    case 'vibrance': {
      const mx = Math.max(...c);
      const mn = Math.min(...c);
      const sat = mx - mn;
      const luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      const v = adj.vibrance / 100;
      const amt = v >= 0 ? v * (1 - sat) : v;
      const s = adj.saturation / 100;
      return c.map((x) => {
        const a = luma + (x - luma) * (1 + amt);
        return clamp01(luma + (a - luma) * (1 + s));
      }) as RGB3;
    }
    case 'whiteBalance': {
      const g = whiteBalanceGains(adj.temperature, adj.tint);
      const l = lin(c);
      return enc([l[0] * g[0], l[1] * g[1], l[2] * g[2]]);
    }
    case 'blackWhite': {
      const v = blackWhiteGrey(c, adj);
      return [v, v, v];
    }
    case 'shadowsHighlights':
    case 'gaussianBlur':
    case 'sharpen':
      return c;
  }
}
