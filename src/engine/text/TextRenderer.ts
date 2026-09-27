import type { LayerId, TextLayer } from '../doc/types';
import { intersectRects, isEmptyRect, roundOutRect, transformedBounds, type Rect } from '../geometry';
import type { GPU } from '../gl/gpu';
import { createTexture } from '../gl/texture';
import type { DrawSource } from '../render/Compositor';
import { layoutText, textMatrix, type TextLayout, type TextMeasurer } from './layout';

interface CacheEntry {
  key: string;
  texture: WebGLTexture | null;
  rect: Rect;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function create2D(width: number, height: number): Ctx2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(width, height).getContext('2d');
    if (ctx) return ctx;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

const LAYOUT_CACHE_LIMIT = 64;

/**
 * Rasterises text layers with the browser's text engine (Canvas 2D) and serves them to
 * the compositor as textures. Text is rendered directly at its final position, rotation
 * and scale so glyphs stay sharp. Rasters are caches keyed by everything that affects
 * them; the document keeps only the vector description.
 */
export class TextRenderer {
  private readonly measureCtx: Ctx2D;
  private readonly cache = new Map<LayerId, CacheEntry>();
  private readonly layouts = new Map<string, TextLayout>();
  private readonly pendingFonts = new Set<string>();
  private readonly nativeSpacing: boolean;

  constructor(
    private readonly gpu: GPU,
    /** Area worth rasterising (the canvas); text outside it is never visible. */
    private readonly clipRect: () => Rect,
    /** Called when a web font finished loading and rasters were invalidated. */
    private readonly onFontsChanged: () => void,
  ) {
    this.measureCtx = create2D(1, 1);
    this.nativeSpacing = 'letterSpacing' in this.measureCtx;
  }

  private setSpacing(ctx: Ctx2D, spacing: number): void {
    if (this.nativeSpacing) (ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`;
  }

  /** Canvas-backed measurements (see layout.ts). */
  readonly measurer: TextMeasurer = {
    measure: (text, font, spacing) => {
      const ctx = this.measureCtx;
      ctx.font = font;
      this.setSpacing(ctx, spacing);
      const m = ctx.measureText(text);
      // Without native letter-spacing, glyphs are placed one by one (see drawLine).
      const extra = this.nativeSpacing ? 0 : spacing * [...text].length;
      return {
        width: m.width + extra,
        inkLeft: m.actualBoundingBoxLeft,
        inkRight: m.actualBoundingBoxRight + Math.max(0, extra),
        inkAscent: m.actualBoundingBoxAscent,
        inkDescent: m.actualBoundingBoxDescent,
      };
    },
    fontExtents: (font) => {
      const ctx = this.measureCtx;
      ctx.font = font;
      this.setSpacing(ctx, 0);
      const m = ctx.measureText('Hg');
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
      const ascent = Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : size * 0.8;
      const descent = Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : size * 0.2;
      return { ascent, descent };
    },
  };

  /** Layout of a layer's text (cached by content and style). */
  layout(layer: Pick<TextLayer, 'content' | 'style'>): TextLayout {
    const key = JSON.stringify([layer.content, layer.style]);
    let layout = this.layouts.get(key);
    if (!layout) {
      layout = layoutText(layer.content, layer.style, this.measurer);
      this.watchFont(layout.font);
      if (this.layouts.size >= LAYOUT_CACHE_LIMIT) this.layouts.delete(this.layouts.keys().next().value!);
      this.layouts.set(key, layout);
    }
    return layout;
  }

  /** Document-space bounds of the layer's glyphs, or null when nothing is visible. */
  bounds(layer: TextLayer): Rect | null {
    const ink = this.layout(layer).ink;
    return ink ? roundOutRect(transformedBounds(textMatrix(layer), ink)) : null;
  }

  /** Raster of a text layer for compositing (null when it draws nothing). */
  sourceFor(layer: TextLayer): DrawSource | null {
    const clip = this.clipRect();
    const key = JSON.stringify([layer.content, layer.style, layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY, clip]);
    let entry = this.cache.get(layer.id);
    if (!entry || entry.key !== key) {
      if (entry?.texture) this.gpu.gl.deleteTexture(entry.texture);
      entry = this.rasterize(layer, key, clip);
      this.cache.set(layer.id, entry);
    }
    if (!entry.texture) return null;
    return { texture: entry.texture, x: entry.rect.x, y: entry.rect.y, width: entry.rect.width, height: entry.rect.height };
  }

  private rasterize(layer: TextLayer, key: string, clip: Rect): CacheEntry {
    const layout = this.layout(layer);
    const empty = { key, texture: null, rect: { x: 0, y: 0, width: 0, height: 0 } };
    if (!layout.ink) return empty;
    const m = textMatrix(layer);
    const rect = intersectRects(roundOutRect(transformedBounds(m, layout.ink)), clip);
    if (isEmptyRect(rect)) return empty;
    const ctx = create2D(rect.width, rect.height);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - rect.x, m.f - rect.y);
    ctx.font = layout.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const { r, g, b } = layer.style.color;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    this.setSpacing(ctx, layer.style.letterSpacing);
    for (const line of layout.lines) this.drawLine(ctx, line.text, line.x, line.baseline, layer.style.letterSpacing);

    const gl = this.gpu.gl;
    const texture = createTexture(gl, 'rgba8', rect.width, rect.height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas as TexImageSource);
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return { key, texture, rect };
  }

  private drawLine(ctx: Ctx2D, text: string, x: number, y: number, spacing: number): void {
    if (this.nativeSpacing || spacing === 0) {
      ctx.fillText(text, x, y);
      return;
    }
    let pen = x;
    for (const ch of text) {
      ctx.fillText(ch, pen, y);
      pen += ctx.measureText(ch).width + spacing;
    }
  }

  /** Re-renders once a web font that was still loading becomes available. */
  private watchFont(font: string): void {
    if (typeof document === 'undefined' || !document.fonts || this.pendingFonts.has(font)) return;
    if (document.fonts.check(font)) return;
    this.pendingFonts.add(font);
    document.fonts
      .load(font)
      .then(() => {
        this.layouts.clear();
        this.invalidateAll();
        this.onFontsChanged();
      })
      .catch(() => undefined)
      .finally(() => this.pendingFonts.delete(font));
  }

  private invalidateAll(): void {
    for (const entry of this.cache.values()) if (entry.texture) this.gpu.gl.deleteTexture(entry.texture);
    this.cache.clear();
  }

  /** Drops rasters of layers that are no longer in the document. */
  prune(live: ReadonlySet<LayerId>): void {
    for (const [id, entry] of this.cache) {
      if (live.has(id)) continue;
      if (entry.texture) this.gpu.gl.deleteTexture(entry.texture);
      this.cache.delete(id);
    }
  }

  dispose(): void {
    this.invalidateAll();
    this.layouts.clear();
  }
}
