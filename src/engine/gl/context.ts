export interface GLCaps {
  maxTextureSize: number;
  /** Largest document side we allow (bounded by GPU and a sane memory ceiling). */
  maxDocumentSize: number;
  /** RGBA16F render targets are available (EXT_color_buffer_float/half_float). */
  halfFloatRenderable: boolean;
  renderer: string;
}

export class WebGLUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

/**
 * Creates the single WebGL2 context used for both document compositing (offscreen
 * framebuffers) and on-screen display (default framebuffer).
 */
export function createGL(canvas: HTMLCanvasElement): { gl: WebGL2RenderingContext; caps: GLCaps } {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    throw new WebGLUnavailableError(
      'WebGL 2 is not available. Emulsion needs a browser with hardware-accelerated WebGL 2 ' +
        '(current Chrome, Edge, Firefox or Safari). Check that hardware acceleration is enabled.',
    );
  }
  const halfFloatRenderable =
    gl.getExtension('EXT_color_buffer_float') !== null || gl.getExtension('EXT_color_buffer_half_float') !== null;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const maxDocumentSize = Math.min(
    maxTextureSize,
    maxRenderbuffer,
    maxViewport[0] ?? maxTextureSize,
    maxViewport[1] ?? maxTextureSize,
    16384,
  );

  // Pixel data is tightly packed everywhere (R8 rows are not 4-byte aligned).
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

  return { gl, caps: { maxTextureSize, maxDocumentSize, halfFloatRenderable, renderer } };
}
