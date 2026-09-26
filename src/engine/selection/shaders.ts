import { FRAGMENT_HEADER, REGION_VERTEX } from '../render/shaders/common';

/**
 * Coverage sampling with placement and a default value outside the placed texture —
 * the shared representation of selections and masks. `ch` selects the channel
 * (0 = red for R8 coverage surfaces, 3 = alpha for rasterised shapes / layer alpha).
 */
const COVERAGE_FN = /* glsl */ `
float coverage(sampler2D t, vec4 rect, float def, int ch, vec2 doc) {
  vec2 local = doc - rect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= rect.z || local.y >= rect.w) return def;
  vec4 v = texelFetch(t, ivec2(local), 0);
  return ch == 3 ? v.a : v.r;
}
`;

/** Combines coverage A with B: 0 replace, 1 add, 2 subtract, 3 intersect, 4 invert A. */
export function combineProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COVERAGE_FN}
uniform sampler2D u_a;
uniform vec4 u_aRect;
uniform float u_aDefault;
uniform int u_aChannel;
uniform sampler2D u_b;
uniform vec4 u_bRect;
uniform float u_bDefault;
uniform int u_bChannel;
uniform vec2 u_outOrigin;
uniform int u_mode;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = u_outOrigin + v_px;
  float a = coverage(u_a, u_aRect, u_aDefault, u_aChannel, doc);
  float b = coverage(u_b, u_bRect, u_bDefault, u_bChannel, doc);
  float r;
  if (u_mode == 0) r = b;
  else if (u_mode == 1) r = max(a, b);
  else if (u_mode == 2) r = a * (1.0 - b);
  else if (u_mode == 3) r = min(a, b);
  else r = 1.0 - a;
  o = vec4(r, 0.0, 0.0, 1.0);
}
`,
  };
}

/**
 * One pass of a separable Gaussian blur on a coverage map (with default outside).
 * Used for feathering selections and masks.
 */
export function coverageBlurProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COVERAGE_FN}
uniform sampler2D u_src;
uniform vec4 u_srcRect;
uniform float u_srcDefault;
uniform int u_srcChannel;
uniform vec2 u_outOrigin;
uniform vec2 u_dir;
uniform float u_sigma;
uniform int u_radius;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = u_outOrigin + v_px;
  float sum = 0.0;
  float wsum = 0.0;
  float k = -0.5 / (u_sigma * u_sigma);
  for (int i = -512; i <= 512; i++) {
    if (i < -u_radius) continue;
    if (i > u_radius) break;
    float w = exp(float(i * i) * k);
    sum += w * coverage(u_src, u_srcRect, u_srcDefault, u_srcChannel, doc + u_dir * float(i));
    wsum += w;
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`,
  };
}
