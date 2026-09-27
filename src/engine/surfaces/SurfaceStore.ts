import { createId } from '../store';
import type { Rect } from '../geometry';
import type { SurfaceId } from '../doc/types';
import { RenderTarget } from '../gl/renderTarget';
import { formatInfo, textureBytes } from '../gl/texture';
import { readPixelsAsync, readPixelsSync, type ReadFormat } from '../gl/readback';

export type SurfaceFormat = 'rgba8' | 'r8';

/**
 * A pixel buffer owned by the store. Colour surfaces hold premultiplied RGBA8; mask
 * and selection surfaces hold single-channel coverage (R8).
 *
 * `target` is null when the surface has been evicted from the GPU; its pixels then
 * live in `cpu` until the surface is needed again.
 */
export interface Surface {
  readonly id: SurfaceId;
  readonly width: number;
  readonly height: number;
  readonly format: SurfaceFormat;
  target: RenderTarget | null;
  cpu: Uint8Array | null;
  /** Incremented on every pixel modification (used for thumbnails and incremental saves). */
  version: number;
  lastUsed: number;
}

export type ImageSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageData;

export class SurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceError';
  }
}

export class SurfaceStore {
  private readonly surfaces = new Map<SurfaceId, Surface>();
  private r8ReadFormat: ReadFormat | null = null;
  private clock = 0;
  /** Listeners notified when a surface's pixels change (id, dirty rect). */
  private readonly changeListeners = new Set<(id: SurfaceId, rect: Rect | null) => void>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxSize: number,
  ) {}

  onChange(listener: (id: SurfaceId, rect: Rect | null) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Marks a surface as modified: bumps its version and notifies listeners. */
  markChanged(id: SurfaceId, rect: Rect | null = null): void {
    const s = this.surfaces.get(id);
    if (!s) return;
    s.version++;
    for (const l of this.changeListeners) l(id, rect);
  }

  private checkSize(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new SurfaceError(`Invalid surface size ${width}×${height}`);
    }
    if (width > this.maxSize || height > this.maxSize) {
      throw new SurfaceError(
        `Surface ${width}×${height} exceeds this GPU's maximum of ${this.maxSize}×${this.maxSize} pixels`,
      );
    }
  }

  private register(width: number, height: number, format: SurfaceFormat, target: RenderTarget, id?: SurfaceId): Surface {
    const surface: Surface = {
      id: id && !this.surfaces.has(id) ? id : createId('srf'),
      width,
      height,
      format,
      target,
      cpu: null,
      version: 1,
      lastUsed: ++this.clock,
    };
    this.surfaces.set(surface.id, surface);
    return surface;
  }

  /** New surface cleared to transparent (or to `fill`, premultiplied 0..1 values). */
  createBlank(width: number, height: number, format: SurfaceFormat, fill?: readonly number[]): Surface {
    this.checkSize(width, height);
    const target = new RenderTarget(this.gl, width, height, format);
    const gl = this.gl;
    target.bind();
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(fill?.[0] ?? 0, fill?.[1] ?? 0, fill?.[2] ?? 0, fill?.[3] ?? 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.register(width, height, format, target);
  }

  /**
   * New surface from raw pixel data (premultiplied RGBA8 or R8, top-down rows).
   * `preferredId` keeps a stored id (projects) unless that id is already in use.
   */
  createFromPixels(width: number, height: number, format: SurfaceFormat, data: Uint8Array, preferredId?: SurfaceId): Surface {
    this.checkSize(width, height);
    const expected = width * height * (format === 'rgba8' ? 4 : 1);
    if (data.length !== expected) {
      throw new SurfaceError(`Pixel data length ${data.length} does not match ${width}×${height} ${format}`);
    }
    const target = new RenderTarget(this.gl, width, height, format);
    this.upload(target, { x: 0, y: 0, width, height }, data);
    return this.register(width, height, format, target, preferredId);
  }

  /**
   * New RGBA surface from a browser image source. Straight-alpha sources are
   * premultiplied during upload.
   */
  createFromImage(source: ImageSource, width?: number, height?: number): Surface {
    const w = width ?? source.width;
    const h = height ?? source.height;
    this.checkSize(w, h);
    const gl = this.gl;
    const target = new RenderTarget(gl, w, h, 'rgba8');
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return this.register(w, h, 'rgba8', target);
  }

  has(id: SurfaceId): boolean {
    return this.surfaces.has(id);
  }

  get(id: SurfaceId): Surface {
    const s = this.surfaces.get(id);
    if (!s) throw new SurfaceError(`Unknown surface ${id}`);
    return s;
  }

  tryGet(id: SurfaceId): Surface | undefined {
    return this.surfaces.get(id);
  }

  /** Returns the GPU target of a surface, re-uploading it if it was evicted. */
  target(id: SurfaceId): RenderTarget {
    const s = this.get(id);
    s.lastUsed = ++this.clock;
    if (!s.target) {
      if (!s.cpu) throw new SurfaceError(`Surface ${id} has no pixel data`);
      const target = new RenderTarget(this.gl, s.width, s.height, s.format);
      this.upload(target, { x: 0, y: 0, width: s.width, height: s.height }, s.cpu);
      s.target = target;
      s.cpu = null;
    }
    return s.target;
  }

  texture(id: SurfaceId): WebGLTexture {
    return this.target(id).texture;
  }

  private upload(target: RenderTarget, rect: Rect, data: Uint8Array): void {
    const gl = this.gl;
    const info = formatInfo(gl, target.format);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.width, rect.height, info.format, info.type, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Overwrites a region with raw pixel data (same layout as `read`). */
  write(id: SurfaceId, rect: Rect, data: Uint8Array): void {
    const s = this.get(id);
    const bpp = s.format === 'rgba8' ? 4 : 1;
    if (data.length !== rect.width * rect.height * bpp) {
      throw new SurfaceError('Region data length mismatch');
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > s.width || rect.y + rect.height > s.height) {
      throw new SurfaceError('Write region outside surface bounds');
    }
    if (!s.target && s.cpu) {
      // Evicted: patch the CPU copy directly.
      for (let row = 0; row < rect.height; row++) {
        const src = row * rect.width * bpp;
        const dst = ((rect.y + row) * s.width + rect.x) * bpp;
        s.cpu.set(data.subarray(src, src + rect.width * bpp), dst);
      }
    } else {
      this.upload(this.target(id), rect, data);
    }
    this.markChanged(id, rect);
  }

  private readFormat(format: SurfaceFormat): ReadFormat {
    const gl = this.gl;
    if (format === 'rgba8') return { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 };
    if (!this.r8ReadFormat) {
      // RED/UNSIGNED_BYTE reads are implementation-defined for R8 attachments; probe once.
      const probe = new RenderTarget(gl, 1, 1, 'r8');
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, probe.framebuffer);
      const fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
      const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      probe.dispose();
      this.r8ReadFormat =
        fmt === gl.RED && type === gl.UNSIGNED_BYTE
          ? { format: gl.RED, type: gl.UNSIGNED_BYTE, bytesPerPixel: 1 }
          : { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 };
    }
    return this.r8ReadFormat;
  }

  private extractR(data: Uint8Array, fmt: ReadFormat): Uint8Array {
    if (fmt.bytesPerPixel === 1) return data;
    const out = new Uint8Array(data.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = data[i]!;
    return out;
  }

  private cpuRegion(s: Surface, rect: Rect): Uint8Array {
    const bpp = s.format === 'rgba8' ? 4 : 1;
    const out = new Uint8Array(rect.width * rect.height * bpp);
    for (let row = 0; row < rect.height; row++) {
      const src = ((rect.y + row) * s.width + rect.x) * bpp;
      out.set(s.cpu!.subarray(src, src + rect.width * bpp), row * rect.width * bpp);
    }
    return out;
  }

  /**
   * Reads pixels asynchronously (see readPixelsAsync). The region's current contents
   * are captured at call time even if the surface is modified before resolution.
   */
  read(id: SurfaceId, rect?: Rect): Promise<Uint8Array> {
    const s = this.get(id);
    const r = rect ?? { x: 0, y: 0, width: s.width, height: s.height };
    if (!s.target && s.cpu) return Promise.resolve(this.cpuRegion(s, r));
    const fmt = this.readFormat(s.format);
    return readPixelsAsync(this.gl, this.target(id).framebuffer, r, fmt).then((d) =>
      s.format === 'r8' ? this.extractR(d, fmt) : d,
    );
  }

  readSync(id: SurfaceId, rect?: Rect): Uint8Array {
    const s = this.get(id);
    const r = rect ?? { x: 0, y: 0, width: s.width, height: s.height };
    if (!s.target && s.cpu) return this.cpuRegion(s, r);
    const fmt = this.readFormat(s.format);
    const d = readPixelsSync(this.gl, this.target(id).framebuffer, r, fmt);
    return s.format === 'r8' ? this.extractR(d, fmt) : d;
  }

  /** GPU copy of a whole surface into a new surface. */
  clone(id: SurfaceId): Surface {
    const src = this.get(id);
    const copy = this.createBlank(src.width, src.height, src.format);
    this.copyRegion(id, { x: 0, y: 0, width: src.width, height: src.height }, copy.id, 0, 0);
    return copy;
  }

  /** Copies a region between surfaces of the same format (clipped to both). */
  copyRegion(srcId: SurfaceId, srcRect: Rect, dstId: SurfaceId, dstX: number, dstY: number): void {
    const gl = this.gl;
    const src = this.target(srcId);
    const dst = this.target(dstId);
    // Clip against source and destination bounds.
    let sx = srcRect.x;
    let sy = srcRect.y;
    let w = srcRect.width;
    let h = srcRect.height;
    let dx = dstX;
    let dy = dstY;
    if (sx < 0) { w += sx; dx -= sx; sx = 0; }
    if (sy < 0) { h += sy; dy -= sy; sy = 0; }
    if (dx < 0) { w += dx; sx -= dx; dx = 0; }
    if (dy < 0) { h += dy; sy -= dy; dy = 0; }
    w = Math.min(w, src.width - sx, dst.width - dx);
    h = Math.min(h, src.height - sy, dst.height - dy);
    if (w <= 0 || h <= 0) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.markChanged(dstId, { x: dx, y: dy, width: w, height: h });
  }

  delete(id: SurfaceId): void {
    const s = this.surfaces.get(id);
    if (!s) return;
    s.target?.dispose();
    s.target = null;
    s.cpu = null;
    this.surfaces.delete(id);
  }

  /** Deletes every surface not in `live`. Returns the number freed. */
  collectGarbage(live: ReadonlySet<SurfaceId>): number {
    let freed = 0;
    for (const id of [...this.surfaces.keys()]) {
      if (!live.has(id)) {
        this.delete(id);
        freed++;
      }
    }
    return freed;
  }

  /**
   * Moves a GPU-resident surface to CPU memory to free GPU memory. Used for surfaces
   * only referenced by history.
   */
  async evict(id: SurfaceId): Promise<boolean> {
    const s = this.surfaces.get(id);
    if (!s || !s.target) return false;
    const version = s.version;
    const data = await this.read(id);
    // Abort if the surface was deleted, modified or re-created while the read was in
    // flight: the snapshot would be stale.
    if (this.surfaces.get(id) !== s || !s.target || s.version !== version) return false;
    s.cpu = data;
    s.target.dispose();
    s.target = null;
    return true;
  }

  /** Bytes of GPU memory held by resident surfaces. */
  gpuBytes(): number {
    let total = 0;
    for (const s of this.surfaces.values()) {
      if (s.target) total += textureBytes(s.format, s.width, s.height);
    }
    return total;
  }

  cpuBytes(): number {
    let total = 0;
    for (const s of this.surfaces.values()) if (s.cpu) total += s.cpu.byteLength;
    return total;
  }

  ids(): SurfaceId[] {
    return [...this.surfaces.keys()];
  }

  /** Surfaces sorted least-recently used first. */
  lruOrder(): Surface[] {
    return [...this.surfaces.values()].sort((a, b) => a.lastUsed - b.lastUsed);
  }

  dispose(): void {
    for (const id of [...this.surfaces.keys()]) this.delete(id);
  }
}
