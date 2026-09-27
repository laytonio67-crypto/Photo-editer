/**
 * Independent CPU reference for blend modes (W3C Compositing & Blending Level 1, with
 * Photoshop's Soft Light and extra modes). Colours are 0..1 RGB triples.
 */
export type RGB3 = [number, number, number];

const lum = (c: RGB3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: RGB3): RGB3 {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB3;
  return out;
}

const setLum = (c: RGB3, l: number): RGB3 => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};

const sat = (c: RGB3) => Math.max(...c) - Math.min(...c);

function setSat(c: RGB3, s: number): RGB3 {
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  if (mx === mn) return [0, 0, 0];
  return c.map((v) => ((v - mn) * s) / (mx - mn)) as RGB3;
}

const colorDodge = (b: number, s: number) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const colorBurn = (b: number, s: number) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const hardLight = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1));
const softLightPS = (b: number, s: number) =>
  s <= 0.5 ? 2 * b * s + b * b * (1 - 2 * s) : 2 * b * (1 - s) + Math.sqrt(b) * (2 * s - 1);

const SEPARABLE: Record<string, (b: number, s: number) => number> = {
  normal: (_b, s) => s,
  darken: Math.min,
  multiply: (b, s) => b * s,
  colorBurn,
  linearBurn: (b, s) => Math.max(0, b + s - 1),
  lighten: Math.max,
  screen: (b, s) => b + s - b * s,
  colorDodge,
  linearDodge: (b, s) => Math.min(1, b + s),
  overlay: (b, s) => hardLight(s, b),
  softLight: softLightPS,
  hardLight,
  vividLight: (b, s) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5))),
  linearLight: (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
  pinLight: (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 0.5))),
  hardMix: (b, s) => (b + s >= 1 ? 1 : 0),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s)),
};

export function blendReference(mode: string, cb: RGB3, cs: RGB3): RGB3 {
  const f = SEPARABLE[mode];
  if (f) return [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
  switch (mode) {
    case 'darkerColor':
      return lum(cs) < lum(cb) ? cs : cb;
    case 'lighterColor':
      return lum(cs) > lum(cb) ? cs : cb;
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':
      return setLum(cs, lum(cb));
    case 'luminosity':
      return setLum(cb, lum(cs));
  }
  throw new Error(`No reference for ${mode}`);
}
