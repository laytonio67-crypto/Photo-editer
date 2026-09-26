import { encodePNG } from './png';

/**
 * Deterministic test images. `photo` imitates a photograph (smooth gradients, shapes,
 * fine detail); `alphaQuadrants` has exactly known straight-alpha values.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function photoPixels(width: number, height: number): Uint8Array {
  const rnd = mulberry32(42);
  const px = new Uint8Array(width * height * 4);
  const sunX = width * 0.7;
  const sunY = height * 0.3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = y / height;
      // Sky gradient to warm horizon, then darker ground.
      let r = 60 + 150 * t;
      let g = 110 + 80 * t;
      let b = 200 - 60 * t;
      if (y > height * 0.62) {
        const k = (y - height * 0.62) / (height * 0.38);
        r = 70 - 30 * k + 20 * Math.sin(x * 0.05);
        g = 90 - 30 * k + 15 * Math.sin(x * 0.03 + y * 0.02);
        b = 40 - 10 * k;
      }
      const d = Math.hypot(x - sunX, y - sunY);
      const sun = Math.max(0, 1 - d / (height * 0.12));
      r += 255 * sun;
      g += 220 * sun;
      b += 120 * sun;
      const n = (rnd() - 0.5) * 12; // sensor-like noise
      px[i] = Math.max(0, Math.min(255, Math.round(r + n)));
      px[i + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
      px[i + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
      px[i + 3] = 255;
    }
  }
  return px;
}

export function photoPNG(width = 640, height = 480): Buffer {
  return encodePNG(width, height, photoPixels(width, height));
}

/**
 * 64×64 quadrants (straight alpha): TL opaque red, TR green α=128, BL blue α=64,
 * BR fully transparent white.
 */
export function alphaQuadrantsPNG(): Buffer {
  const w = 64;
  const h = 64;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const right = x >= 32;
      const bottom = y >= 32;
      const v = !bottom && !right ? [255, 0, 0, 255] : !bottom ? [0, 255, 0, 128] : !right ? [0, 0, 255, 64] : [255, 255, 255, 0];
      px.set(v, i);
    }
  }
  return encodePNG(w, h, px);
}

/** Solid-colour PNG. */
export function solidPNG(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const px = new Uint8Array(width * height * 4);
  for (let i = 0; i < px.length; i += 4) px.set(rgba, i);
  return encodePNG(width, height, px);
}
