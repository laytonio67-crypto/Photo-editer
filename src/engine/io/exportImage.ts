import type { Editor } from '../Editor';
import type { RGB } from '../doc/types';
import { readPixelsAsync } from '../gl/readback';
import { resampleTexture, type ResampleMode } from '../render/Resampler';
import type { ExportFormat, ExportRequest, ExportResponse } from '../workers/export.worker';

export type { ExportFormat };

export interface ExportSettings {
  format: ExportFormat;
  /** 1..100, JPEG/WebP only. */
  quality: number;
  width: number;
  height: number;
  resample: ResampleMode;
  /** Keep alpha (PNG/WebP). Otherwise transparent areas are filled with `matte`. */
  transparency: boolean;
  matte: RGB;
}

export interface ExportResult {
  bytes: Uint8Array;
  type: string;
  width: number;
  height: number;
}

export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/**
 * Converts premultiplied RGBA to straight RGBA, or flattens it onto an opaque matte.
 * Exported for tests.
 */
export function prepareExportPixels(premultiplied: Uint8Array, transparency: boolean, matte: RGB): Uint8Array {
  const out = new Uint8Array(premultiplied.length);
  const m = [matte.r, matte.g, matte.b];
  for (let i = 0; i < premultiplied.length; i += 4) {
    const a = premultiplied[i + 3]!;
    if (transparency) {
      if (a === 0) continue;
      for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, Math.round((premultiplied[i + k]! * 255) / a));
      out[i + 3] = a;
    } else {
      for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, Math.round(premultiplied[i + k]! + (m[k]! * (255 - a)) / 255));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** File name for an export of `docName` (characters file systems reject are removed). */
export function exportFileName(docName: string, format: ExportFormat): string {
  const base = docName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
  return `${base}.${FORMAT_EXTENSIONS[format]}`;
}

/**
 * Renders the document composite at the requested size and encodes it in a worker.
 * PNGs are encoded exactly by our own encoder; JPEG and WebP use the browser's.
 */
export class Exporter {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: ExportResponse) => void; reject: (e: Error) => void }>();
  private support = new Map<ExportFormat, Promise<boolean>>();

  constructor(private readonly editor: Editor) {}

  private getWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ExportResponse>) => {
        const entry = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        entry?.resolve(e.data);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        for (const entry of this.pending.values()) entry.reject(new Error(`Export worker failed: ${e.message}`));
        this.pending.clear();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private encode(request: Omit<ExportRequest, 'id'>): Promise<ExportResponse> {
    const worker = this.getWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id }, [request.data.buffer]);
    });
  }

  /** Whether the browser can encode `format` (PNG always; WebP is missing in some). */
  supports(format: ExportFormat): Promise<boolean> {
    if (format === 'png') return Promise.resolve(true);
    let p = this.support.get(format);
    if (!p) {
      p = this.encode({ format, width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), quality: 90, dpi: 72 })
        .then((r) => 'bytes' in r)
        .catch(() => false);
      this.support.set(format, p);
    }
    return p;
  }

  async render(settings: ExportSettings): Promise<ExportResult> {
    const editor = this.editor;
    const doc = editor.doc;
    if (!doc) throw new Error('No document to export');
    const { width, height } = settings;
    if (!(width >= 1 && height >= 1 && Number.isInteger(width) && Number.isInteger(height))) throw new Error('Invalid export size');
    if (width > editor.caps.maxDocumentSize || height > editor.caps.maxDocumentSize) {
      throw new Error(`Exports are limited to ${editor.caps.maxDocumentSize} px per side on this GPU.`);
    }
    editor.flush();
    const composite = editor.compositor.compositeTarget;
    if (!composite) throw new Error('Nothing to export');
    const gl = editor.gpu.gl;
    const fmt = { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 };
    let pixels: Promise<Uint8Array>;
    if (width === doc.width && height === doc.height) {
      pixels = readPixelsAsync(gl, composite.framebuffer, { x: 0, y: 0, width, height }, fmt);
    } else {
      const scaled = resampleTexture(editor.gpu, composite.texture, doc.width, doc.height, width, height, settings.resample);
      pixels = readPixelsAsync(gl, scaled.framebuffer, { x: 0, y: 0, width, height }, fmt);
      editor.gpu.pool.release(scaled);
    }
    const transparency = settings.transparency && settings.format !== 'jpeg';
    const data = prepareExportPixels(await pixels, transparency, settings.matte);
    const result = await this.encode({
      format: settings.format,
      width,
      height,
      data,
      quality: Math.max(1, Math.min(100, Math.round(settings.quality))),
      dpi: doc.resolution,
    });
    if ('error' in result) throw new Error(result.error);
    return { bytes: result.bytes, type: result.type, width, height };
  }

  /** Hands the file to the browser as a download. */
  download(result: ExportResult, fileName: string): void {
    const blob = new Blob([result.bytes as BlobPart], { type: result.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
