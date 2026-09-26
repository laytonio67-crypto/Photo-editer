import { FRAGMENT_HEADER, REGION_VERTEX } from './common';

/**
 * Area-averaging downsampler. Each output pixel covers `u_scale` document pixels; it
 * averages a taps×taps grid of bilinear samples across that footprint. Sources are
 * positioned in document space; anything outside the source is transparent.
 */
export function downsampleProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform vec2 u_srcSize;    // texture size in texels
uniform vec2 u_srcOrigin;  // document position of texel (0,0)
uniform vec2 u_docOrigin;  // document position of output pixel (0,0)'s top-left corner
uniform vec2 u_scale;      // document pixels per output pixel
uniform int u_taps;
uniform vec4 u_outside;    // value used for samples outside the source
in vec2 v_px;
out vec4 o;
void main() {
  vec2 footprint = u_docOrigin + floor(v_px) * u_scale;
  vec4 sum = vec4(0.0);
  float n = float(u_taps);
  for (int j = 0; j < 16; j++) {
    if (j >= u_taps) break;
    for (int i = 0; i < 16; i++) {
      if (i >= u_taps) break;
      vec2 d = footprint + (vec2(float(i), float(j)) + 0.5) / n * u_scale;
      vec2 t = (d - u_srcOrigin) / u_srcSize;
      if (t.x >= 0.0 && t.y >= 0.0 && t.x <= 1.0 && t.y <= 1.0) {
        sum += texture(u_src, t);
      } else {
        sum += u_outside;
      }
    }
  }
  o = sum / (n * n);
}
`,
  };
}
