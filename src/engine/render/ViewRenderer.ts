import type { GPU } from '../gl/gpu';
import type { ViewTransform } from '../view/viewMath';
import { documentDisplayProgram } from './shaders/display';

export interface DisplayOptions {
  /** Pasteboard colour (0..1 RGB) behind the document. */
  pasteboard: readonly [number, number, number];
  checkA: readonly [number, number, number];
  checkB: readonly [number, number, number];
  /** Checker square size in device pixels. */
  checkSize: number;
  pixelGrid: boolean;
}

/** Draws the document composite into the on-screen canvas with the current view. */
export class ViewRenderer {
  constructor(private readonly gpu: GPU) {}

  render(
    canvasWidth: number,
    canvasHeight: number,
    view: ViewTransform,
    composite: { texture: WebGLTexture; width: number; height: number } | null,
    options: DisplayOptions,
  ): void {
    const gl = this.gpu.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(options.pasteboard[0], options.pasteboard[1], options.pasteboard[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!composite) return;

    const nearest = view.zoom >= 1;
    const program = this.gpu.program(`display:${nearest ? 'nearest' : 'mip'}`, () =>
      documentDisplayProgram(nearest),
    );
    program.use();
    this.gpu.bindTexture(0, composite.texture, nearest ? this.gpu.samplers.nearest : this.gpu.samplers.linearMip);
    program
      .int('u_image', 0)
      .vec2('u_docSize', composite.width, composite.height)
      .vec3('u_view', view.zoom, view.panX, view.panY)
      .float('u_checkSize', options.checkSize)
      .vec3('u_checkA', options.checkA[0], options.checkA[1], options.checkA[2])
      .vec3('u_checkB', options.checkB[0], options.checkB[1], options.checkB[2])
      .float('u_pixelGrid', options.pixelGrid && view.zoom >= 8 ? 0.22 : 0)
      .vec4('u_dst', view.panX, view.panY, composite.width * view.zoom, composite.height * view.zoom)
      .vec2('u_canvasSize', canvasWidth, canvasHeight);
    this.gpu.noBlend();
    this.gpu.quad.draw();
    this.gpu.bindTexture(0, null);
  }
}
