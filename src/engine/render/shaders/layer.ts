import type { BlendMode } from '../../doc/types';
import { BLEND_FUNCTIONS, blendExpression } from './blend';
import { COLOR_HELPERS, FRAGMENT_HEADER, REGION_VERTEX } from './common';

/**
 * Draws a source (layer surface or group result) with fixed-function premultiplied
 * "over" blending: out = src · opacity · mask. Used for Normal and Dissolve.
 */
export function layerOverProgram(dissolve: boolean): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
uniform sampler2D u_src;
uniform vec2 u_srcOrigin;     // document position of source texel (0,0)
uniform vec2 u_regionOrigin;  // document position of target pixel (0,0)
uniform float u_opacity;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = v_px + u_regionOrigin;
  vec4 s = texelFetch(u_src, ivec2(doc - u_srcOrigin), 0);
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
 */
export function layerBlendProgram(mode: BlendMode): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${COLOR_HELPERS}
${BLEND_FUNCTIONS}
uniform sampler2D u_src;
uniform sampler2D u_backdrop; // region-local accumulator
uniform vec2 u_srcOrigin;
uniform vec2 u_regionOrigin;
uniform float u_opacity;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 doc = v_px + u_regionOrigin;
  vec4 s = texelFetch(u_src, ivec2(doc - u_srcOrigin), 0) * (u_opacity * sampleMask(doc));
  vec4 b = texelFetch(u_backdrop, ivec2(v_px), 0);
  vec3 Cs = unpremultiply(s);
  vec3 Cb = unpremultiply(b);
  vec3 B = clamp(${blendExpression(mode)}, 0.0, 1.0);
  vec3 co = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * B;
  float ao = s.a + b.a * (1.0 - s.a);
  o = vec4(co, ao);
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
