/**
 * PNG encoder for exports. Unlike canvas.toBlob it is exact (no premultiplied-alpha
 * round trip), picks RGB or RGBA automatically, and records the document resolution
 * (pHYs) and sRGB colour space. Compression uses the platform's zlib (CompressionStream).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** Paeth predictor (PNG filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Applies the per-row filter that minimises the sum of absolute filtered values (the
 * usual heuristic for good deflate compression).
 */
export function filterRows(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array((stride + 1) * height);
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const dst = candidates[f]!;
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = row[i]!;
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        const v =
          f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c);
        const byte = v & 0xff;
        dst[i] = byte;
        score += byte < 128 ? byte : 256 - byte;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const o = y * (stride + 1);
    out[o] = best;
    // The winner may have stopped early while scoring: recompute it in full.
    const dst = out.subarray(o + 1, o + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const x = row[i]!;
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const v = best === 0 ? x : best === 1 ? x - a : best === 2 ? x - b : best === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c);
      dst[i] = v & 0xff;
    }
  }
  return out;
}

/** Reverses filterRows (PNG filter types 0–4). */
export function unfilterRows(filtered: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  if (filtered.length !== (stride + 1) * height) throw new Error('Filtered data does not match the image size');
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = filtered[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp]! : 0;
      const b = y > 0 ? out[row - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[row - stride + i - bpp]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out[row + i] = (filtered[src + i]! + pred) & 0xff;
    }
  }
  return out;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface PngOptions {
  /** Resolution stored in the pHYs chunk, in pixels per inch. */
  dpi?: number;
}

/** Encodes straight (un-premultiplied) RGBA8 pixels, top row first. */
export async function encodePng(width: number, height: number, rgba: Uint8Array, options: PngOptions = {}): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4) throw new Error('Pixel data does not match the image size');
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  let pixels = rgba;
  if (opaque) {
    pixels = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      pixels[j] = rgba[i]!;
      pixels[j + 1] = rgba[i + 1]!;
      pixels[j + 2] = rgba[i + 2]!;
    }
  }
  const idat = await zlib(filterRows(pixels, width, height, opaque ? 3 : 4));

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB / RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('sRGB', new Uint8Array([0]))];
  if (options.dpi && options.dpi > 0) {
    const phys = new Uint8Array(9);
    const pv = new DataView(phys.buffer);
    const ppm = Math.round(options.dpi / 0.0254);
    pv.setUint32(0, ppm);
    pv.setUint32(4, ppm);
    phys[8] = 1; // unit: metre
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Writes the resolution into a JPEG's JFIF header (browsers' encoders always write
 * 72 dpi or none). Returns the input unchanged when there is no JFIF APP0 segment.
 */
export function setJpegDensity(jpeg: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    jpeg.length > 18 &&
    jpeg[0] === 0xff &&
    jpeg[1] === 0xd8 &&
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    jpeg[6] === 0x4a && // J
    jpeg[7] === 0x46 && // F
    jpeg[8] === 0x49 && // I
    jpeg[9] === 0x46 && // F
    jpeg[10] === 0;
  if (!isJfif || !(dpi > 0)) return jpeg;
  const out = jpeg.slice();
  const d = Math.min(65535, Math.round(dpi));
  out[13] = 1; // units: dots per inch
  out[14] = d >> 8;
  out[15] = d & 0xff;
  out[16] = d >> 8;
  out[17] = d & 0xff;
  return out;
}
