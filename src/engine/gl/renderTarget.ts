import { createTexture, textureBytes, type TextureFormat } from './texture';

/** A texture with an attached framebuffer that can be rendered into. */
export class RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly bytes: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    readonly format: TextureFormat,
    readonly levels = 1,
    existingTexture?: WebGLTexture,
  ) {
    this.texture = existingTexture ?? createTexture(gl, format, width, height, levels);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('Failed to create framebuffer');
    this.framebuffer = fb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      gl.deleteFramebuffer(fb);
      if (!existingTexture) gl.deleteTexture(this.texture);
      throw new Error(`Framebuffer incomplete (0x${status.toString(16)}) for ${format} ${width}×${height}`);
    }
    this.bytes = existingTexture ? 0 : textureBytes(format, width, height, levels > 1);
  }

  /** Binds for drawing with a viewport covering the whole target. */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
  }

  dispose(ownsTexture = true): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    if (ownsTexture) this.gl.deleteTexture(this.texture);
  }
}

const BUCKET = 256;

function bucket(n: number, max: number): number {
  return Math.min(max, Math.ceil(n / BUCKET) * BUCKET);
}

/**
 * Pool of scratch render targets. Sizes are rounded up to 256-px buckets so dirty
 * regions of varying size reuse targets; callers render into the top-left
 * `width × height` sub-rectangle and must use the target's real size for UV math.
 */
export class RenderTargetPool {
  private readonly free: RenderTarget[] = [];
  private inUse = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxSize: number,
    private readonly maxFreeBytes = 256 * 1024 * 1024,
  ) {}

  acquire(width: number, height: number, format: TextureFormat): RenderTarget {
    const w = bucket(Math.max(1, width), this.maxSize);
    const h = bucket(Math.max(1, height), this.maxSize);
    const idx = this.free.findIndex((t) => t.format === format && t.width === w && t.height === h);
    this.inUse++;
    if (idx >= 0) {
      const [t] = this.free.splice(idx, 1);
      return t!;
    }
    return new RenderTarget(this.gl, w, h, format);
  }

  release(target: RenderTarget): void {
    this.inUse--;
    this.free.push(target);
    this.trim(this.maxFreeBytes);
  }

  /** Frees idle targets until idle memory is under `bytes`. */
  trim(bytes = 0): void {
    let total = this.free.reduce((sum, t) => sum + t.bytes, 0);
    while (total > bytes && this.free.length > 0) {
      const t = this.free.shift()!;
      total -= t.bytes;
      t.dispose();
    }
  }

  get activeCount(): number {
    return this.inUse;
  }

  dispose(): void {
    this.trim(0);
  }
}
