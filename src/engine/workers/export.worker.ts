/// <reference lib="webworker" />
import { encodePng, setJpegDensity } from '../io/png';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportRequest {
  id: number;
  format: ExportFormat;
  width: number;
  height: number;
  /** Straight (un-premultiplied) RGBA8. */
  data: Uint8Array;
  /** 1..100 (JPEG/WebP). */
  quality: number;
  dpi: number;
}

export type ExportResponse = { id: number; bytes: Uint8Array; type: string } | { id: number; error: string };

const MIME: Record<ExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, format, width, height, data, quality, dpi } = e.data;
  const post = (msg: ExportResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    let bytes: Uint8Array;
    if (format === 'png') {
      bytes = await encodePng(width, height, data, { dpi });
    } else {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable in this browser');
      const clamped = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: MIME[format], quality: quality / 100 });
      // Browsers without an encoder silently fall back to PNG.
      if (blob.type !== MIME[format]) throw new Error(`This browser cannot encode ${format.toUpperCase()} images.`);
      bytes = new Uint8Array(await blob.arrayBuffer());
      if (format === 'jpeg') bytes = setJpegDensity(bytes, dpi);
    }
    post({ id, bytes, type: MIME[format] }, [bytes.buffer]);
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
