import type { Rect } from '../geometry';
import type { GPU } from '../gl/gpu';
import { RenderTarget } from '../gl/renderTarget';
import { readPixelsAsync } from '../gl/readback';
import { FRAGMENT_HEADER, REGION_VERTEX } from './shaders/common';

const BLOCK = 256;

/**
 * Column/row max-reduction: each output texel holds the maximum coverage over a
 * BLOCK-long run of source texels along one axis. Two small readbacks then give exact
 * content bounds without reading the whole surface.
 */
function reduceProgram(): { vertex: string; fragment: string } {
  return {
    vertex: REGION_VERTEX,
    fragment: `${FRAGMENT_HEADER}
uniform sampler2D u_src;
uniform ivec2 u_size;
uniform int u_axis;    // 0: reduce along y (per column), 1: reduce along x (per row)
uniform int u_channel; // 3: alpha, 0: red (masks)
in vec2 v_px;
out vec4 o;
void main() {
  ivec2 p = ivec2(v_px);
  float m = 0.0;
  for (int i = 0; i < ${BLOCK}; i++) {
    ivec2 q = u_axis == 0 ? ivec2(p.x, p.y * ${BLOCK} + i) : ivec2(p.x * ${BLOCK} + i, p.y);
    if (q.x >= u_size.x || q.y >= u_size.y) break;
    vec4 t = texelFetch(u_src, q, 0);
    m = max(m, u_channel == 3 ? t.a : t.r);
  }
  o = vec4(m, 0.0, 0.0, 1.0);
}
`,
  };
}

/**
 * Tight bounds (in surface pixel coordinates) of texels with non-zero coverage, or null
 * if the surface is empty. `channel` selects alpha (colour) or red (masks, where
 * `threshold` lets callers find where a mask differs from 0).
 */
export async function contentBounds(
  gpu: GPU,
  texture: WebGLTexture,
  width: number,
  height: number,
  channel: 'alpha' | 'red' = 'alpha',
): Promise<Rect | null> {
  const gl = gpu.gl;
  const colH = Math.ceil(height / BLOCK);
  const rowW = Math.ceil(width / BLOCK);
  const cols = new RenderTarget(gl, width, colH, 'rgba8');
  const rows = new RenderTarget(gl, rowW, height, 'rgba8');
  try {
    const program = gpu.program('alphaReduce', reduceProgram).use();
    gpu.bindTexture(0, texture);
    program.int('u_src', 0).ivec2('u_size', width, height).int('u_channel', channel === 'alpha' ? 3 : 0);
    gpu.noBlend();
    program.int('u_axis', 0);
    gpu.drawRect(program, cols, { x: 0, y: 0, width, height: colH });
    program.int('u_axis', 1);
    gpu.drawRect(program, rows, { x: 0, y: 0, width: rowW, height });
    gpu.bindTexture(0, null);
    const fmt = { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 };
    const [colData, rowData] = await Promise.all([
      readPixelsAsync(gl, cols.framebuffer, { x: 0, y: 0, width, height: colH }, fmt),
      readPixelsAsync(gl, rows.framebuffer, { x: 0, y: 0, width: rowW, height }, fmt),
    ]);
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < width; x++) {
      for (let j = 0; j < colH; j++) {
        if (colData[(j * width + x) * 4]! > 0) {
          if (x0 < 0) x0 = x;
          x1 = x;
          break;
        }
      }
    }
    if (x0 < 0) return null;
    let y0 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < rowW; i++) {
        if (rowData[(y * rowW + i) * 4]! > 0) {
          if (y0 < 0) y0 = y;
          y1 = y;
          break;
        }
      }
    }
    if (y0 < 0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  } finally {
    cols.dispose();
    rows.dispose();
  }
}
