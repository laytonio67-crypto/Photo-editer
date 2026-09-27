import type { GPU } from '../gl/gpu';
import type { RenderTarget } from '../gl/renderTarget';
import { dabProgram } from './shaders';

/** A dab in target pixel coordinates. */
export interface GpuDab {
  x: number;
  y: number;
  radius: number;
  /** Per-dab coverage multiplier (flow × pressure). */
  alpha: number;
}

/**
 * Renders batches of round dabs into a coverage buffer with one instanced draw call.
 * Owns its own VAO: attribute 0 is the shared unit quad, attribute 1 the per-dab data.
 */
export class DabRenderer {
  private readonly vao: WebGLVertexArrayObject;
  private readonly quad: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private capacity = 0;

  constructor(private readonly gpu: GPU) {
    const gl = gpu.gl;
    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    const instances = gl.createBuffer();
    if (!vao || !quad || !instances) throw new Error('Failed to create dab geometry');
    this.vao = vao;
    this.quad = quad;
    this.instances = instances;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Accumulates dabs into `target` (coverage in .r) with flow build-up. */
  render(target: RenderTarget, dabs: readonly GpuDab[], hardness: number): void {
    if (dabs.length === 0) return;
    const gl = this.gpu.gl;
    const data = new Float32Array(dabs.length * 4);
    dabs.forEach((d, i) => data.set([d.x, d.y, d.radius, d.alpha], i * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (data.byteLength > this.capacity) {
      this.capacity = Math.max(data.byteLength, this.capacity * 2, 4096);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const program = this.gpu.program('dab', dabProgram).use();
    program.vec2('u_targetSize', target.width, target.height).float('u_hardness', hardness);
    target.bind();
    this.gpu.blendOver();
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dabs.length);
    gl.bindVertexArray(null);
    this.gpu.noBlend();
  }

  dispose(): void {
    const gl = this.gpu.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.instances);
  }
}
