import { curvesLut, levelsLut } from '../adjustments/curves';
import { brightnessGamma, contrastExponent, whiteBalanceGains } from '../adjustments/math';
import { ADJUSTMENTS, gaussianReach } from '../adjustments/registry';
import { adjustmentProgram, gaussianPassProgram } from '../adjustments/shaders';
import type { Adjustment, CurvesAdjustment, LevelsAdjustment } from '../adjustments/types';
import type { AdjustmentLayer, Layer } from '../doc/types';
import type { Rect } from '../geometry';
import type { GPU } from '../gl/gpu';
import type { Program } from '../gl/program';
import type { RenderTarget } from '../gl/renderTarget';
import { mixProgram } from './shaders/layer';

/** Region accumulator shared with the compositor (see Compositor.Accum). */
export interface AdjustmentAccum {
  rt: RenderTarget;
  region: Rect;
}

/** Texture units: 1 backdrop, 2 mask (bound by the caller), 3 auxiliary image, 4 LUT. */
const UNIT_BACKDROP = 1;
const UNIT_AUX = 3;
const UNIT_LUT = 4;

const MAX_CACHED_LUTS = 32;

/** Total neighbourhood reach (px) of the visible filters in a layer stack. */
export function stackMargin(layers: readonly Layer[]): number {
  let margin = 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layer.type === 'group') margin += stackMargin(layer.children);
    else if (layer.type === 'adjustment' && layer.opacity > 0) {
      const info = ADJUSTMENTS[layer.adjustment.kind];
      if (!info.isIdentity(layer.adjustment)) margin += info.margin(layer.adjustment);
    }
  }
  return margin;
}

/**
 * Renders adjustment layers: each one replaces the accumulator (everything below it in
 * its group) with an adjusted copy. Point operations run in one pass; filters first
 * build an auxiliary blurred image of the accumulator. Levels and Curves sample a
 * 256-entry LUT texture built on the CPU (cached per parameter object).
 */
export class AdjustmentRenderer {
  private readonly luts = new Map<Adjustment, { texture: WebGLTexture; used: number }>();
  private tick = 0;

  constructor(private readonly gpu: GPU) {}

  /**
   * Applies `layer` to `acc`, swapping `acc.rt` for the result. `bindMask` binds the
   * layer mask to unit 2 for the given program.
   */
  apply(layer: AdjustmentLayer, acc: AdjustmentAccum, bindMask: (program: Program) => void): void {
    const adj = layer.adjustment;
    if (layer.opacity <= 0 || ADJUSTMENTS[adj.kind].isIdentity(adj)) return;
    const gpu = this.gpu;
    const mode = layer.blendMode === 'passThrough' ? 'normal' : layer.blendMode;
    const full = { x: 0, y: 0, width: acc.region.width, height: acc.region.height };

    let aux: RenderTarget | null = null;
    if (adj.kind === 'gaussianBlur' || adj.kind === 'sharpen' || adj.kind === 'shadowsHighlights') {
      aux = this.blurred(acc, adj.radius);
    }
    const out = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);

    if (adj.kind === 'gaussianBlur' && mode === 'normal' && aux) {
      // A plain blur also blurs coverage, so edges of cut-outs soften into transparency.
      const program = gpu.program('mix', mixProgram).use();
      gpu.bindTexture(0, acc.rt.texture);
      gpu.bindTexture(UNIT_BACKDROP, aux.texture);
      program.int('u_a', 0).int('u_b', UNIT_BACKDROP).vec2('u_regionOrigin', acc.region.x, acc.region.y).float('u_opacity', layer.opacity);
      bindMask(program);
      gpu.noBlend();
      gpu.drawRect(program, out, full);
    } else {
      const program = gpu.program(`adjust:${adj.kind}:${mode}`, () => adjustmentProgram(adj.kind, mode)).use();
      gpu.bindTexture(0, null);
      gpu.bindTexture(UNIT_BACKDROP, acc.rt.texture);
      gpu.bindTexture(UNIT_AUX, aux ? aux.texture : gpu.dummyRGBA);
      if (adj.kind === 'levels' || adj.kind === 'curves') {
        gpu.bindTexture(UNIT_LUT, this.lutFor(adj), gpu.samplers.linear);
      } else {
        gpu.bindTexture(UNIT_LUT, gpu.dummyRGBA);
      }
      program
        .int('u_backdrop', UNIT_BACKDROP)
        .int('u_aux', UNIT_AUX)
        .int('u_lut', UNIT_LUT)
        .vec2('u_regionOrigin', acc.region.x, acc.region.y)
        .float('u_opacity', layer.opacity);
      setAdjustmentUniforms(program, adj);
      bindMask(program);
      gpu.noBlend();
      gpu.drawRect(program, out, full);
      gpu.bindTexture(UNIT_AUX, null);
      gpu.bindTexture(UNIT_LUT, null);
    }
    gpu.bindTexture(0, null);
    gpu.bindTexture(UNIT_BACKDROP, null);
    if (aux) gpu.pool.release(aux);
    gpu.pool.release(acc.rt);
    acc.rt = out;
  }

  /**
   * Separable Gaussian blur (σ = `sigma` px) of the accumulator's region. Samples
   * beyond the region repeat its edge pixels, so callers render with enough margin
   * (see stackMargin) that tile borders never show.
   */
  private blurred(acc: AdjustmentAccum, sigma: number): RenderTarget {
    const gpu = this.gpu;
    const { width, height } = acc.region;
    const full = { x: 0, y: 0, width, height };
    const tmp = gpu.pool.acquire(width, height, acc.rt.format);
    const out = gpu.pool.acquire(width, height, acc.rt.format);
    const program = gpu.program('gaussianPass', gaussianPassProgram).use();
    const reach = Math.min(2048, gaussianReach(sigma));
    program.int('u_src', 0).vec2('u_regionSize', width, height).float('u_sigma', Math.max(sigma, 1e-3)).int('u_reach', reach);
    gpu.noBlend();

    gpu.bindTexture(0, acc.rt.texture, gpu.samplers.linear);
    program.vec2('u_texSize', acc.rt.width, acc.rt.height).vec2('u_dir', 1, 0);
    gpu.drawRect(program, tmp, full);

    gpu.bindTexture(0, tmp.texture, gpu.samplers.linear);
    program.vec2('u_texSize', tmp.width, tmp.height).vec2('u_dir', 0, 1);
    gpu.drawRect(program, out, full);

    gpu.bindTexture(0, null);
    gpu.pool.release(tmp);
    return out;
  }

  private lutFor(adj: LevelsAdjustment | CurvesAdjustment): WebGLTexture {
    const cached = this.luts.get(adj);
    if (cached) {
      cached.used = ++this.tick;
      return cached.texture;
    }
    const gl = this.gpu.gl;
    const data = adj.kind === 'levels' ? levelsLut(adj) : curvesLut(adj);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to allocate LUT texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 256, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.luts.set(adj, { texture, used: ++this.tick });
    if (this.luts.size > MAX_CACHED_LUTS) {
      // Evict the least recently used table (parameters from older edits).
      let oldest: Adjustment | null = null;
      let oldestUse = Infinity;
      for (const [key, entry] of this.luts) {
        if (entry.used < oldestUse) {
          oldestUse = entry.used;
          oldest = key;
        }
      }
      if (oldest && oldest !== adj) {
        gl.deleteTexture(this.luts.get(oldest)!.texture);
        this.luts.delete(oldest);
      }
    }
    return texture;
  }

  dispose(): void {
    for (const entry of this.luts.values()) this.gpu.gl.deleteTexture(entry.texture);
    this.luts.clear();
  }
}

/** Uniform values for each adjustment kind (see adjustments/math.ts for the formulas). */
function setAdjustmentUniforms(program: Program, adj: Adjustment): void {
  switch (adj.kind) {
    case 'brightnessContrast':
      program.float('u_gamma', brightnessGamma(adj.brightness)).float('u_contrast', contrastExponent(adj.contrast));
      break;
    case 'exposure':
      program
        .float('u_mult', Math.pow(2, adj.exposure))
        .float('u_offset', adj.offset)
        .float('u_invGamma', 1 / Math.max(0.01, adj.gamma));
      break;
    case 'hueSaturation':
      program
        .float('u_hue', adj.hue / 360)
        .float('u_sat', adj.saturation / 100)
        .float('u_light', adj.lightness / 100)
        .int('u_colorize', adj.colorize ? 1 : 0);
      break;
    case 'vibrance':
      program.float('u_vib', adj.vibrance / 100).float('u_sat', adj.saturation / 100);
      break;
    case 'whiteBalance': {
      const g = whiteBalanceGains(adj.temperature, adj.tint);
      program.vec3('u_gain', g[0], g[1], g[2]);
      break;
    }
    case 'blackWhite':
      program.floats('u_w', [adj.reds, adj.yellows, adj.greens, adj.cyans, adj.blues, adj.magentas].map((v) => v / 100));
      break;
    case 'shadowsHighlights':
      program.float('u_shadows', adj.shadows / 100).float('u_highlights', adj.highlights / 100);
      break;
    case 'sharpen':
      program.float('u_amount', adj.amount / 100).float('u_threshold', adj.threshold);
      break;
    case 'levels':
    case 'curves':
    case 'gaussianBlur':
      break;
  }
}
