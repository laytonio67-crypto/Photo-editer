import type { DocState, Layer, LayerId } from '../doc/types';
import type { GPU } from '../gl/gpu';
import type { RenderTarget } from '../gl/renderTarget';
import { readPixelsAsync } from '../gl/readback';
import type { Compositor } from '../render/Compositor';
import { FRAGMENT_HEADER, REGION_VERTEX } from '../render/shaders/common';
import { layersBelow, type HistogramData } from './histogram';

/** Histograms use at most this many samples; more adds cost, not information. */
const MAX_SAMPLES = 1 << 20;
const TILE = 1024;

/**
 * Point-samples a region-local texture on a regular grid and writes straight
 * (un-premultiplied) colour. Point sampling keeps the tonal distribution intact, where
 * averaging (mipmaps) would narrow it.
 */
function sampleProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform vec2 u_dstOrigin;
uniform float u_step;
uniform float u_offset;
uniform vec2 u_srcMax;
in vec2 v_px;
out vec4 o;
void main() {
  vec2 cell = floor(v_px - u_dstOrigin);
  vec2 p = min(cell * u_step + u_offset, u_srcMax);
  vec4 c = texelFetch(u_src, ivec2(p), 0);
  o = c.a > 0.0 ? vec4(clamp(c.rgb / c.a, 0.0, 1.0), c.a) : vec4(0.0);
}
`,
  };
}

/**
 * Computes histograms of the document composite, or of the input an adjustment layer
 * receives (everything below it). Sampling runs on the GPU, the readback is
 * asynchronous, and binning happens in a worker.
 */
export class HistogramService {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (h: HistogramData) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly gpu: GPU,
    private readonly compositor: Compositor,
  ) {}

  /** Histogram of the composite, or of what `belowLayerId` sees when given. */
  async compute(doc: DocState, belowLayerId?: LayerId | null): Promise<HistogramData> {
    const step = Math.max(1, Math.ceil(Math.sqrt((doc.width * doc.height) / MAX_SAMPLES)));
    const outW = Math.ceil(doc.width / step);
    const outH = Math.ceil(doc.height / step);
    const gpu = this.gpu;
    const out = gpu.pool.acquire(outW, outH, 'rgba8');
    try {
      const layers = belowLayerId ? layersBelow(doc.layers, belowLayerId) : null;
      if (layers) this.sampleLayers(doc, layers, step, out);
      else this.sampleComposite(doc, step, out);
      const pixels = readPixelsAsync(gpu.gl, out.framebuffer, { x: 0, y: 0, width: outW, height: outH }, {
        format: gpu.gl.RGBA,
        type: gpu.gl.UNSIGNED_BYTE,
        bytesPerPixel: 4,
      });
      gpu.pool.release(out);
      return this.bin(await pixels);
    } catch (err) {
      gpu.pool.release(out);
      throw err;
    }
  }

  private draw(src: WebGLTexture, srcW: number, srcH: number, step: number, dst: { x: number; y: number; width: number; height: number }, target: RenderTarget): void {
    const gpu = this.gpu;
    const program = gpu.program('histogramSample', sampleProgram).use();
    gpu.bindTexture(0, src);
    program
      .int('u_src', 0)
      .vec2('u_dstOrigin', dst.x, dst.y)
      .float('u_step', step)
      .float('u_offset', Math.floor(step / 2))
      .vec2('u_srcMax', srcW - 1, srcH - 1);
    gpu.noBlend();
    gpu.drawRect(program, target, dst);
    gpu.bindTexture(0, null);
  }

  private sampleComposite(doc: DocState, step: number, out: RenderTarget): void {
    this.compositor.update(doc);
    const composite = this.compositor.compositeTarget;
    if (!composite) throw new Error('No composite to measure');
    this.draw(composite.texture, doc.width, doc.height, step, { x: 0, y: 0, width: Math.ceil(doc.width / step), height: Math.ceil(doc.height / step) }, out);
  }

  /** Renders `layers` tile by tile (tiles aligned to the sampling grid) and samples each. */
  private sampleLayers(doc: DocState, layers: readonly Layer[], step: number, out: RenderTarget): void {
    const tile = Math.max(step, Math.floor(TILE / step) * step);
    for (let ty = 0; ty < doc.height; ty += tile) {
      for (let tx = 0; tx < doc.width; tx += tile) {
        const region = { x: tx, y: ty, width: Math.min(tile, doc.width - tx), height: Math.min(tile, doc.height - ty) };
        const acc = this.compositor.renderRegion(doc, region, layers);
        const dst = { x: tx / step, y: ty / step, width: Math.ceil(region.width / step), height: Math.ceil(region.height / step) };
        this.draw(acc.texture, region.width, region.height, step, dst, out);
        this.gpu.pool.release(acc);
      }
    }
  }

  private bin(pixels: Uint8Array): Promise<HistogramData> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./histogram.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; histogram: HistogramData }>) => {
        const entry = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        entry?.resolve(e.data.histogram);
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        for (const entry of this.pending.values()) entry.reject(new Error(`Histogram worker failed: ${e.message}`));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    const id = this.nextId++;
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, data: pixels }, [pixels.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
