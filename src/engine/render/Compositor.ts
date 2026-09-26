import type { DocState, GroupLayer, Layer, LayerMask } from '../doc/types';
import {
  intersectRects,
  isEmptyRect,
  tileRect,
  unionRects,
  type Rect,
} from '../geometry';
import type { GPU } from '../gl/gpu';
import type { Program } from '../gl/program';
import { RenderTarget } from '../gl/renderTarget';
import { mipLevelCount } from '../gl/texture';
import type { SurfaceStore } from '../surfaces/SurfaceStore';
import { isFixedFunctionBlend } from './shaders/blend';
import { copyProgram, layerBlendProgram, layerOverProgram, mixProgram } from './shaders/layer';

/** A texture positioned in document space that can be drawn like a layer. */
export interface DrawSource {
  texture: WebGLTexture;
  /** Document position of texel (0, 0). */
  x: number;
  y: number;
  /** Extent of valid texels. */
  width: number;
  height: number;
}

/**
 * A region-sized accumulation buffer. `rt` may be larger than the region (pooled
 * targets are bucketed); pixel (0,0) of `rt` corresponds to document (region.x, region.y).
 */
interface Accum {
  rt: RenderTarget;
  region: Rect;
}

/** Hooks that let tools substitute what gets drawn for a layer (live previews). */
export interface LayerSourceProvider {
  /** Returns a replacement draw source for a layer, or undefined to use the default. */
  sourceFor?(layer: Layer): DrawSource | null | undefined;
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
  provider: LayerSourceProvider = {};

  constructor(
    private readonly gpu: GPU,
    private readonly surfaces: SurfaceStore,
  ) {}

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
    const dirty = this.dirty ? intersectRects(this.dirty, { x: 0, y: 0, width: doc.width, height: doc.height }) : null;
    this.dirty = null;
    if (!dirty || isEmptyRect(dirty)) return false;

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
   */
  renderRegion(doc: DocState, region: Rect, layers: readonly Layer[] = doc.layers): RenderTarget {
    const acc = this.newAccum(region);
    this.compositeLayers(layers, acc);
    return acc.rt;
  }

  private newAccum(region: Rect): Accum {
    const rt = this.gpu.pool.acquire(region.width, region.height, this.gpu.accumFormat);
    this.gpu.clear(rt, { x: 0, y: 0, width: region.width, height: region.height });
    return { rt, region };
  }

  private compositeLayers(layers: readonly Layer[], acc: Accum): void {
    for (const layer of layers) {
      if (!layer.visible) continue;
      switch (layer.type) {
        case 'pixel': {
          const override = this.provider.sourceFor?.(layer);
          if (override === null) break;
          const source = override ?? this.pixelSource(layer);
          if (source) this.drawSource(acc, source, layer.opacity, layer.blendMode, layer.mask);
          break;
        }
        case 'group':
          this.compositeGroup(layer, acc);
          break;
        case 'text': {
          const source = this.provider.sourceFor?.(layer);
          if (source) this.drawSource(acc, source, layer.opacity, layer.blendMode, layer.mask);
          break;
        }
        case 'adjustment':
          // Adjustment rendering is added with the adjustment engine.
          break;
      }
    }
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

  private bindMask(program: Program, mask: LayerMask | null): void {
    const gpu = this.gpu;
    if (mask && mask.enabled && this.surfaces.has(mask.surfaceId)) {
      const s = this.surfaces.get(mask.surfaceId);
      gpu.bindTexture(2, this.surfaces.texture(mask.surfaceId));
      program
        .int('u_mask', 2)
        .int('u_hasMask', 1)
        .vec4('u_maskRect', mask.x, mask.y, s.width, s.height)
        .float('u_maskDefault', mask.defaultValue / 255);
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
  ): void {
    if (opacity <= 0) return;
    const docRect = intersectRects({ x: source.x, y: source.y, width: source.width, height: source.height }, acc.region);
    if (isEmptyRect(docRect)) return;
    // Masks with a hidden default can only reveal inside the mask surface.
    const local = { x: docRect.x - acc.region.x, y: docRect.y - acc.region.y, width: docRect.width, height: docRect.height };
    const mode = blendMode === 'passThrough' ? 'normal' : blendMode;
    const gpu = this.gpu;

    if (isFixedFunctionBlend(mode)) {
      const program = gpu.program(`layerOver:${mode}`, () => layerOverProgram(mode === 'dissolve')).use();
      gpu.bindTexture(0, source.texture);
      program
        .int('u_src', 0)
        .vec2('u_srcOrigin', source.x, source.y)
        .vec2('u_regionOrigin', acc.region.x, acc.region.y)
        .float('u_opacity', opacity);
      this.bindMask(program, mask);
      gpu.blendOver();
      gpu.drawRect(program, acc.rt, local);
      gpu.noBlend();
      return;
    }

    // Ping-pong: render blended pixels into scratch, then copy the rect back.
    const scratch = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);
    const program = gpu.program(`layerBlend:${mode}`, () => layerBlendProgram(mode)).use();
    gpu.bindTexture(0, source.texture);
    gpu.bindTexture(1, acc.rt.texture);
    program
      .int('u_src', 0)
      .int('u_backdrop', 1)
      .vec2('u_srcOrigin', source.x, source.y)
      .vec2('u_regionOrigin', acc.region.x, acc.region.y)
      .float('u_opacity', opacity);
    this.bindMask(program, mask);
    gpu.noBlend();
    gpu.drawRect(program, scratch, local);
    gpu.bindTexture(1, null);
    gpu.blit(scratch, acc.rt, local);
    gpu.pool.release(scratch);
  }

  private compositeGroup(group: GroupLayer, acc: Accum): void {
    if (group.children.length === 0 || group.opacity <= 0) return;
    const gpu = this.gpu;
    const hasMask = group.mask !== null && group.mask.enabled;

    if (group.blendMode === 'passThrough') {
      if (group.opacity >= 1 && !hasMask) {
        this.compositeLayers(group.children, acc);
        return;
      }
      // Composite children onto a copy of the backdrop, then mix back by opacity·mask.
      const full = { x: 0, y: 0, width: acc.region.width, height: acc.region.height };
      const copy = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);
      gpu.blit(acc.rt, copy, full);
      this.compositeLayers(group.children, { rt: copy, region: acc.region });
      const out = gpu.pool.acquire(acc.region.width, acc.region.height, acc.rt.format);
      const program = gpu.program('mix', mixProgram).use();
      gpu.bindTexture(0, acc.rt.texture);
      gpu.bindTexture(1, copy.texture);
      program
        .int('u_a', 0)
        .int('u_b', 1)
        .vec2('u_regionOrigin', acc.region.x, acc.region.y)
        .float('u_opacity', group.opacity);
      this.bindMask(program, group.mask);
      gpu.noBlend();
      gpu.drawRect(program, out, full);
      gpu.bindTexture(0, null);
      gpu.bindTexture(1, null);
      gpu.blit(out, acc.rt, full);
      gpu.pool.release(out);
      gpu.pool.release(copy);
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
    );
    gpu.pool.release(inner.rt);
  }

  dispose(): void {
    this.composite?.dispose();
    this.composite = null;
  }
}
