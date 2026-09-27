import type { GPU } from '../gl/gpu';
import type { ViewTransform } from '../view/viewMath';
import { documentDisplayProgram, marchingAntsProgram } from './shaders/display';

/** A coverage map (selection or mask) placed in document space. */
export interface PlacedCoverage {
  texture: WebGLTexture;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 */
  defaultValue: number;
}

export interface DisplayOptions {
  /** Pasteboard colour (0..1 RGB) behind the document. */
  pasteboard: readonly [number, number, number];
  checkA: readonly [number, number, number];
  checkB: readonly [number, number, number];
  /** Checker square size in device pixels. */
  checkSize: number;
  pixelGrid: boolean;
  /** Visualise a layer mask instead of / over the composite. */
  maskView?: { mode: 'grayscale' | 'overlay'; mask: PlacedCoverage } | null;
  /** Selection to outline with marching ants. */
  selection?: PlacedCoverage | null;
  /** Animation phase for the ants. */
  antsPhase?: number;
  dpr?: number;
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
    const maskView = options.maskView;
    this.gpu.bindTexture(1, maskView ? maskView.mask.texture : this.gpu.dummyR8);
    program
      .int('u_mask', 1)
      .int('u_maskView', maskView ? (maskView.mode === 'grayscale' ? 1 : 2) : 0)
      .vec4('u_maskRect', maskView?.mask.x ?? 0, maskView?.mask.y ?? 0, maskView?.mask.width ?? 0, maskView?.mask.height ?? 0)
      .float('u_maskDefault', maskView?.mask.defaultValue ?? 1);
    this.gpu.noBlend();
    this.gpu.quad.draw();
    this.gpu.bindTexture(0, null);
    this.gpu.bindTexture(1, null);

    const sel = options.selection;
    if (sel) {
      const ants = this.gpu.program('marchingAnts', marchingAntsProgram).use();
      this.gpu.bindTexture(0, sel.texture);
      ants
        .int('u_sel', 0)
        .vec4('u_selRect', sel.x, sel.y, sel.width, sel.height)
        .float('u_selDefault', sel.defaultValue)
        .vec2('u_docSize', composite.width, composite.height)
        .vec3('u_view', view.zoom, view.panX, view.panY)
        .float('u_time', options.antsPhase ?? 0)
        .float('u_dash', 4 * (options.dpr ?? 1))
        // Cover the document plus a one-pixel margin so edges at the canvas border show.
        .vec4('u_dst', view.panX - 2, view.panY - 2, composite.width * view.zoom + 4, composite.height * view.zoom + 4)
        .vec2('u_canvasSize', canvasWidth, canvasHeight);
      this.gpu.quad.draw();
      this.gpu.bindTexture(0, null);
    }
  }
}
