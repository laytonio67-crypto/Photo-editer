import {
  invertAffine,
  isEmptyRect,
  roundOutRect,
  transformedBounds,
  type Affine,
  type Rect,
} from '../geometry';
import type { GPU } from '../gl/gpu';
import type { RenderTarget } from '../gl/renderTarget';
import type { Surface, SurfaceStore } from '../surfaces/SurfaceStore';
import { affineToMat3 } from './Compositor';
import { resampleProgram } from './shaders/layer';

export type ResampleMode = 'nearest' | 'bilinear' | 'bicubic';

export interface ResampleResult {
  surface: Surface;
  /** Document position of the new surface. */
  x: number;
  y: number;
}

/**
 * True for transforms that map pixel centres exactly onto pixel centres (integer
 * translations, flips, 90° rotations). These are copied with nearest sampling so they
 * are lossless.
 */
export function isPixelExact(m: Affine): boolean {
  const unit = (v: number) => v === 0 || v === 1 || v === -1;
  return (
    unit(m.a) &&
    unit(m.b) &&
    unit(m.c) &&
    unit(m.d) &&
    Math.abs(m.a * m.d - m.b * m.c) === 1 &&
    Number.isInteger(m.e) &&
    Number.isInteger(m.f)
  );
}

export interface ResampleOptions {
  mode?: ResampleMode;
  /** Value (0..1) of mask pixels outside the source. Colour surfaces use transparent. */
  outsideValue?: number;
  /** Limit the output to this document rect. */
  clip?: Rect;
  /** Part of the source that has content (defaults to the whole surface). */
  sourceRect?: Rect;
  /**
   * Repeat edge pixels instead of fading into transparency at the source's border
   * (for images that fill the canvas, so resized edges stay opaque).
   */
  clampEdges?: boolean;
}

/**
 * Resamples a surface through `transform` (source pixel coords → document coords) into
 * a new surface covering the transformed bounds. Downscaling is supersampled (area
 * filtering); upscaling uses the chosen interpolation.
 */
export function resampleSurface(
  gpu: GPU,
  surfaces: SurfaceStore,
  sourceId: string,
  transform: Affine,
  options: ResampleOptions = {},
): ResampleResult | null {
  const { mode = 'bicubic', outsideValue = 0, clip } = options;
  const src = surfaces.get(sourceId);
  const inv = invertAffine(transform);
  if (!inv) return null;
  const sourceRect = options.sourceRect ?? { x: 0, y: 0, width: src.width, height: src.height };
  let bounds = roundOutRect(transformedBounds(transform, sourceRect));
  if (clip) {
    const x0 = Math.max(bounds.x, clip.x);
    const y0 = Math.max(bounds.y, clip.y);
    const x1 = Math.min(bounds.x + bounds.width, clip.x + clip.width);
    const y1 = Math.min(bounds.y + bounds.height, clip.y + clip.height);
    bounds = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  }
  if (isEmptyRect(bounds)) return null;
  const surface = surfaces.createBlank(bounds.width, bounds.height, src.format);
  const exact = isPixelExact(transform);
  const effectiveMode = exact ? 'nearest' : mode;
  // Source pixels covered by one output pixel along each axis.
  const footprint = Math.max(Math.hypot(inv.a, inv.b), Math.hypot(inv.c, inv.d));
  const taps = effectiveMode === 'nearest' || footprint <= 1.05 ? 1 : Math.min(8, Math.ceil(footprint));

  const program = gpu.program('resample', resampleProgram).use();
  gpu.bindTexture(0, surfaces.texture(sourceId));
  const outside = src.format === 'r8' ? [outsideValue, 0, 0, 1] : [0, 0, 0, 0];
  program
    .int('u_src', 0)
    .vec2('u_srcSize', src.width, src.height)
    .vec4('u_outside', outside[0]!, outside[1]!, outside[2]!, outside[3]!)
    .mat3('u_inv', affineToMat3(inv))
    .vec2('u_outOrigin', bounds.x, bounds.y)
    .int('u_taps', taps)
    .int('u_mode', effectiveMode === 'nearest' ? 0 : effectiveMode === 'bilinear' ? 1 : 2)
    .int('u_clampEdges', options.clampEdges ? 1 : 0);
  gpu.noBlend();
  const target = surfaces.target(surface.id);
  gpu.drawRect(program, target, { x: 0, y: 0, width: bounds.width, height: bounds.height });
  gpu.bindTexture(0, null);
  surfaces.markChanged(surface.id);
  return { surface, x: bounds.x, y: bounds.y };
}

/**
 * Copies `rect` (in surface pixel coords) of a surface into a new surface of that size.
 * Areas outside the source become transparent (or `fill` for masks).
 */
export function cropSurface(surfaces: SurfaceStore, sourceId: string, rect: Rect, fill = 0): Surface {
  const src = surfaces.get(sourceId);
  const out = surfaces.createBlank(rect.width, rect.height, src.format, src.format === 'r8' ? [fill, 0, 0, 1] : undefined);
  surfaces.copyRegion(sourceId, rect, out.id, 0, 0);
  return out;
}

/**
 * Resizes a whole texture (e.g. the document composite) to `width × height` into a
 * pooled RGBA8 target. Edges repeat, so an opaque image stays opaque at its border.
 * Release the result with gpu.pool.release.
 */
export function resampleTexture(
  gpu: GPU,
  texture: WebGLTexture,
  srcWidth: number,
  srcHeight: number,
  width: number,
  height: number,
  mode: ResampleMode,
): RenderTarget {
  const out = gpu.pool.acquire(width, height, 'rgba8');
  const sx = srcWidth / width;
  const sy = srcHeight / height;
  const inv = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
  const same = sx === 1 && sy === 1;
  const footprint = Math.max(sx, sy);
  const taps = same || mode === 'nearest' || footprint <= 1.05 ? 1 : Math.min(8, Math.ceil(footprint));
  const program = gpu.program('resample', resampleProgram).use();
  gpu.bindTexture(0, texture);
  program
    .int('u_src', 0)
    .vec2('u_srcSize', srcWidth, srcHeight)
    .vec4('u_outside', 0, 0, 0, 0)
    .mat3('u_inv', affineToMat3(inv))
    .vec2('u_outOrigin', 0, 0)
    .int('u_taps', taps)
    .int('u_mode', same || mode === 'nearest' ? 0 : mode === 'bilinear' ? 1 : 2)
    .int('u_clampEdges', 1);
  gpu.noBlend();
  gpu.drawRect(program, out, { x: 0, y: 0, width, height });
  gpu.bindTexture(0, null);
  return out;
}
