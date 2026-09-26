import { FRAGMENT_HEADER } from './common';

/** Screen-space vertex shader: `u_dst` in device pixels, y down; flips to GL clip space. */
export const SCREEN_VERTEX = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_unit;
uniform vec4 u_dst;
uniform vec2 u_canvasSize;
out vec2 v_screen;
void main() {
  vec2 p = u_dst.xy + a_unit * u_dst.zw;
  v_screen = p;
  vec2 clip = p / u_canvasSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

/**
 * Draws the document composite over a screen-space transparency checkerboard.
 * `nearest` variant: exact texel lookup (magnified / 100%); otherwise trilinear
 * mipmapped sampling for minified views.
 */
export function documentDisplayProgram(nearest: boolean): { vertex: string; fragment: string } {
  return {
    vertex: SCREEN_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_image;
uniform vec2 u_docSize;
uniform vec3 u_view;        // zoom, panX, panY (device px)
uniform float u_checkSize;  // device px
uniform vec3 u_checkA;
uniform vec3 u_checkB;
uniform float u_pixelGrid;  // 0 = off, else grid line opacity
// Mask visualisation: 0 off, 1 grayscale mask, 2 red overlay where hidden.
uniform int u_maskView;
uniform sampler2D u_mask;
uniform vec4 u_maskRect;
uniform float u_maskDefault;
in vec2 v_screen;
out vec4 o;
float maskAt(vec2 doc) {
  vec2 local = floor(doc) - u_maskRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= u_maskRect.z || local.y >= u_maskRect.w) return u_maskDefault;
  return texelFetch(u_mask, ivec2(local), 0).r;
}
void main() {
  vec2 doc = (v_screen - u_view.yz) / u_view.x;
  vec2 cell = floor(v_screen / u_checkSize);
  vec3 bg = mod(cell.x + cell.y, 2.0) < 0.5 ? u_checkA : u_checkB;
  ${
    nearest
      ? 'vec4 c = texelFetch(u_image, ivec2(clamp(floor(doc), vec2(0.0), u_docSize - 1.0)), 0);'
      : 'vec4 c = texture(u_image, doc / u_docSize);'
  }
  vec3 rgb = c.rgb + bg * (1.0 - c.a);
  if (u_maskView == 1) {
    rgb = vec3(maskAt(doc));
  } else if (u_maskView == 2) {
    rgb = mix(rgb, vec3(1.0, 0.0, 0.0), 0.5 * (1.0 - maskAt(doc)));
  }
  if (u_pixelGrid > 0.0) {
    // One-device-pixel lines on document pixel boundaries.
    vec2 f = fract(doc) * u_view.x;
    if (f.x < 1.0 || f.y < 1.0) {
      float l = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(rgb, l > 0.5 ? vec3(0.0) : vec3(1.0), u_pixelGrid);
    }
  }
  o = vec4(rgb, 1.0);
}
`,
  };
}

/**
 * Marching ants: draws a dashed black/white line on screen pixels where the selection
 * coverage crosses 50% between neighbouring screen pixels. The dash phase advances
 * with `u_time` to animate.
 */
export function marchingAntsProgram(): { vertex: string; fragment: string } {
  return {
    vertex: SCREEN_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_sel;
uniform vec4 u_selRect;
uniform float u_selDefault;
uniform vec2 u_docSize;
uniform vec3 u_view;
uniform float u_time;
uniform float u_dash;
in vec2 v_screen;
out vec4 o;
float selectedAt(vec2 screen) {
  vec2 doc = floor((screen - u_view.yz) / u_view.x);
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= u_docSize.x || doc.y >= u_docSize.y) return 0.0;
  vec2 local = doc - u_selRect.xy;
  float v = (local.x < 0.0 || local.y < 0.0 || local.x >= u_selRect.z || local.y >= u_selRect.w)
    ? u_selDefault
    : texelFetch(u_sel, ivec2(local), 0).r;
  return step(0.5, v);
}
void main() {
  float c = selectedAt(v_screen);
  if (c < 0.5) discard;
  float n = selectedAt(v_screen + vec2(1.0, 0.0)) * selectedAt(v_screen - vec2(1.0, 0.0)) *
            selectedAt(v_screen + vec2(0.0, 1.0)) * selectedAt(v_screen - vec2(0.0, 1.0));
  if (n > 0.5) discard;
  float phase = mod(floor((v_screen.x + v_screen.y) / u_dash) + u_time, 2.0);
  o = phase < 1.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0, 1.0, 1.0, 1.0);
}
`,
  };
}
