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
in vec2 v_screen;
out vec4 o;
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
