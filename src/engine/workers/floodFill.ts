/**
 * Magic-wand region growing on premultiplied RGBA pixels. Pure function so it can run in
 * a worker and in unit tests.
 *
 * A pixel matches when every channel of its straight (un-premultiplied) colour and its
 * alpha are within `tolerance` (0..255) of the seed pixel. Contiguous mode grows a
 * 4-connected region with a scanline fill; otherwise every matching pixel is selected.
 */
export function magicWandMask(
  data: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
  contiguous: boolean,
): { mask: Uint8Array; bounds: { x: number; y: number; width: number; height: number } | null } {
  const mask = new Uint8Array(width * height);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return { mask, bounds: null };
  const straight = (i: number): [number, number, number, number] => {
    const a = data[i + 3]!;
    if (a === 0) return [0, 0, 0, 0];
    const k = 255 / a;
    return [data[i]! * k, data[i + 1]! * k, data[i + 2]! * k, a];
  };
  const seed = straight((seedY * width + seedX) * 4);
  const matches = (p: number): boolean => {
    const c = straight(p * 4);
    // Fully transparent pixels only match transparent seeds (their colour is undefined).
    if (seed[3] === 0 || c[3] === 0) return Math.abs(c[3] - seed[3]) <= tolerance;
    return (
      Math.abs(c[0] - seed[0]) <= tolerance &&
      Math.abs(c[1] - seed[1]) <= tolerance &&
      Math.abs(c[2] - seed[2]) <= tolerance &&
      Math.abs(c[3] - seed[3]) <= tolerance
    );
  };
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const mark = (p: number): void => {
    mask[p] = 255;
    const x = p % width;
    const y = (p - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  if (!contiguous) {
    for (let p = 0; p < width * height; p++) if (matches(p)) mark(p);
  } else {
    // Scanline flood fill: fill whole horizontal runs, queue seeds above/below.
    const visited = new Uint8Array(width * height);
    const stack: number[] = [seedY * width + seedX];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (visited[p]) continue;
      const y = Math.floor(p / width);
      let left = p;
      while (left % width > 0 && !visited[left - 1] && matches(left - 1)) left--;
      let right = p;
      while (right % width < width - 1 && !visited[right + 1] && matches(right + 1)) right++;
      if (!matches(p)) {
        visited[p] = 1;
        continue;
      }
      for (let q = left; q <= right; q++) {
        visited[q] = 1;
        mark(q);
        if (y > 0 && !visited[q - width] && matches(q - width)) stack.push(q - width);
        if (y < height - 1 && !visited[q + width] && matches(q + width)) stack.push(q + width);
      }
    }
  }
  return {
    mask,
    bounds: x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
  };
}
