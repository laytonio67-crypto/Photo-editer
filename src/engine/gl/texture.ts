export type TextureFormat = 'rgba8' | 'r8' | 'rgba16f';

export interface FormatInfo {
  internalFormat: number;
  format: number;
  type: number;
  /** Bytes per pixel of CPU-side data in the upload/readback type. */
  bytesPerPixel: number;
}

export function formatInfo(gl: WebGL2RenderingContext, format: TextureFormat): FormatInfo {
  switch (format) {
    case 'rgba8':
      return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 };
    case 'r8':
      return { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, bytesPerPixel: 1 };
    case 'rgba16f':
      return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, bytesPerPixel: 8 };
  }
}

/** GPU memory estimate in bytes for a texture (mip chains add ~1/3). */
export function textureBytes(format: TextureFormat, width: number, height: number, mipmapped = false): number {
  const bpp = format === 'r8' ? 1 : format === 'rgba8' ? 4 : 8;
  const base = width * height * bpp;
  return mipmapped ? Math.ceil(base * (4 / 3)) : base;
}

export function mipLevelCount(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Allocates immutable texture storage. Filtering defaults to NEAREST/CLAMP; draws that
 * need interpolation use sampler objects, so a texture never changes filter state.
 */
export function createTexture(
  gl: WebGL2RenderingContext,
  format: TextureFormat,
  width: number,
  height: number,
  levels = 1,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to allocate texture (GPU out of memory?)');
  const info = formatInfo(gl, format);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, info.internalFormat, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const err = gl.getError();
  if (err === gl.OUT_OF_MEMORY) {
    gl.deleteTexture(tex);
    throw new Error(`GPU out of memory allocating ${width}×${height} ${format} texture`);
  }
  return tex;
}

export interface Samplers {
  nearest: WebGLSampler;
  linear: WebGLSampler;
  /** Trilinear, for minified display of mipmapped textures. */
  linearMip: WebGLSampler;
}

export function createSamplers(gl: WebGL2RenderingContext): Samplers {
  const make = (min: number, mag: number): WebGLSampler => {
    const s = gl.createSampler();
    if (!s) throw new Error('Failed to create sampler');
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  };
  return {
    nearest: make(gl.NEAREST, gl.NEAREST),
    linear: make(gl.LINEAR, gl.LINEAR),
    linearMip: make(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR),
  };
}

/** Binds `texture` (with optional sampler) to a texture unit. */
export function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture | null,
  sampler: WebGLSampler | null = null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindSampler(unit, sampler);
}
