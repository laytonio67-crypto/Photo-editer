import type { BlendMode } from '../../doc/types';

/**
 * Blend functions B(Cb, Cs) on un-premultiplied colours, following the W3C
 * Compositing and Blending Level 1 definitions, with Photoshop's formulas for modes the
 * spec does not define (and Photoshop's Soft Light variant).
 *
 * The composite of a source over a backdrop is then (premultiplied):
 *   co = cs·(1 − αb) + cb·(1 − αs) + αs·αb·B(Cb, Cs)
 *   αo = αs + αb·(1 − αs)
 */
export const BLEND_FUNCTIONS = /* glsl */ `
float blendLum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

vec3 clipColor(vec3 c) {
  float l = blendLum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - blendLum(c))); }

float blendSat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}

float colorDodgeF(float b, float s) {
  if (b <= 0.0) return 0.0;
  if (s >= 1.0) return 1.0;
  return min(1.0, b / (1.0 - s));
}

float colorBurnF(float b, float s) {
  if (b >= 1.0) return 1.0;
  if (s <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - b) / s);
}

// Hard Light: multiply for s <= 0.5, screen(b, 2s - 1) above.
vec3 hardLightV(vec3 b, vec3 s) {
  vec3 lo = b * (2.0 * s);
  vec3 s2 = 2.0 * s - 1.0;
  vec3 hi = b + s2 - b * s2;
  return mix(lo, hi, vec3(greaterThan(s, vec3(0.5))));
}

float vividLightF(float b, float s) {
  return s <= 0.5 ? colorBurnF(b, 2.0 * s) : colorDodgeF(b, 2.0 * (s - 0.5));
}

float pinLightF(float b, float s) {
  return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * (s - 0.5));
}

// Photoshop's Soft Light (differs slightly from the W3C formula).
float softLightF(float b, float s) {
  if (s <= 0.5) return 2.0 * b * s + b * b * (1.0 - 2.0 * s);
  return 2.0 * b * (1.0 - s) + sqrt(b) * (2.0 * s - 1.0);
}

float divideF(float b, float s) {
  if (s <= 0.0) return b <= 0.0 ? 0.0 : 1.0;
  return min(1.0, b / s);
}
`;

/** GLSL expression computing B(Cb, Cs) for a mode; `Cb`, `Cs` are vec3 variables in scope. */
export function blendExpression(mode: BlendMode): string {
  switch (mode) {
    case 'normal':
    case 'dissolve':
      return 'Cs';
    case 'darken':
      return 'min(Cb, Cs)';
    case 'multiply':
      return 'Cb * Cs';
    case 'colorBurn':
      return 'vec3(colorBurnF(Cb.r, Cs.r), colorBurnF(Cb.g, Cs.g), colorBurnF(Cb.b, Cs.b))';
    case 'linearBurn':
      return 'max(Cb + Cs - 1.0, 0.0)';
    case 'darkerColor':
      return '(blendLum(Cs) < blendLum(Cb) ? Cs : Cb)';
    case 'lighten':
      return 'max(Cb, Cs)';
    case 'screen':
      return 'Cb + Cs - Cb * Cs';
    case 'colorDodge':
      return 'vec3(colorDodgeF(Cb.r, Cs.r), colorDodgeF(Cb.g, Cs.g), colorDodgeF(Cb.b, Cs.b))';
    case 'linearDodge':
      return 'min(Cb + Cs, 1.0)';
    case 'lighterColor':
      return '(blendLum(Cs) > blendLum(Cb) ? Cs : Cb)';
    case 'overlay':
      return 'hardLightV(Cs, Cb)';
    case 'softLight':
      return 'vec3(softLightF(Cb.r, Cs.r), softLightF(Cb.g, Cs.g), softLightF(Cb.b, Cs.b))';
    case 'hardLight':
      return 'hardLightV(Cb, Cs)';
    case 'vividLight':
      return 'vec3(vividLightF(Cb.r, Cs.r), vividLightF(Cb.g, Cs.g), vividLightF(Cb.b, Cs.b))';
    case 'linearLight':
      return 'clamp(Cb + 2.0 * Cs - 1.0, 0.0, 1.0)';
    case 'pinLight':
      return 'vec3(pinLightF(Cb.r, Cs.r), pinLightF(Cb.g, Cs.g), pinLightF(Cb.b, Cs.b))';
    case 'hardMix':
      return 'step(1.0, Cb + Cs)';
    case 'difference':
      return 'abs(Cb - Cs)';
    case 'exclusion':
      return 'Cb + Cs - 2.0 * Cb * Cs';
    case 'subtract':
      return 'max(Cb - Cs, 0.0)';
    case 'divide':
      return 'vec3(divideF(Cb.r, Cs.r), divideF(Cb.g, Cs.g), divideF(Cb.b, Cs.b))';
    case 'hue':
      return 'setLum(setSat(Cs, blendSat(Cb)), blendLum(Cb))';
    case 'saturation':
      return 'setLum(setSat(Cb, blendSat(Cs)), blendLum(Cb))';
    case 'color':
      return 'setLum(Cs, blendLum(Cb))';
    case 'luminosity':
      return 'setLum(Cb, blendLum(Cs))';
  }
}

/** Modes that can be drawn with fixed-function premultiplied "over" blending. */
export function isFixedFunctionBlend(mode: BlendMode): boolean {
  return mode === 'normal' || mode === 'dissolve';
}
