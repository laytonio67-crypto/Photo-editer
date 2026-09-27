/**
 * Shared GLSL snippets.
 *
 * Conventions:
 *  - Offscreen targets use "texel row = document row": pixel (x, y) of a region target
 *    covers document pixel (regionX + x, regionY + y), with y growing downwards.
 *  - Colour textures hold premultiplied alpha.
 *  - `v_px` is the target pixel coordinate of the fragment (centres at .5).
 */

export const REGION_VERTEX = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_unit;
uniform vec4 u_dst;        // destination rect in target pixels (x, y, w, h)
uniform vec2 u_targetSize; // size of the bound framebuffer in pixels
out vec2 v_px;
void main() {
  vec2 p = u_dst.xy + a_unit * u_dst.zw;
  v_px = p;
  gl_Position = vec4(p / u_targetSize * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Helpers for un/premultiplying and sampling masks with a default outside value. */
export const COLOR_HELPERS = /* glsl */ `
vec3 unpremultiply(vec4 c) {
  return c.a > 0.0 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0);
}

// Samples a single-channel mask placed at u_maskRect.xy (document space) with size
// u_maskRect.zw. Outside that rect the mask has value u_maskDefault.
uniform sampler2D u_mask;
uniform vec4 u_maskRect;       // mask placement (x, y) and size (w, h)
uniform float u_maskDefault;
uniform int u_hasMask;
uniform int u_maskTransformed; // 1: u_maskInv maps document px → mask px (live previews)
uniform mat3 u_maskInv;
float sampleMask(vec2 docPx) {
  if (u_hasMask == 0) return 1.0;
  vec2 local = u_maskTransformed == 1 ? (u_maskInv * vec3(docPx, 1.0)).xy : docPx - u_maskRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= u_maskRect.z || local.y >= u_maskRect.w) {
    return u_maskDefault;
  }
  return texelFetch(u_mask, ivec2(local), 0).r;
}

// Deterministic per-pixel hash in [0,1) used by Dissolve.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
