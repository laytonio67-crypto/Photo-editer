import type { Rect } from '../geometry';
import type { GPU } from '../gl/gpu';
import { RenderTarget } from '../gl/renderTarget';
import { readPixelsAsync } from '../gl/readback';
import { downsampleProgram } from './shaders/downsample';

export interface ThumbnailSource {
  texture: WebGLTexture;
  /** Texture size in texels. */
  width: number;
  height: number;
  /** Document position of texel (0,0). */
  x: number;
  y: number;
  /** Single-channel source (mask/selection): output is expanded to opaque grey. */
  grayscale?: boolean;
  /** Value (0..1) of a single-channel source outside its texture (mask default). */
  outsideValue?: number;
}

/** Fits `w×h` inside `max×max` keeping aspect ratio (at least 1 px). */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const s = Math.min(max / w, max / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Renders small previews (layer thumbnails, navigator, project thumbnails) on the GPU
 * with area averaging and returns straight-alpha ImageData ready for a 2D canvas.
 */
export class ThumbnailRenderer {
  private target: RenderTarget | null = null;

  constructor(private readonly gpu: GPU) {}

  private ensureTarget(w: number, h: number): RenderTarget {
    if (!this.target || this.target.width < w || this.target.height < h) {
      this.target?.dispose();
      const size = Math.max(w, h, this.target?.width ?? 0, 256);
      this.target = new RenderTarget(this.gpu.gl, size, size, 'rgba8');
    }
    return this.target;
  }

  /**
   * Renders `frame` (a document-space rect, usually the whole canvas) scaled to
   * `outW × outH`, with `source` positioned inside it.
   */
  render(source: ThumbnailSource, frame: Rect, outW: number, outH: number): Promise<ImageData> {
    const gpu = this.gpu;
    const target = this.ensureTarget(outW, outH);
    const dst = { x: 0, y: 0, width: outW, height: outH };
    gpu.clear(target, dst);
    const scaleX = frame.width / outW;
    const scaleY = frame.height / outH;
    const taps = Math.max(1, Math.min(16, Math.ceil(Math.max(scaleX, scaleY))));
    const program = gpu.program('downsample', downsampleProgram).use();
    gpu.bindTexture(0, source.texture, gpu.samplers.linear);
    program
      .int('u_src', 0)
      .vec2('u_srcSize', source.width, source.height)
      .vec2('u_srcOrigin', source.x, source.y)
      .vec2('u_docOrigin', frame.x, frame.y)
      .vec2('u_scale', scaleX, scaleY)
      .int('u_taps', taps);
    const outside = source.grayscale ? (source.outsideValue ?? 0) : 0;
    program.vec4('u_outside', outside, 0, 0, source.grayscale ? 1 : 0);
    gpu.noBlend();
    gpu.drawRect(program, target, dst);
    gpu.bindTexture(0, null);
    const gl = gpu.gl;
    // Asynchronous readback: the copy is queued on the GPU timeline, so the shared
    // target can be reused immediately for the next thumbnail.
    return readPixelsAsync(gl, target.framebuffer, dst, {
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      bytesPerPixel: 4,
    }).then((pixels) => toImageData(pixels, outW, outH, source.grayscale === true));
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
  }
}

/** Converts premultiplied RGBA (or R-in-RGBA for masks) readback data to ImageData. */
function toImageData(pixels: Uint8Array, outW: number, outH: number, grayscale: boolean): ImageData {
    const out = new ImageData(outW, outH);
    const d = out.data;
    if (grayscale) {
      for (let i = 0; i < d.length; i += 4) {
        const v = pixels[i]!;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
    } else {
      // Un-premultiply for canvas ImageData (straight alpha).
      for (let i = 0; i < d.length; i += 4) {
        const a = pixels[i + 3]!;
        if (a === 0) continue;
        const k = 255 / a;
        d[i] = Math.min(255, Math.round(pixels[i]! * k));
        d[i + 1] = Math.min(255, Math.round(pixels[i + 1]! * k));
        d[i + 2] = Math.min(255, Math.round(pixels[i + 2]! * k));
        d[i + 3] = a;
      }
    }
    return out;
}
