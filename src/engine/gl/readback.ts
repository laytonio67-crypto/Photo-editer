import type { Rect } from '../geometry';

export interface ReadFormat {
  format: number;
  type: number;
  bytesPerPixel: number;
}

function waitForSync(gl: WebGL2RenderingContext, sync: WebGLSync): Promise<void> {
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (gl.isContextLost()) {
        reject(new Error('WebGL context lost during readback'));
        return;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.WAIT_FAILED) {
        reject(new Error('GPU sync failed during readback'));
      } else if (status === gl.TIMEOUT_EXPIRED) {
        setTimeout(poll, 2);
      } else {
        resolve();
      }
    };
    poll();
  });
}

/**
 * Reads a framebuffer region without stalling the pipeline: pixels are copied into a
 * pixel-buffer object on the GPU timeline, and fetched to the CPU after a fence
 * signals. Because the copy is queued, callers may overwrite the source texture
 * immediately after this function returns (before the promise resolves).
 *
 * Rows are returned top-down in document order (framebuffer row 0 = document row 0).
 */
export function readPixelsAsync(
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  region: Rect,
  fmt: ReadFormat,
): Promise<Uint8Array> {
  const size = region.width * region.height * fmt.bytesPerPixel;
  const buffer = gl.createBuffer();
  if (!buffer) return Promise.reject(new Error('Failed to create readback buffer'));
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readPixels(region.x, region.y, region.width, region.height, fmt.format, fmt.type, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  if (!sync) {
    gl.deleteBuffer(buffer);
    return Promise.reject(new Error('Failed to create GPU fence'));
  }
  return waitForSync(gl, sync).then(
    () => {
      gl.deleteSync(sync);
      const out = new Uint8Array(size);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(buffer);
      return out;
    },
    (err: unknown) => {
      gl.deleteSync(sync);
      gl.deleteBuffer(buffer);
      throw err;
    },
  );
}

/** Synchronous readback for small regions (eyedropper, tests). Stalls the GPU pipeline. */
export function readPixelsSync(
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  region: Rect,
  fmt: ReadFormat,
): Uint8Array {
  const out = new Uint8Array(region.width * region.height * fmt.bytesPerPixel);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readPixels(region.x, region.y, region.width, region.height, fmt.format, fmt.type, out);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  return out;
}
