import { describe, expect, it } from 'vitest';
import { encodePng, setJpegDensity } from './png';

interface Chunk {
  type: string;
  data: Uint8Array;
}

function chunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let o = 8;
  while (o < png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reverses PNG row filters. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr;
      out[y * stride + i] = (x + pred) & 0xff;
    }
  }
  return out;
}

function testImage(width: number, height: number, alpha: (x: number, y: number) => number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      px.set([(x * 37 + y * 11) & 255, (x * 5 + y * 71) & 255, (x * y * 3) & 255, alpha(x, y)], i);
    }
  }
  return px;
}

describe('PNG encoder', () => {
  it('round-trips RGBA pixels exactly and records sRGB and resolution', async () => {
    const px = testImage(23, 17, (x, y) => (x + y) % 3 === 0 ? 0 : 128 + x);
    const png = await encodePng(23, 17, px, { dpi: 300 });
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const cs = chunks(png);
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
    const ihdr = new DataView(cs[0]!.data.buffer, cs[0]!.data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), cs[0]!.data[8], cs[0]!.data[9]]).toEqual([23, 17, 8, 6]);
    const phys = new DataView(cs[2]!.data.buffer, cs[2]!.data.byteOffset);
    expect(phys.getUint32(0)).toBe(Math.round(300 / 0.0254));
    const raw = await inflate(cs[3]!.data);
    expect(Array.from(unfilter(raw, 23, 17, 4))).toEqual(Array.from(px));
  });

  it('writes opaque images as RGB', async () => {
    const px = testImage(9, 5, () => 255);
    const png = await encodePng(9, 5, px);
    const cs = chunks(png);
    expect(cs[0]!.data[9]).toBe(2);
    expect(cs.some((c) => c.type === 'pHYs')).toBe(false);
    const rgb = unfilter(await inflate(cs.find((c) => c.type === 'IDAT')!.data), 9, 5, 3);
    for (let i = 0; i < 45; i++) expect([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]).toEqual([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  });

  it('rejects mismatched data', async () => {
    await expect(encodePng(2, 2, new Uint8Array(3))).rejects.toThrow();
  });
});

describe('JPEG density', () => {
  it('patches the JFIF header, leaves other data alone', () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const out = setJpegDensity(jfif, 300);
    expect(Array.from(out.subarray(13, 18))).toEqual([1, 1, 44, 1, 44]);
    expect(jfif[13]).toBe(0);
    const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, 0x45, 0x78, 0x69, 0x66, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(setJpegDensity(exif, 300)).toBe(exif);
  });
});
