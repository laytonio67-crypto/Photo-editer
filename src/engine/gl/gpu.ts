import type { Rect } from '../geometry';
import type { GLCaps } from './context';
import { Program, ProgramCache } from './program';
import { UnitQuad } from './quad';
import { RenderTargetPool } from './renderTarget';
import { bindTexture, createSamplers, createTexture, type Samplers, type TextureFormat } from './texture';

export interface FramebufferLike {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
}

/** Shared GPU resources: program cache, quad geometry, samplers, scratch pool. */
export class GPU {
  readonly programs: ProgramCache;
  readonly quad: UnitQuad;
  readonly samplers: Samplers;
  readonly pool: RenderTargetPool;
  /** Format used for intermediate compositing (higher precision when available). */
  readonly accumFormat: TextureFormat;
  /** 1×1 textures bound to samplers a draw does not use (avoids feedback-loop errors). */
  readonly dummyR8: WebGLTexture;
  readonly dummyRGBA: WebGLTexture;

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly caps: GLCaps,
  ) {
    this.programs = new ProgramCache(gl);
    this.quad = new UnitQuad(gl);
    this.samplers = createSamplers(gl);
    this.pool = new RenderTargetPool(gl, caps.maxDocumentSize);
    this.accumFormat = caps.halfFloatRenderable ? 'rgba16f' : 'rgba8';
    this.dummyR8 = createTexture(gl, 'r8', 1, 1);
    this.dummyRGBA = createTexture(gl, 'rgba8', 1, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.dummyR8);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.bindTexture(gl.TEXTURE_2D, this.dummyRGBA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
  }

  program(key: string, build: () => { vertex: string; fragment: string }): Program {
    return this.programs.get(key, build);
  }

  bindTexture(unit: number, texture: WebGLTexture | null, sampler: WebGLSampler | null = null): void {
    bindTexture(this.gl, unit, texture, sampler);
  }

  /**
   * Draws the unit quad mapped to `dst` (target pixel coordinates) into `target`.
   * The program must use REGION_VERTEX (u_dst / u_targetSize).
   */
  drawRect(program: Program, target: FramebufferLike, dst: Rect): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    program.vec4('u_dst', dst.x, dst.y, dst.width, dst.height);
    program.vec2('u_targetSize', target.width, target.height);
    this.quad.draw();
  }

  /** Premultiplied source-over blending (ONE, ONE_MINUS_SRC_ALPHA). */
  blendOver(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  noBlend(): void {
    this.gl.disable(this.gl.BLEND);
  }

  clear(target: FramebufferLike, rect?: Rect, color: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
    }
    gl.clearColor(color[0], color[1], color[2], color[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (rect) gl.disable(gl.SCISSOR_TEST);
  }

  /** Framebuffer-to-framebuffer copy of a rect (same coordinates in both). */
  blit(src: FramebufferLike, dst: FramebufferLike, r: Rect, dstX = r.x, dstY = r.y): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.framebuffer);
    gl.blitFramebuffer(
      r.x,
      r.y,
      r.x + r.width,
      r.y + r.height,
      dstX,
      dstY,
      dstX + r.width,
      dstY + r.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose(): void {
    this.programs.dispose();
    this.quad.dispose();
    this.pool.dispose();
    this.gl.deleteTexture(this.dummyR8);
    this.gl.deleteTexture(this.dummyRGBA);
  }
}
