import type { BlendMode } from '../doc/types';
import { BLEND_FUNCTIONS, blendExpression } from '../render/shaders/blend';
import { COLOR_HELPERS, FRAGMENT_HEADER, REGION_VERTEX } from '../render/shaders/common';
import type { AdjustmentKind } from './types';

/** Colour-space helpers shared by adjustment shaders (mirrors adjustments/math.ts). */
const ADJUST_HELPERS = /* glsl */ `
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
  float u = fract(t);
  if (u < 1.0 / 6.0) return p + (q - p) * 6.0 * u;
  if (u < 0.5) return q;
  if (u < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - u) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2rgb(p, q, hsl.x + 1.0 / 3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0 / 3.0));
}
`;

/** `vec3 adjust(vec3 c, vec2 px)` per kind; c is straight sRGB, px the region pixel. */
const ADJUST_FUNCTIONS: Record<AdjustmentKind, string> = {
  brightnessContrast: /* glsl */ `
uniform float u_gamma;
uniform float u_contrast;
vec3 adjust(vec3 c, vec2 px) {
  vec3 x = pow(max(c, vec3(0.0)), vec3(u_gamma));
  vec3 lo = 0.5 * pow(2.0 * x, vec3(u_contrast));
  vec3 hi = 1.0 - 0.5 * pow(max(2.0 * (1.0 - x), vec3(0.0)), vec3(u_contrast));
  return mix(lo, hi, step(0.5, x));
}`,
  exposure: /* glsl */ `
uniform float u_mult;
uniform float u_offset;
uniform float u_invGamma;
vec3 adjust(vec3 c, vec2 px) {
  vec3 l = toLinear(c) * u_mult + u_offset;
  l = pow(max(l, vec3(0.0)), vec3(u_invGamma));
  return toSrgb(clamp(l, 0.0, 1.0));
}`,
  levels: 'LUT',
  curves: 'LUT',
  hueSaturation: /* glsl */ `
uniform float u_hue;
uniform float u_sat;
uniform float u_light;
uniform int u_colorize;
vec3 adjust(vec3 c, vec2 px) {
  vec3 hsl = rgb2hsl(c);
  if (u_colorize == 1) {
    hsl.x = fract(u_hue);
    hsl.y = clamp(u_sat, 0.0, 1.0);
  } else {
    hsl.x = fract(hsl.x + u_hue);
    hsl.y = clamp(hsl.y * (1.0 + u_sat), 0.0, 1.0);
  }
  vec3 rgb = hsl2rgb(hsl);
  return u_light > 0.0 ? rgb + (1.0 - rgb) * u_light : rgb * (1.0 + u_light);
}`,
  vibrance: /* glsl */ `
uniform float u_vib;
uniform float u_sat;
vec3 adjust(vec3 c, vec2 px) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float amt = u_vib >= 0.0 ? u_vib * (1.0 - (mx - mn)) : u_vib;
  vec3 a = luma + (c - luma) * (1.0 + amt);
  return clamp(luma + (a - luma) * (1.0 + u_sat), 0.0, 1.0);
}`,
  whiteBalance: /* glsl */ `
uniform vec3 u_gain;
vec3 adjust(vec3 c, vec2 px) {
  return toSrgb(clamp(toLinear(c) * u_gain, 0.0, 1.0));
}`,
  blackWhite: /* glsl */ `
uniform float u_w[6]; // reds, yellows, greens, cyans, blues, magentas (0..1+)
vec3 adjust(vec3 c, vec2 px) {
  float r = c.r, g = c.g, b = c.b;
  float v;
  if (r >= g && g >= b) v = b + (g - b) * u_w[1] + (r - g) * u_w[0];
  else if (r >= b && b >= g) v = g + (b - g) * u_w[5] + (r - b) * u_w[0];
  else if (g >= r && r >= b) v = b + (r - b) * u_w[1] + (g - r) * u_w[2];
  else if (g >= b && b >= r) v = r + (b - r) * u_w[3] + (g - b) * u_w[2];
  else if (b >= r && r >= g) v = g + (r - g) * u_w[5] + (b - r) * u_w[4];
  else v = r + (g - r) * u_w[3] + (b - g) * u_w[4];
  return vec3(clamp(v, 0.0, 1.0));
}`,
  shadowsHighlights: /* glsl */ `
uniform float u_shadows;
uniform float u_highlights;
vec3 adjust(vec3 c, vec2 px) {
  // u_aux holds the blurred image: its luminance decides what counts as shadow or
  // highlight, so the exposure change varies smoothly and local contrast survives.
  float lb = dot(unpremultiply(texelFetch(u_aux, ivec2(px), 0)), vec3(0.2126, 0.7152, 0.0722));
  float ws = 1.0 - smoothstep(0.0, 0.55, lb);
  float wh = smoothstep(0.45, 1.0, lb);
  float stops = u_shadows * 2.5 * ws + u_highlights * 1.5 * wh;
  return toSrgb(clamp(toLinear(c) * exp2(stops), 0.0, 1.0));
}`,
  gaussianBlur: /* glsl */ `
vec3 adjust(vec3 c, vec2 px) {
  return unpremultiply(texelFetch(u_aux, ivec2(px), 0));
}`,
  sharpen: /* glsl */ `
uniform float u_amount;
uniform float u_threshold;
vec3 adjust(vec3 c, vec2 px) {
  // Unsharp mask: push each pixel away from its blurred neighbourhood.
  vec3 bl = unpremultiply(texelFetch(u_aux, ivec2(px), 0));
  vec3 d = c - bl;
  if (abs(dot(d, vec3(0.2126, 0.7152, 0.0722))) * 255.0 < u_threshold) return c;
  return c + d * u_amount;
}`,
};

const LUT_FUNCTION = /* glsl */ `
vec3 adjust(vec3 c, vec2 px) {
  vec3 u = (clamp(c, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return vec3(texture(u_lut, vec2(u.r, 0.5)).r, texture(u_lut, vec2(u.g, 0.5)).g, texture(u_lut, vec2(u.b, 0.5)).b);
}`;

/**
 * Applies an adjustment to the backdrop accumulator. The adjusted colour is combined
 * with the original through the layer's blend mode and mixed by opacity · mask. Alpha
 * is preserved: adjustments only change pixels that exist.
 */
export function adjustmentProgram(kind: AdjustmentKind, mode: BlendMode): { vertex: string; fragment: string } {
  const fn = ADJUST_FUNCTIONS[kind] === 'LUT' ? LUT_FUNCTION : ADJUST_FUNCTIONS[kind];
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
${BLEND_FUNCTIONS}
${ADJUST_HELPERS}
uniform sampler2D u_backdrop;
uniform sampler2D u_aux;
uniform sampler2D u_lut;
uniform vec2 u_regionOrigin;
uniform float u_opacity;
${fn}
in vec2 v_px;
out vec4 o;
void main() {
  vec4 b = texelFetch(u_backdrop, ivec2(v_px), 0);
  if (b.a <= 0.0) {
    o = b;
    return;
  }
  vec3 Cb = unpremultiply(b);
  vec3 Cs = clamp(adjust(Cb, v_px), 0.0, 1.0);
  vec3 B = clamp(${blendExpression(mode)}, 0.0, 1.0);
  float k = u_opacity * sampleMask(v_px + u_regionOrigin);
  o = vec4(mix(Cb, B, k) * b.a, b.a);
}
`,
  };
}

/**
 * One direction of a separable Gaussian blur over a region-local texture. Pairs of taps
 * are merged into single bilinear fetches (half the texture reads). Samples outside the
 * valid region clamp to its edge, which repeats edge pixels like pro editors do.
 */
export function gaussianPassProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform vec2 u_texSize;
uniform vec2 u_regionSize;
uniform vec2 u_dir;
uniform float u_sigma;
uniform int u_reach;
in vec2 v_px;
out vec4 o;
vec4 tap(vec2 p) {
  p = clamp(p, vec2(0.5), u_regionSize - 0.5);
  return texture(u_src, p / u_texSize);
}
void main() {
  float k = -0.5 / (u_sigma * u_sigma);
  vec4 sum = tap(v_px);
  float wsum = 1.0;
  for (int i = 1; i <= 2048; i += 2) {
    if (i > u_reach) break;
    float w1 = exp(float(i * i) * k);
    float w2 = i + 1 <= u_reach ? exp(float((i + 1) * (i + 1)) * k) : 0.0;
    float w = w1 + w2;
    float off = (float(i) * w1 + float(i + 1) * w2) / w;
    sum += (tap(v_px + u_dir * off) + tap(v_px - u_dir * off)) * w;
    wsum += 2.0 * w;
  }
  o = sum / wsum;
}
`,
  };
}
