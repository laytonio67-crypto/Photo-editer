import type { BlendMode } from '../../doc/types';
import { BLEND_FUNCTIONS, blendExpression } from './blend';
import { COLOR_HELPERS, FRAGMENT_HEADER, REGION_VERTEX } from './common';
import { SAMPLING_HELPERS } from './sampling';

/** Source lookup: exact integer placement, or inverse-affine bilinear for previews. */
function sourceFunction(transformed: boolean): string {
  return transformed
    ? 'vec4 sampleSource(vec2 doc) { return srcBilinear(toSource(doc)); }'
    : 'vec4 sampleSource(vec2 doc) { return texelFetch(u_src, ivec2(doc - u_srcOrigin), 0); }';
}

/**
 * Draws a source (layer surface or group result) with fixed-function premultiplied
 * "over" blending: out = src · opacity · mask. Used for Normal and Dissolve.
 */
export function layerOverProgram(dissolve: boolean, transformed: boolean): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
${SAMPLING_HELPERS}
${sourceFunction(transformed)}
uniform vec2 u_regionOrigin;  // document position of target pixel (0,0)
uniform float u_opacity;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = v_px + u_regionOrigin;
  vec4 s = sampleSource(doc);
  float k = u_opacity * sampleMask(doc);
  ${
    dissolve
      ? `// Dissolve: each pixel is either fully the source colour or untouched.
  float a = s.a * k;
  o = hash12(floor(doc)) < a ? vec4(unpremultiply(s), 1.0) : vec4(0.0);`
      : 'o = s * k;'
  }
}
`,
  };
}

/**
 * Draws a source blended onto a backdrop with an arbitrary blend mode. Renders into a
 * scratch target while reading the accumulator as backdrop (ping-pong), because a
 * shader cannot read the framebuffer it writes.
 *
 * With `atop` (clipping masks) the source only lands where the backdrop has coverage
 * and the backdrop's alpha is kept: Porter–Duff source-atop with blending.
 */
export function layerBlendProgram(mode: BlendMode, transformed: boolean, atop = false): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
${BLEND_FUNCTIONS}
${SAMPLING_HELPERS}
${sourceFunction(transformed)}
uniform sampler2D u_backdrop; // region-local accumulator
uniform vec2 u_regionOrigin;
uniform float u_opacity;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = v_px + u_regionOrigin;
  vec4 s = sampleSource(doc) * (u_opacity * sampleMask(doc));
  vec4 b = texelFetch(u_backdrop, ivec2(v_px), 0);
  vec3 Cs = unpremultiply(s);
  vec3 Cb = unpremultiply(b);
  vec3 B = clamp(${blendExpression(mode)}, 0.0, 1.0);
  ${
    atop
      ? `vec3 co = s.rgb * b.a * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * b.a * B;
  o = vec4(co, b.a);`
      : `vec3 co = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * B;
  float ao = s.a + b.a * (1.0 - s.a);
  o = vec4(co, ao);`
  }
}
`,
  };
}

/** Copies texels with an integer offset: o = src[v_px + offset]. */
export function copyProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform vec2 u_offset;
in vec2 v_px;
out vec4 o;
void main() {
  o = texelFetch(u_src, ivec2(v_px + u_offset), 0);
}
`,
  };
}

/**
 * Pass-through group with opacity/mask: mixes the original backdrop with the
 * backdrop-with-children-composited by opacity · mask.
 */
export function mixProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform vec2 u_regionOrigin;
uniform float u_opacity;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = v_px + u_regionOrigin;
  vec4 a = texelFetch(u_a, ivec2(v_px), 0);
  vec4 b = texelFetch(u_b, ivec2(v_px), 0);
  o = mix(a, b, u_opacity * sampleMask(doc));
}
`,
  };
}

/**
 * High-quality resampling of a source through an affine transform into a new surface.
 * mode 0: nearest, 1: bilinear, 2: bicubic. `u_taps` > 1 supersamples (area filtering
 * for downscaling).
 */
export function resampleProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${SAMPLING_HELPERS}
uniform vec2 u_outOrigin;  // document position of output pixel (0,0)
uniform int u_taps;
uniform int u_mode;
in vec2 v_px;
out vec4 o;
vec4 sampleAt(vec2 doc) {
  vec2 l = toSource(doc);
  if (u_mode == 0) return srcTexel(ivec2(floor(l)));
  if (u_mode == 2) return srcBicubic(l);
  return srcBilinear(l);
}
void main() {
  vec2 doc = u_outOrigin + v_px;
  if (u_taps <= 1) {
    o = sampleAt(doc);
    return;
  }
  vec4 sum = vec4(0.0);
  float n = float(u_taps);
  for (int j = 0; j < 16; j++) {
    if (j >= u_taps) break;
    for (int i = 0; i < 16; i++) {
      if (i >= u_taps) break;
      vec2 d = doc + (vec2(float(i), float(j)) + 0.5) / n - 0.5;
      sum += srcBilinear(toSource(d));
    }
  }
  o = sum / (n * n);
}
`,
  };
}
