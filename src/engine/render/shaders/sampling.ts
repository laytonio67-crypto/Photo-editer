/**
 * Source sampling shared by layer drawing and resampling.
 *
 * Exact path: integer placement, texelFetch — pixel-perfect.
 * Transformed path: inverse affine (doc → source pixel coords) with manual bilinear
 * filtering where texels outside the source read as `u_outside`, which yields
 * naturally anti-aliased edges for rotated/scaled layers.
 */
export const SAMPLING_HELPERS = /* glsl */ `
uniform sampler2D u_src;
uniform vec2 u_srcSize;      // texels
uniform vec4 u_outside;      // value of texels outside the source
uniform mat3 u_inv;          // document px → source px (column-major)
uniform vec2 u_srcOrigin;    // exact path: document position of texel (0,0)

vec4 srcTexel(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= int(u_srcSize.x) || p.y >= int(u_srcSize.y)) return u_outside;
  return texelFetch(u_src, p, 0);
}

// Bilinear with texel centres at .5 (premultiplied data filters correctly).
vec4 srcBilinear(vec2 local) {
  vec2 p = local - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  vec4 a = srcTexel(i);
  vec4 b = srcTexel(i + ivec2(1, 0));
  vec4 c = srcTexel(i + ivec2(0, 1));
  vec4 d = srcTexel(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Catmull-Rom weights for bicubic interpolation.
vec4 cubicWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2
  );
}

vec4 srcBicubic(vec2 local) {
  vec2 p = local - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p)) - ivec2(1);
  vec4 wx = cubicWeights(f.x);
  vec4 wy = cubicWeights(f.y);
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    vec4 row = srcTexel(i + ivec2(0, y)) * wx.x + srcTexel(i + ivec2(1, y)) * wx.y +
               srcTexel(i + ivec2(2, y)) * wx.z + srcTexel(i + ivec2(3, y)) * wx.w;
    sum += row * wy[y];
  }
  // Catmull-Rom overshoots: keep premultiplied colour within [0, alpha].
  sum.a = clamp(sum.a, 0.0, 1.0);
  sum.rgb = clamp(sum.rgb, vec3(0.0), vec3(max(sum.a, u_outside.a > 0.0 ? 1.0 : sum.a)));
  return sum;
}

vec2 toSource(vec2 doc) {
  return (u_inv * vec3(doc, 1.0)).xy;
}
`;
