import { filterRows, unfilterRows } from './png';

/**
 * Lossless storage encoding for surfaces in saved projects: PNG-style adaptive row
 * filters (which turn smooth photographic data into small numbers) followed by
 * deflate. Pixels are stored exactly as the GPU holds them (premultiplied RGBA8 or
 * R8), so a save/open round trip is bit-exact and needs no colour conversion.
 */

async function pipe(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function packSurface(pixels: Uint8Array, width: number, height: number, bpp: 1 | 4): Promise<Uint8Array> {
  if (pixels.length !== width * height * bpp) throw new Error('Surface data does not match its size');
  return pipe(filterRows(pixels, width, height, bpp), new CompressionStream('deflate-raw'));
}

export async function unpackSurface(packed: Uint8Array, width: number, height: number, bpp: 1 | 4): Promise<Uint8Array> {
  return unfilterRows(await pipe(packed, new DecompressionStream('deflate-raw')), width, height, bpp);
}
