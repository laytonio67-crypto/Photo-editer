import type { DocState, GroupLayer, Layer, LayerMask } from '../doc/types';
import {
  expandRect,
  intersectRects,
  invertAffine,
  isEmptyRect,
  roundOutRect,
  tileRect,
  transformedBounds,
  unionRects,
  type Affine,
  type Rect,
} from '../geometry';
import type { GPU } from '../gl/gpu';
import type { Program } from '../gl/program';
import { RenderTarget } from '../gl/renderTarget';
import { mipLevelCount } from '../gl/texture';
import type { SurfaceStore } from '../surfaces/SurfaceStore';
import { AdjustmentRenderer, stackMargin } from './AdjustmentRenderer';
import { isFixedFunctionBlend } from './shaders/blend';
import { copyProgram, layerBlendProgram, layerOverProgram, mixProgram } from './shaders/layer';

/** A texture positioned in document space that can be drawn like a layer. */
export interface DrawSource {
  texture: WebGLTexture;
  /** Document position of texel (0, 0) (ignored when `transform` is set). */
  x: number;
  y: number;
  /** Extent of valid texels. */
  width: number;
  height: number;
  /** Optional affine mapping source pixel coords → document coords (live transform previews). */
  transform?: Affine;
  /** Optional affine for the layer's mask (mask pixel coords → document coords). */
  maskTransform?: Affine;
}

/** Column-major mat3 for an affine transform. */
export function affineToMat3(m: Affine): Float32Array {
  return new Float32Array([m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1]);
}

/** Sets the source-sampling uniforms (see shaders/sampling.ts) for a draw source. */
export function setSourceUniforms(program: Program, source: DrawSource): void {
  program.int('u_src', 0).vec2('u_srcSize', source.width, source.height).vec4('u_outside', 0, 0, 0, 0);
  if (source.transform) {
    const inv = invertAffine(source.transform);
    if (inv) program.mat3('u_inv', affineToMat3(inv));
  } else {
    program.vec2('u_srcOrigin', source.x, source.y);
  }
}

/** Document-space bounds covered by a draw source. */
export function sourceBounds(source: DrawSource): Rect {
  const local = { x: 0, y: 0, width: source.width, height: source.height };
  if (source.transform) return roundOutRect(transformedBounds(source.transform, local));
  return { x: source.x, y: source.y, width: source.width, height: source.height };
}

/**
 * A region-sized accumulation buffer. `rt` may be larger than the region (pooled
 * targets are bucketed); pixel (0,0) of `rt` corresponds to document (region.x, region.y).
 * Adjustment layers replace `rt` with an adjusted copy, so always read it after
 * compositing into the accumulator.
 */
interface Accum {
  rt: RenderTarget;
  region: Rect;
}

/** Hooks that let tools substitute what gets drawn for a layer (live previews). */
export interface LayerSourceProvider {
  /**
   * Returns a replacement draw source for a layer, null to skip drawing it, or
   * undefined to use the default.
   */
  sourceFor?(layer: Layer): DrawSource | null | undefined;
  /** Replacement texture for a layer's mask (live mask painting). */
  maskFor?(layer: Layer): WebGLTexture | undefined;
}

const TILE_SIZE = 1024;

/**
 * Renders a document's layer tree into a composite texture.
 *
 * Rendering happens per dirty tile: each tile is composited bottom→top into a
 * tile-sized accumulator (RGBA16F when available), then converted into the RGBA8
 * document composite that the view samples. See docs/ARCHITECTURE.md §1.
 */
export class Compositor {
  private composite: RenderTarget | null = null;
  private dirty: Rect | null = null;
  private width = 0;
  private height = 0;
  /** Preview hooks consulted in order (first non-undefined answer wins). */
  readonly providers: LayerSourceProvider[] = [];
  private readonly adjustments: AdjustmentRenderer;

  constructor(
    private readonly gpu: GPU,
    private readonly surfaces: SurfaceStore,
  ) {
    this.adjustments = new AdjustmentRenderer(gpu);
  }

  /** The RGBA8 (premultiplied) document composite with a full mip chain, or null. */
  get texture(): WebGLTexture | null {
    return this.composite?.texture ?? null;
  }

  get compositeTarget(): RenderTarget | null {
    return this.composite;
  }

  /** Marks a document rect (or everything) as needing recomposition. */
  invalidate(rect?: Rect | null): void {
    const full = { x: 0, y: 0, width: this.width, height: this.height };
    const r = rect ? intersectRects(rect, full) : full;
    if (isEmptyRect(r) && rect) return;
    this.dirty = this.dirty ? unionRects(this.dirty, r) : r;
  }

  get isDirty(): boolean {
    return this.dirty !== null && !isEmptyRect(this.dirty);
  }

  /** Recomposites dirty regions. Returns true if the composite changed. */
  update(doc: DocState | null): boolean {
    if (!doc) {
      if (this.composite) {
        this.composite.dispose();
        this.composite = null;
        this.width = this.height = 0;
      }
      this.dirty = null;
      return false;
    }
    if (!this.composite || this.width !== doc.width || this.height !== doc.height) {
      this.composite?.dispose();
      this.width = doc.width;
      this.height = doc.height;
      this.composite = new RenderTarget(
        this.gpu.gl,
        doc.width,
        doc.height,
        'rgba8',
        mipLevelCount(doc.width, doc.height),
      );
      this.dirty = { x: 0, y: 0, width: doc.width, height: doc.height };
    }
    const docRect = { x: 0, y: 0, width: doc.width, height: doc.height };
    let dirty = this.dirty ? intersectRects(this.dirty, docRect) : null;
    this.dirty = null;
    if (!dirty || isEmptyRect(dirty)) return false;
    // Filters (blur, sharpen, …) spread a change to their neighbourhood.
    const margin = stackMargin(doc.layers);
    if (margin > 0) dirty = intersectRects(expandRect(dirty, margin), docRect);

    const gpu = this.gpu;
    const copy = gpu.program('copy', copyProgram).use();
    for (const tile of tileRect(dirty, TILE_SIZE)) {
      const acc = this.renderRegion(doc, tile);
      gpu.noBlend();
      copy.use();
      gpu.bindTexture(0, acc.texture);
      copy.int('u_src', 0).vec2('u_offset', -tile.x, -tile.y);
      gpu.drawRect(copy, this.composite, tile);
      gpu.pool.release(acc);
    }
    const gl = gpu.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.composite.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  /**
   * Composites `layers` over transparency for a document region. Returns a pooled
   * accumulator (region pixel (0,0) at texel (0,0)); release it with gpu.pool.release.
   *
   * Filters need pixels around the region, so with filters in the stack a larger area
   * is rendered (clamped to the canvas, or to `region` where it extends past it) and
   * the requested part is copied out. Results therefore match across tile borders.
   */
  renderRegion(doc: DocState, region: Rect, layers: readonly Layer[] = doc.layers): RenderTarget {
    const margin = stackMargin(layers);
    const bounds = unionRects({ x: 0, y: 0, width: doc.width, height: doc.height }, region);
    const expanded = margin > 0 ? intersectRects(expandRect(region, margin), bounds) : region;
    const acc = this.newAccum(expanded);
    this.compositeLayers(layers, acc);
    if (expanded === region) return acc.rt;
    const out = this.gpu.pool.acquire(region.width, region.height, acc.rt.format);
    const inner = { x: region.x - expanded.x, y: region.y - expanded.y, width: region.width, height: region.height };
    this.gpu.blit(acc.rt, out, inner, 0, 0);
    this.gpu.pool.release(acc.rt);
    return out;
  }

  private newAccum(region: Rect): Accum {
    const rt = this.gpu.pool.acquire(region.width, region.height, this.gpu.accumFormat);
    this.gpu.clear(rt, { x: 0, y: 0, width: region.width, height: region.height });
    return { rt, region };
  }

  /**
   * Composites siblings bottom → top. A run of `clipped` layers forms a clipping group
   * with the layer below it (the base), except when the base is an adjustment layer,
   * which has no content to clip to (the run then renders unclipped).
   */
  private compositeLayers(layers: readonly Layer[], acc: Accum): void {
    let i = 0;
    while (i < layers.length) {
      const base = layers[i]!;
      let end = i + 1;
      while (end < layers.length && layers[end]!.clipped) end++;
      if (end > i + 1 && base.type !== 'adjustment') {
        // A hidden base hides everything clipped to it.
        if (base.visible) this.compositeClipGroup(base, layers.slice(i + 1, end), acc);
      } else {
        for (let k = i; k < end; k++) this.compositeLayer(layers[k]!, acc, false);
      }
      i = end;
    }
  }

  /** Draws one layer. With `atop` it only paints where the accumulator has coverage. */
  private compositeLayer(layer: Layer, acc: Accum, atop: boolean): void {
    if (!layer.visible) return;
    switch (layer.type) {
      case 'pixel': {
        const override = this.overrideFor(layer);
        if (override === null) break;
        const source = override ?? this.pixelSource(layer);
        if (source) this.drawSource(acc, source, layer.opacity, layer.blendMode, layer.mask, this.maskOverrideFor(layer), atop);
        break;
      }
      case 'group':
        this.compositeGroup(layer, acc, atop);
        break;
      case 'text': {
        const source = this.overrideFor(layer);
        if (source) this.drawSource(acc, source, layer.opacity, layer.blendMode, layer.mask, this.maskOverrideFor(layer), atop);
        break;
      }
      case 'adjustment':
        // Adjustments keep coverage, so they behave the same clipped or not.
        this.adjustments.apply(layer, acc, (program) =>
          this.bindMask(program, layer.mask, undefined, this.maskOverrideFor(layer)),
        );
        break;
    }
  }

  /**
   * Clipping group (Photoshop semantics with "blend clipped layers as group"): the base
   * is drawn at full strength into an isolated buffer (its mask shapes the clip), the
   * clipped layers are drawn source-atop, and the result is composited with the base's
   * opacity and blend mode.
   */
  private compositeClipGroup(base: Layer, clipped: readonly Layer[], acc: Accum): void {
    const temp = this.newAccum(acc.region);
    const whole = { x: acc.region.x, y: acc.region.y, width: acc.region.width, height: acc.region.height };
    switch (base.type) {
      case 'pixel':
      case 'text': {
        const override = this.overrideFor(base);
        const source = override === null ? null : (override ?? (base.type === 'pixel' ? this.pixelSource(base) : null));
        if (source) this.drawSource(temp, source, 1, 'normal', base.mask, this.maskOverrideFor(base), false);
        break;
      }
      case 'group': {
        const inner = this.newAccum(acc.region);
        this.compositeLayers(base.children, inner);
        this.drawSource(temp, { texture: inner.rt.texture, ...whole }, 1, 'normal', base.mask, this.maskOverrideFor(base), false);
        this.gpu.pool.release(inner.rt);
        break;
      }
      case 'adjustment':
        break;
    }
    for (const layer of clipped) this.compositeLayer(layer, temp, true);
    this.drawSource(acc, { texture: temp.rt.texture, ...whole }, base.opacity, base.blendMode, null, undefined, false);
    this.gpu.pool.release(temp.rt);
  }

  private maskOverrideFor(layer: Layer): WebGLTexture | undefined {
    if (!layer.mask) return undefined;
    for (const p of this.providers) {
      const t = p.maskFor?.(layer);
      if (t) return t;
    }
    return undefined;
  }

  private overrideFor(layer: Layer): DrawSource | null | undefined {
    for (const p of this.providers) {
      const r = p.sourceFor?.(layer);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  private pixelSource(layer: Extract<Layer, { type: 'pixel' }>): DrawSource | null {
    const surface = this.surfaces.tryGet(layer.surfaceId);
    if (!surface) return null;
    return {
      texture: this.surfaces.texture(layer.surfaceId),
      x: layer.x,
      y: layer.y,
      width: surface.width,
      height: surface.height,
    };
  }

  private bindMask(program: Program, mask: LayerMask | null, maskTransform?: Affine, maskTexture?: WebGLTexture): void {
    const gpu = this.gpu;
    if (mask && mask.enabled && this.surfaces.has(mask.surfaceId)) {
      const s = this.surfaces.get(mask.surfaceId);
      gpu.bindTexture(2, maskTexture ?? this.surfaces.texture(mask.surfaceId));
      program
        .int('u_mask', 2)
        .int('u_hasMask', 1)
        .vec4('u_maskRect', mask.x, mask.y, s.width, s.height)
        .float('u_maskDefault', mask.defaultValue / 255);
      const inv = maskTransform ? invertAffine(maskTransform) : null;
      program.int('u_maskTransformed', inv ? 1 : 0);
      if (inv) program.mat3('u_maskInv', affineToMat3(inv));
    } else {
      gpu.bindTexture(2, gpu.dummyR8);
      program.int('u_mask', 2).int('u_hasMask', 0);
    }
  }

  /** Blends a positioned source onto the accumulator. */
  private drawSource(
    acc: Accum,
    source: DrawSource,
    opacity: number,
    blendMode: Layer['blendMode'],
    mask: LayerMask | null,
    maskTexture?: WebGLTexture,
    atop = false,
  ): void {
    if (opacity <= 0) return;
    if (source.transform && !invertAffine(source.transform)) return;
    const docRect = intersectRects(sourceBounds(source), acc.region);
    if (isEmptyRect(docRect)) return;
    const transformed = source.transform !== undefined;
    const local = { x: docRect.x - acc.region.x, y: docRect.y - acc.region.y, width: docRect.width, height: docRect.height };
    const mode = blendMode === 'passThrough' ? 'normal' : blendMode;
    const gpu = this.gpu;

    if (isFixedFunctionBlend(mode)) {
      const program = gpu
        .program(`layerOver:${mode}:${transformed}`, () => layerOverProgram(mode === 'dissolve', transformed))
        .use();
      gpu.bindTexture(0, source.texture);
      setSourceUniforms(program, source);
      program.vec2('u_regionOrigin', acc.region.x, acc.region.y).float('u_opacity', opacity);
      this.bindMask(program, mask, source.maskTransform, maskTexture);
      if (atop) gpu.blendAtop();
      else gpu.blendOver();
      gpu.drawRect(program, acc.rt, local);
      gpu.noBlend();
      return;
    }

    // Ping-pong: render blended pixels into scratch, then copy the rect back.
    const scratch = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);
    const program = gpu
      .program(`layerBlend:${mode}:${transformed}:${atop}`, () => layerBlendProgram(mode, transformed, atop))
      .use();
    gpu.bindTexture(0, source.texture);
    gpu.bindTexture(1, acc.rt.texture);
    setSourceUniforms(program, source);
    program.int('u_backdrop', 1).vec2('u_regionOrigin', acc.region.x, acc.region.y).float('u_opacity', opacity);
    this.bindMask(program, mask, source.maskTransform, maskTexture);
    gpu.noBlend();
    gpu.drawRect(program, scratch, local);
    gpu.bindTexture(1, null);
    gpu.blit(scratch, acc.rt, local);
    gpu.pool.release(scratch);
  }

  private compositeGroup(group: GroupLayer, acc: Accum, atop: boolean): void {
    if (group.children.length === 0 || group.opacity <= 0) return;
    const gpu = this.gpu;
    const hasMask = group.mask !== null && group.mask.enabled;

    // A clipped group is always isolated: it must land atop the clipping base.
    if (group.blendMode === 'passThrough' && !atop) {
      if (group.opacity >= 1 && !hasMask) {
        this.compositeLayers(group.children, acc);
        return;
      }
      // Composite children onto a copy of the backdrop, then mix back by opacity·mask.
      const full = { x: 0, y: 0, width: acc.region.width, height: acc.region.height };
      const copy: Accum = { rt: gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format), region: acc.region };
      gpu.blit(acc.rt, copy.rt, full);
      this.compositeLayers(group.children, copy);
      const out = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);
      const program = gpu.program('mix', mixProgram).use();
      gpu.bindTexture(0, acc.rt.texture);
      gpu.bindTexture(1, copy.rt.texture);
      program
        .int('u_a', 0)
        .int('u_b', 1)
        .vec2('u_regionOrigin', acc.region.x, acc.region.y)
        .float('u_opacity', group.opacity);
      this.bindMask(program, group.mask, undefined, this.maskOverrideFor(group));
      gpu.noBlend();
      gpu.drawRect(program, out, full);
      gpu.bindTexture(0, null);
      gpu.bindTexture(1, null);
      gpu.blit(out, acc.rt, full);
      gpu.pool.release(out);
      gpu.pool.release(copy.rt);
      return;
    }

    // Isolated group: render children over transparency, then blend the result.
    const inner = this.newAccum(acc.region);
    this.compositeLayers(group.children, inner);
    this.drawSource(
      acc,
      {
        texture: inner.rt.texture,
        x: acc.region.x,
        y: acc.region.y,
        width: acc.region.width,
        height: acc.region.height,
      },
      group.opacity,
      group.blendMode,
      group.mask,
      this.maskOverrideFor(group),
      atop,
    );
    gpu.pool.release(inner.rt);
  }

  dispose(): void {
    this.composite?.dispose();
    this.composite = null;
    this.adjustments.dispose();
  }
}
