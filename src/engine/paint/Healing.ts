import type { Point, Rect } from '../geometry';
import type { GPU } from '../gl/gpu';
import type { Program } from '../gl/program';
import type { RenderTarget } from '../gl/renderTarget';
import { FRAGMENT_HEADER, REGION_VERTEX } from '../render/shaders/common';
import type { Coverage } from '../selection/SelectionOps';

/**
 * Healing brush solve.
 *
 * Cloned pixels `src` are corrected by a smooth membrane `m` so they match their new
 * surroundings: inside the stroke (weight w > 0) m solves Laplace's equation Δm = 0,
 * and on the stroke's border m equals the difference `dst − src` there. The result
 * `src + m` keeps the source's texture while taking on the destination's colour and
 * shading (a seamless clone in the sense of Pérez et al., "Poisson Image Editing").
 *
 * The solve runs on the GPU: known values are averaged into a pyramid, the coarsest
 * level is relaxed first, and each finer level starts from the upsampled coarser
 * solution and is refined with red-black successive over-relaxation.
 */

export interface HealParams {
  /** Receives the healed pixels (the stroke preview, target-sized). */
  out: RenderTarget;
  /** Destination pixels before the stroke (the layer surface). */
  oldTexture: WebGLTexture;
  /** Region to solve, in target pixels; its border must lie outside the stroke. */
  region: Rect;
  /** Document position of target pixel (0, 0). */
  docOffset: Point;
  /** Stroke coverage (target-sized, .r). */
  stroke: WebGLTexture;
  opacity: number;
  selection: Coverage | null;
  source: { texture: WebGLTexture; rect: Rect; delta: Point };
  preserveAlpha: boolean;
}

const INPUTS = /* glsl */ `
uniform sampler2D u_old;
uniform vec2 u_docOffset;
uniform sampler2D u_stroke;
uniform float u_opacity;
uniform int u_hasSel;
uniform sampler2D u_sel;
uniform vec4 u_selRect;
uniform float u_selDefault;
uniform sampler2D u_source;
uniform vec4 u_sourceRect;
uniform vec2 u_sourceDelta;

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

// Painting weight of a target pixel: coverage × opacity × selection.
float weight(vec2 tp) {
  float stroke = texelFetch(u_stroke, ivec2(tp), 0).r;
  return clamp(stroke, 0.0, 1.0) * u_opacity * selection(tp + u_docOffset);
}
`;

/** Level 0 boundary data: (dst − src) where the pixel is outside the stroke. */
function initProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${INPUTS}
uniform vec2 u_regionOrigin;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 tp = v_px + u_regionOrigin;
  vec4 old = texelFetch(u_old, ivec2(tp), 0);
  vec4 src = sourceAt(tp + u_docOffset);
  float known = weight(tp) <= 0.0 ? 1.0 : 0.0;
  // rgb: known value (0 when unknown), a: fraction of the pixel that is known.
  o = vec4((old.rgb - src.rgb) * known, known);
}
`,
  };
}

/** Halves a level: known values are averaged, weighted by how much of each is known. */
function downsampleProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform vec2 u_srcSize;
in vec2 v_px;
out vec4 o;
void main() {
  ivec2 base = ivec2(floor(v_px)) * 2;
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 c = base + ivec2(i, j);
      if (c.x >= int(u_srcSize.x) || c.y >= int(u_srcSize.y)) continue;
      vec4 t = texelFetch(u_src, c, 0);
      sum += t.rgb * t.a;
      w += t.a;
    }
  }
  o = w > 0.0 ? vec4(sum / w, w * 0.25) : vec4(0.0);
}
`,
  };
}

/** Starting guess of a level: known values fixed (a = 1), unknowns from the coarser level. */
function seedProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_known;
uniform sampler2D u_coarse;
uniform vec2 u_coarseTexSize;
uniform vec2 u_coarseSize;
uniform int u_hasCoarse;
in vec2 v_px;
out vec4 o;
void main() {
  vec4 k = texelFetch(u_known, ivec2(floor(v_px)), 0);
  if (k.a > 0.0) {
    o = vec4(k.rgb, 1.0);
    return;
  }
  vec3 m = vec3(0.0);
  if (u_hasCoarse == 1) {
    vec2 p = clamp(v_px * 0.5, vec2(0.5), u_coarseSize - 0.5);
    m = texture(u_coarse, p / u_coarseTexSize).rgb;
  }
  o = vec4(m, 0.0);
}
`,
  };
}

/** One colour of a red-black SOR sweep: unknown pixels move towards their neighbours' mean. */
function relaxProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_m;
uniform vec2 u_size;
uniform int u_parity;
uniform float u_omega;
in vec2 v_px;
out vec4 o;
void main() {
  ivec2 p = ivec2(floor(v_px));
  vec4 c = texelFetch(u_m, p, 0);
  if (c.a > 0.5 || ((p.x + p.y) & 1) != u_parity) {
    o = c;
    return;
  }
  ivec2 hi = ivec2(u_size) - 1;
  vec3 n = texelFetch(u_m, clamp(p + ivec2(1, 0), ivec2(0), hi), 0).rgb
         + texelFetch(u_m, clamp(p - ivec2(1, 0), ivec2(0), hi), 0).rgb
         + texelFetch(u_m, clamp(p + ivec2(0, 1), ivec2(0), hi), 0).rgb
         + texelFetch(u_m, clamp(p - ivec2(0, 1), ivec2(0), hi), 0).rgb;
  o = vec4(mix(c.rgb, n * 0.25, u_omega), 0.0);
}
`,
  };
}

/** Writes src + membrane into the stroke, blended by the painting weight. */
function applyProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
${INPUTS}
uniform sampler2D u_m;
uniform vec2 u_regionOrigin;
uniform int u_preserveAlpha;
in vec2 v_px;
out vec4 o;
void main() {
  vec4 old = texelFetch(u_old, ivec2(v_px), 0);
  float w = weight(v_px);
  if (w <= 0.0) {
    o = old;
    return;
  }
  vec4 src = sourceAt(v_px + u_docOffset);
  vec3 m = texelFetch(u_m, ivec2(v_px - u_regionOrigin), 0).rgb;
  vec4 healed = vec4(clamp(src.rgb + m, vec3(0.0), vec3(src.a)), src.a);
  if (u_preserveAlpha == 1) {
    vec3 straight = healed.a > 0.0 ? healed.rgb / healed.a : vec3(0.0);
    o = vec4(mix(old.rgb, straight * old.a, healed.a * w), old.a);
  } else {
    o = healed * w + old * (1.0 - healed.a * w);
  }
}
`,
  };
}

const UNIT_OLD = 0;
const UNIT_STROKE = 1;
const UNIT_SEL = 2;
const UNIT_SOURCE = 3;
const UNIT_AUX = 4;

function bindInputs(gpu: GPU, program: Program, p: HealParams): void {
  gpu.bindTexture(UNIT_OLD, p.oldTexture);
  gpu.bindTexture(UNIT_STROKE, p.stroke);
  gpu.bindTexture(UNIT_SEL, p.selection?.texture ?? gpu.dummyR8);
  gpu.bindTexture(UNIT_SOURCE, p.source.texture);
  program
    .int('u_old', UNIT_OLD)
    .vec2('u_docOffset', p.docOffset.x, p.docOffset.y)
    .int('u_stroke', UNIT_STROKE)
    .float('u_opacity', p.opacity)
    .int('u_sel', UNIT_SEL)
    .int('u_hasSel', p.selection ? 1 : 0)
    .vec4('u_selRect', p.selection?.x ?? 0, p.selection?.y ?? 0, p.selection?.width ?? 0, p.selection?.height ?? 0)
    .float('u_selDefault', p.selection?.defaultValue ?? 0)
    .int('u_source', UNIT_SOURCE)
    .vec4('u_sourceRect', p.source.rect.x, p.source.rect.y, p.source.rect.width, p.source.rect.height)
    .vec2('u_sourceDelta', p.source.delta.x, p.source.delta.y);
}

interface Level {
  known: RenderTarget;
  width: number;
  height: number;
}

/** Relaxation sweeps per level: many on tiny coarse grids, fewer on the large fine ones. */
function sweepsFor(level: number, coarsest: boolean): number {
  if (coarsest) return 80;
  return level === 0 ? 24 : 32;
}

/**
 * Heals `p.region` of the stroke into `p.out`. Requires half-float render targets
 * (negative differences and fractional weights).
 */
export function healRegion(gpu: GPU, p: HealParams): void {
  const { width, height } = p.region;
  if (width <= 0 || height <= 0) return;
  const pool = gpu.pool;
  gpu.noBlend();

  // Pyramid of known values.
  const levels: Level[] = [];
  const first = pool.acquire(width, height, 'rgba16f');
  const init = gpu.program('healInit', initProgram).use();
  bindInputs(gpu, init, p);
  init.vec2('u_regionOrigin', p.region.x, p.region.y);
  gpu.drawRect(init, first, { x: 0, y: 0, width, height });
  levels.push({ known: first, width, height });
  const down = gpu.program('healDown', downsampleProgram);
  while (true) {
    const prev = levels[levels.length - 1]!;
    if (prev.width <= 2 && prev.height <= 2) break;
    const w = Math.ceil(prev.width / 2);
    const h = Math.ceil(prev.height / 2);
    const t = pool.acquire(w, h, 'rgba16f');
    down.use();
    gpu.bindTexture(UNIT_AUX, prev.known.texture);
    down.int('u_src', UNIT_AUX).vec2('u_srcSize', prev.width, prev.height);
    gpu.drawRect(down, t, { x: 0, y: 0, width: w, height: h });
    levels.push({ known: t, width: w, height: h });
  }

  // Coarse-to-fine solve.
  const seed = gpu.program('healSeed', seedProgram);
  const relax = gpu.program('healRelax', relaxProgram);
  let coarse: { target: RenderTarget; width: number; height: number } | null = null;
  for (let l = levels.length - 1; l >= 0; l--) {
    const level = levels[l]!;
    const full = { x: 0, y: 0, width: level.width, height: level.height };
    let a = pool.acquire(level.width, level.height, 'rgba16f');
    let b = pool.acquire(level.width, level.height, 'rgba16f');
    seed.use();
    gpu.bindTexture(UNIT_AUX, level.known.texture);
    gpu.bindTexture(UNIT_AUX + 1, coarse ? coarse.target.texture : gpu.dummyRGBA, gpu.samplers.linear);
    seed
      .int('u_known', UNIT_AUX)
      .int('u_coarse', UNIT_AUX + 1)
      .int('u_hasCoarse', coarse ? 1 : 0)
      .vec2('u_coarseTexSize', coarse?.target.width ?? 1, coarse?.target.height ?? 1)
      .vec2('u_coarseSize', coarse?.width ?? 1, coarse?.height ?? 1);
    gpu.drawRect(seed, a, full);
    gpu.bindTexture(UNIT_AUX + 1, null);
    if (coarse) pool.release(coarse.target);

    // Over-relaxation speeds up convergence on larger grids.
    const omega = level.width * level.height > 64 ? 1.8 : 1.4;
    relax.use();
    relax.int('u_m', UNIT_AUX).vec2('u_size', level.width, level.height).float('u_omega', omega);
    const sweeps = sweepsFor(l, l === levels.length - 1);
    for (let i = 0; i < sweeps * 2; i++) {
      gpu.bindTexture(UNIT_AUX, a.texture);
      relax.int('u_parity', i & 1);
      gpu.drawRect(relax, b, full);
      [a, b] = [b, a];
    }
    gpu.bindTexture(UNIT_AUX, null);
    pool.release(b);
    coarse = { target: a, width: level.width, height: level.height };
  }
  for (const level of levels) pool.release(level.known);

  // Composite the healed clone into the preview.
  const apply = gpu.program('healApply', applyProgram).use();
  bindInputs(gpu, apply, p);
  gpu.bindTexture(UNIT_AUX, coarse!.target.texture);
  apply.int('u_m', UNIT_AUX).vec2('u_regionOrigin', p.region.x, p.region.y).int('u_preserveAlpha', p.preserveAlpha ? 1 : 0);
  gpu.drawRect(apply, p.out, p.region);
  for (const unit of [UNIT_OLD, UNIT_STROKE, UNIT_SEL, UNIT_SOURCE, UNIT_AUX]) gpu.bindTexture(unit, null);
  pool.release(coarse!.target);
}
