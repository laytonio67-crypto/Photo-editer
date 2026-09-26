import { FRAGMENT_HEADER, REGION_VERTEX } from '../render/shaders/common';

/**
 * Instanced round brush dabs rendered into a stroke coverage buffer.
 * Per instance: (x, y, radius, alpha) in target pixel coordinates.
 * Coverage accumulates with "over" (ONE, ONE_MINUS_SRC_ALPHA), which gives the
 * familiar flow build-up; the stroke's opacity cap is applied later.
 */
export function dabProgram(): { vertex: string; fragment: string } {
  return {
    vertex: `#version 300 es
layout(location = 0) in vec2 a_unit;
layout(location = 1) in vec4 a_dab;
uniform vec2 u_targetSize;
out vec2 v_offset;
flat out float v_radius;
flat out float v_alpha;
void main() {
  float extent = a_dab.z + 1.5;
  vec2 p = a_dab.xy + (a_unit * 2.0 - 1.0) * extent;
  v_offset = p - a_dab.xy;
  v_radius = a_dab.z;
  v_alpha = a_dab.w;
  gl_Position = vec4(p / u_targetSize * 2.0 - 1.0, 0.0, 1.0);
}
`,
    fragment: `${FRAGMENT_HEADER}
uniform float u_hardness;
in vec2 v_offset;
flat in float v_radius;
flat in float v_alpha;
out vec4 o;

// Tip profile: flat core up to hardness·R, smooth falloff to R, plus a one-pixel
// anti-aliased rim so hard brushes have clean edges.
float tip(float d, float r) {
  float inner = u_hardness * r;
  float t = clamp((d - inner) / max(r - inner, 1e-3), 0.0, 1.0);
  float soft = 1.0 - t * t * (3.0 - 2.0 * t);
  float rim = clamp(r - d + 0.5, 0.0, 1.0);
  return min(soft, rim);
}

void main() {
  float r = max(v_radius, 0.05);
  float c;
  if (r < 2.0) {
    // Tiny brushes: 4×4 supersampling so sub-pixel dabs keep their area.
    c = 0.0;
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec2 s = v_offset + (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
        c += tip(length(s), r);
      }
    }
    c /= 16.0;
  } else {
    c = tip(length(v_offset), r);
  }
  float a = c * v_alpha;
  if (a <= 0.0) discard;
  o = vec4(a, a, a, a);
}
`,
  };
}

/**
 * Applies paint to a region of a target surface.
 *   old      — previous pixels (sampled from `u_old` at v_px + u_oldOffset)
 *   coverage — stroke coverage (optional) × opacity × selection (optional)
 * Ops: 0 paint colour, 1 erase, 2 paint from a source texture (clone), 3 mask grey.
 * Output is premultiplied RGBA (or R in .r for mask targets).
 */
export function paintCompositeProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_old;
uniform vec2 u_oldOffset;
uniform vec2 u_docOffset;      // document position of target pixel (0,0)

uniform int u_hasStroke;
uniform sampler2D u_stroke;
uniform vec2 u_strokeOffset;

uniform int u_hasSel;
uniform sampler2D u_sel;
uniform vec4 u_selRect;
uniform float u_selDefault;

uniform int u_op;
uniform float u_opacity;
uniform vec3 u_color;          // straight RGB; for masks .r is the grey value
uniform int u_preserveAlpha;

uniform sampler2D u_source;    // clone source (premultiplied)
uniform vec4 u_sourceRect;     // document placement (x, y, w, h)
uniform vec2 u_sourceDelta;    // document offset from destination to source

in vec2 v_px;
out vec4 o;

float selection(vec2 doc) {
  if (u_hasSel == 0) return 1.0;
  vec2 local = floor(doc) - u_selRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= u_selRect.z || local.y >= u_selRect.w) return u_selDefault;
  return texelFetch(u_sel, ivec2(local), 0).r;
}

vec4 sourceAt(vec2 doc) {
  vec2 local = floor(doc + u_sourceDelta) - u_sourceRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= u_sourceRect.z || local.y >= u_sourceRect.w) return vec4(0.0);
  return texelFetch(u_source, ivec2(local), 0);
}

void main() {
  vec4 old = texelFetch(u_old, ivec2(v_px + u_oldOffset), 0);
  vec2 doc = v_px + u_docOffset;
  float stroke = u_hasStroke == 1 ? texelFetch(u_stroke, ivec2(v_px + u_strokeOffset), 0).r : 1.0;
  float a = clamp(stroke, 0.0, 1.0) * u_opacity * selection(doc);
  if (u_op == 3) {
    o = vec4(mix(old.r, u_color.r, a), 0.0, 0.0, 1.0);
    return;
  }
  if (u_op == 1) {
    o = old * (1.0 - a);
    return;
  }
  vec4 src = u_op == 2 ? sourceAt(doc) : vec4(u_color, 1.0);
  float sa = src.a * a;
  if (u_preserveAlpha == 1) {
    // Paint only where pixels already exist, keeping their alpha.
    vec3 straight = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
    o = vec4(mix(old.rgb, straight * old.a, sa), old.a);
  } else {
    o = src * a + old * (1.0 - sa);
  }
}
`,
  };
}
