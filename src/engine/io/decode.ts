/** Image decoding for import (files, clipboard, drag & drop). */

export const IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/svg+xml';

export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

export function isImageFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(file.name);
}

/** File name without extension, used for document and layer names. */
export function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file) || 'Untitled';
}

/**
 * Decodes an image blob into an ImageBitmap in sRGB with EXIF orientation applied.
 * Embedded colour profiles (Adobe RGB, Display P3, …) are converted to sRGB by the
 * browser, which is the document's working space.
 */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      colorSpaceConversion: 'default',
      imageOrientation: 'from-image',
      premultiplyAlpha: 'default',
    });
  } catch {
    // Some formats (notably SVG) only decode through an <img> element.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      if (img.naturalWidth === 0 || img.naturalHeight === 0) throw new Error('empty image');
      return await createImageBitmap(img);
    } catch {
      throw new ImageDecodeError(
        blob.type ? `This browser cannot decode "${blob.type}" images.` : 'The file is not a supported image.',
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Resizes a bitmap to fit within max×max, preserving aspect ratio (high-quality resampling). */
export async function downscaleBitmap(bitmap: ImageBitmap, max: number): Promise<ImageBitmap> {
  const s = Math.min(max / bitmap.width, max / bitmap.height, 1);
  if (s >= 1) return bitmap;
  const width = Math.max(1, Math.floor(bitmap.width * s));
  const height = Math.max(1, Math.floor(bitmap.height * s));
  const resized = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  bitmap.close();
  return resized;
}

/** Extracts image files from a clipboard or drag-and-drop DataTransfer. */
export function imageFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) if (isImageFile(f)) files.push(f);
  }
  if (files.length === 0 && dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}
