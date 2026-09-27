import { expect, test, type Page } from '@playwright/test';
import { applyPointwise, applyShadowsHighlights, type RGB3 } from '../src/engine/adjustments/math';
import type { Adjustment } from '../src/engine/adjustments/types';
import { compositePixel, docInfo, expectNoProblems, openApp, patchLayer, settle } from './helpers';

// ------------------------------------------------------------------ helpers

/** Deterministic, varied opaque colours including black, white, grey and primaries. */
function swatch(count: number): RGB3[] {
  const fixed: RGB3[] = [
    [0, 0, 0],
    [255, 255, 255],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [40, 40, 40],
  ];
  const out: RGB3[] = [...fixed];
  for (let i = fixed.length; i < count; i++) out.push([(i * 53 + 17) & 255, (i * 97 + 101) & 255, (i * 151 + 37) & 255]);
  return out;
}

/** New document whose only layer contains `pixels` (straight RGB, opaque), row by row. */
async function buildImageDoc(page: Page, width: number, height: number, pixels: RGB3[]): Promise<string> {
  return page.evaluate(
    ({ width, height, pixels }) => {
      const ed = (window as any).__emulsion;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d')!;
      const img = g.createImageData(width, height);
      pixels.forEach((p, i) => img.data.set([p[0], p[1], p[2], 255], i * 4));
      g.putImageData(img, 0, 0);
      ed.newDocument({ name: 'Test', width, height, resolution: 72, background: 'transparent' });
      const surface = ed.surfaces.createFromImage(c);
      const id = 'image_layer';
      ed.commit('Build', (d: any) => ({
        ...d,
        layers: [
          {
            id,
            type: 'pixel',
            name: 'Image',
            visible: true,
            opacity: 1,
            blendMode: 'normal',
            locks: { transparency: false, pixels: false, position: false },
            mask: null,
            clipped: false,
            surfaceId: surface.id,
            x: 0,
            y: 0,
          },
        ],
        activeLayerId: id,
        selectedLayerIds: [id],
      }));
      return id;
    },
    { width, height, pixels },
  );
}

/** Adds a layer described by a plain object on top of the stack (or inside `parentId`). */
async function addLayerObject(page: Page, layer: Record<string, unknown>, parentId?: string): Promise<void> {
  await page.evaluate(
    ({ layer, parentId }) => {
      const ed = (window as any).__emulsion;
      const full: Record<string, any> = {
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locks: { transparency: false, pixels: false, position: false },
        mask: null,
        clipped: false,
        ...layer,
      };
      const insert = (layers: any[]): any[] =>
        parentId
          ? layers.map((l) => (l.id === parentId ? { ...l, children: [...l.children, full] } : l.children ? { ...l, children: insert(l.children) } : l))
          : [...layers, full];
      ed.commit('Add', (d: any) => ({ ...d, layers: insert(d.layers), activeLayerId: full.id, selectedLayerIds: [full.id] }));
    },
    { layer, parentId },
  );
}

async function addAdjustment(page: Page, id: string, adjustment: Adjustment, extra: Record<string, unknown> = {}, parentId?: string) {
  await addLayerObject(page, { id, type: 'adjustment', name: id, adjustment, ...extra }, parentId);
}

/** Solid-colour pixel layer object (surface created in the page). */
async function addSolid(page: Page, id: string, color: RGB3, rect: [number, number, number, number], extra: Record<string, unknown> = {}, parentId?: string) {
  const surfaceId = await page.evaluate(
    ({ color, rect }) => {
      const ed = (window as any).__emulsion;
      const c = document.createElement('canvas');
      c.width = rect[2];
      c.height = rect[3];
      const g = c.getContext('2d')!;
      g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      g.fillRect(0, 0, rect[2], rect[3]);
      return ed.surfaces.createFromImage(c).id as string;
    },
    { color, rect },
  );
  await addLayerObject(page, { id, type: 'pixel', name: id, surfaceId, x: rect[0], y: rect[1], ...extra }, parentId);
}

async function readAll(page: Page, width: number, height: number): Promise<number[]> {
  return page.evaluate(({ width, height }) => Array.from((window as any).__emulsion.readComposite({ x: 0, y: 0, width, height })), {
    width,
    height,
  });
}

function to8(c: RGB3): RGB3 {
  return c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)) as RGB3;
}

function maxError(actual: number[], expected: RGB3[]): { error: number; at: number } {
  let error = 0;
  let at = -1;
  expected.forEach((e, i) => {
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(actual[i * 4 + k]! - e[k]!);
      if (d > error) {
        error = d;
        at = i;
      }
    }
  });
  return { error, at };
}

/** 1-D Gaussian blur with clamp-to-edge, matching the renderer's discrete kernel. */
function blur1d(values: number[], sigma: number): number[] {
  const reach = Math.ceil(sigma * 3) + 1;
  const w: number[] = [];
  for (let i = 0; i <= reach; i++) w.push(Math.exp((-i * i) / (2 * sigma * sigma)));
  const total = w[0]! + 2 * w.slice(1).reduce((a, b) => a + b, 0);
  return values.map((_, x) => {
    let sum = 0;
    for (let i = -reach; i <= reach; i++) {
      const xi = Math.min(values.length - 1, Math.max(0, x + i));
      sum += values[xi]! * w[Math.abs(i)]!;
    }
    return sum / total;
  });
}

// ------------------------------------------------------------------ tests

const POINTWISE_CASES: { name: string; adj: Adjustment }[] = [
  { name: 'brightness/contrast', adj: { kind: 'brightnessContrast', brightness: 45, contrast: 35 } },
  { name: 'darker, flatter', adj: { kind: 'brightnessContrast', brightness: -60, contrast: -40 } },
  { name: 'exposure', adj: { kind: 'exposure', exposure: 1.2, offset: 0.02, gamma: 0.9 } },
  {
    name: 'levels',
    adj: {
      kind: 'levels',
      rgb: { inBlack: 20, inWhite: 230, gamma: 1.3, outBlack: 10, outWhite: 245 },
      r: { inBlack: 0, inWhite: 255, gamma: 0.8, outBlack: 0, outWhite: 255 },
      g: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
      b: { inBlack: 12, inWhite: 250, gamma: 1, outBlack: 0, outWhite: 240 },
    },
  },
  {
    name: 'curves',
    adj: {
      kind: 'curves',
      rgb: [
        { x: 0, y: 0 },
        { x: 64, y: 40 },
        { x: 192, y: 220 },
        { x: 255, y: 255 },
      ],
      r: [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ],
      g: [
        { x: 0, y: 20 },
        { x: 255, y: 235 },
      ],
      b: [
        { x: 0, y: 0 },
        { x: 128, y: 150 },
        { x: 255, y: 255 },
      ],
    },
  },
  { name: 'hue/saturation', adj: { kind: 'hueSaturation', hue: 40, saturation: 30, lightness: -10, colorize: false } },
  { name: 'colorize', adj: { kind: 'hueSaturation', hue: -160, saturation: 50, lightness: 10, colorize: true } },
  { name: 'vibrance', adj: { kind: 'vibrance', vibrance: 60, saturation: -20 } },
  { name: 'white balance', adj: { kind: 'whiteBalance', temperature: 35, tint: -20 } },
  { name: 'black & white', adj: { kind: 'blackWhite', reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 } },
];

test.describe('Phase 4: adjustment engine', () => {
  test('point-wise adjustments match the CPU reference', async ({ page }) => {
    const app = await openApp(page);
    const pixels = swatch(256);
    await buildImageDoc(page, 16, 16, pixels);
    await addAdjustment(page, 'adj', POINTWISE_CASES[0]!.adj);
    for (const { name, adj } of POINTWISE_CASES) {
      await patchLayer(page, 'adj', { adjustment: adj });
      const actual = await readAll(page, 16, 16);
      const expected = pixels.map((p) => to8(applyPointwise(adj, [p[0] / 255, p[1] / 255, p[2] / 255])));
      const { error, at } = maxError(actual, expected);
      expect(error, `${name}: pixel ${at} ${pixels[at]} → ${actual.slice(at * 4, at * 4 + 3)} vs ${expected[at]}`).toBeLessThanOrEqual(2);
    }
    expectNoProblems(app);
  });

  test('opacity, blend mode, mask and visibility of adjustment layers', async ({ page }) => {
    const app = await openApp(page);
    const pixels = swatch(64);
    await buildImageDoc(page, 8, 8, pixels);
    const adj: Adjustment = { kind: 'hueSaturation', hue: 90, saturation: 0, lightness: 0, colorize: false };
    await addAdjustment(page, 'adj', adj, { opacity: 0.5 });
    let actual = await readAll(page, 8, 8);
    let expected = pixels.map((p) => {
      const a = applyPointwise(adj, [p[0] / 255, p[1] / 255, p[2] / 255]);
      return to8([0, 1, 2].map((k) => p[k]! / 255 + (a[k]! - p[k]! / 255) * 0.5) as RGB3);
    });
    expect(maxError(actual, expected).error).toBeLessThanOrEqual(2);

    // Luminosity mode keeps the original colour's hue: a hue rotation has little effect.
    await patchLayer(page, 'adj', { opacity: 1, blendMode: 'luminosity' });
    const lum = await readAll(page, 8, 8);
    await patchLayer(page, 'adj', { blendMode: 'normal' });
    const normal = await readAll(page, 8, 8);
    const diff = (a: number[], b: RGB3[]) => maxError(a, b).error;
    expect(diff(lum, pixels)).toBeLessThan(diff(normal, pixels));

    // A mask hiding the left half limits the adjustment to the right half.
    await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      const s = ed.surfaces.createBlank(4, 8, 'r8', [1, 0, 0, 1]);
      const mask = { surfaceId: s.id, x: 4, y: 0, defaultValue: 0, enabled: true, linked: true };
      ed.commit('Mask', (d: any) => ({ ...d, layers: d.layers.map((l: any) => (l.id === 'adj' ? { ...l, mask } : l)) }));
    });
    actual = await readAll(page, 8, 8);
    expected = pixels.map((p, i) => (i % 8 < 4 ? p : to8(applyPointwise(adj, [p[0] / 255, p[1] / 255, p[2] / 255]))));
    expect(maxError(actual, expected).error).toBeLessThanOrEqual(2);

    await patchLayer(page, 'adj', { visible: false });
    expect(maxError(await readAll(page, 8, 8), pixels).error).toBe(0);
    expectNoProblems(app);
  });

  test('adjustments inside groups respect isolation; undo restores the image', async ({ page }) => {
    const app = await openApp(page);
    await page.evaluate(() => (window as any).__emulsion.newDocument({ name: 'G', width: 20, height: 10, resolution: 72, background: 'transparent' }));
    await addSolid(page, 'red', [200, 40, 40], [0, 0, 20, 10]);
    await addLayerObject(page, { id: 'grp', type: 'group', name: 'Group', blendMode: 'normal', children: [], expanded: true });
    await addSolid(page, 'green', [40, 200, 40], [10, 0, 10, 10], {}, 'grp');
    const blacken: Adjustment = { kind: 'hueSaturation', hue: 0, saturation: 0, lightness: -100, colorize: false };
    await addAdjustment(page, 'dark', blacken, {}, 'grp');
    // Isolated group: only the group's own content goes black.
    expect(await compositePixel(page, 15, 5)).toEqual([0, 0, 0, 255]);
    expect(await compositePixel(page, 5, 5)).toEqual([200, 40, 40, 255]);
    // Pass-through: the adjustment reaches the layers below the group.
    await patchLayer(page, 'grp', { blendMode: 'passThrough' });
    expect(await compositePixel(page, 5, 5)).toEqual([0, 0, 0, 255]);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await compositePixel(page, 5, 5)).toEqual([200, 40, 40, 255]);
    expectNoProblems(app);
  });

  test('clipping masks: base shape, base opacity, hidden base, clipped adjustments', async ({ page }) => {
    const app = await openApp(page);
    await page.evaluate(() => (window as any).__emulsion.newDocument({ name: 'C', width: 40, height: 40, resolution: 72, background: 'transparent' }));
    await addSolid(page, 'bg', [250, 250, 250], [0, 0, 40, 40]);
    await addSolid(page, 'base', [220, 30, 30], [10, 10, 20, 20]);
    await addSolid(page, 'clip', [30, 30, 220], [0, 0, 40, 40], { clipped: true });
    expect(await compositePixel(page, 20, 20)).toEqual([30, 30, 220, 255]);
    expect(await compositePixel(page, 5, 5)).toEqual([250, 250, 250, 255]);

    await patchLayer(page, 'base', { opacity: 0.5 });
    const half = await compositePixel(page, 20, 20);
    expect(Math.abs(half[0]! - 140)).toBeLessThanOrEqual(2);
    expect(Math.abs(half[2]! - 235)).toBeLessThanOrEqual(2);
    await patchLayer(page, 'base', { opacity: 1 });

    await patchLayer(page, 'base', { visible: false });
    expect(await compositePixel(page, 20, 20)).toEqual([250, 250, 250, 255]);
    await patchLayer(page, 'base', { visible: true });

    // A clipped adjustment only changes the base.
    await patchLayer(page, 'clip', { visible: false });
    await addAdjustment(page, 'dark', { kind: 'hueSaturation', hue: 0, saturation: 0, lightness: -100, colorize: false }, { clipped: true });
    expect(await compositePixel(page, 20, 20)).toEqual([0, 0, 0, 255]);
    expect(await compositePixel(page, 5, 5)).toEqual([250, 250, 250, 255]);

    // Release via the command: the adjustment then darkens everything below it.
    await page.keyboard.press('Control+Alt+g');
    await settle(page);
    expect(await compositePixel(page, 5, 5)).toEqual([0, 0, 0, 255]);
    expectNoProblems(app);
  });

  test('Gaussian blur matches a CPU reference, across tile borders and partial updates', async ({ page }) => {
    const app = await openApp(page);
    const width = 1100;
    const height = 6;
    const column = (x: number) => ((x * 37) % 256 > 128 ? 230 : 20);
    const pixels: RGB3[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.push([column(x), column(x), column(x)]);
    await buildImageDoc(page, width, height, pixels);
    const sigma = 2.5;
    await addAdjustment(page, 'blur', { kind: 'gaussianBlur', radius: sigma });
    const check = async (values: number[], label: string) => {
      const expectedRow = blur1d(values, sigma).map((v) => Math.round(v));
      const actual = await readAll(page, width, height);
      let worst = 0;
      let at = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = Math.abs(actual[(y * width + x) * 4]! - expectedRow[x]!);
          if (d > worst) {
            worst = d;
            at = x;
          }
        }
      }
      expect(worst, `${label}: column ${at}`).toBeLessThanOrEqual(2);
    };
    const base = Array.from({ length: width }, (_, x) => column(x));
    await check(base, 'full render');

    // A change under the blur near the tile border re-renders with enough margin.
    await addSolid(page, 'patch', [255, 255, 255], [1018, 0, 12, height]);
    await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      // Move the patch below the blur layer.
      ed.commit('Reorder', (d: any) => {
        const [img, blur, patch] = d.layers;
        return { ...d, layers: [img, patch, blur] };
      });
    });
    await check(base.map((v, x) => (x >= 1018 && x < 1030 ? 255 : v)), 'partial update');
    expectNoProblems(app);
  });

  test('sharpen raises edge contrast; shadows/highlights lifts shadows', async ({ page }) => {
    const app = await openApp(page);
    const width = 40;
    const pixels: RGB3[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < width; x++) pixels.push(x < 20 ? [60, 60, 60] : [180, 180, 180]);
    await buildImageDoc(page, width, 4, pixels);
    await addAdjustment(page, 'sharp', { kind: 'sharpen', amount: 150, radius: 1.5, threshold: 0 });
    const row = async () => (await readAll(page, width, 4)).filter((_, i) => i % 4 === 0).slice(0, width);
    let r = await row();
    expect(r[19]!).toBeLessThan(60);
    expect(r[20]!).toBeGreaterThan(180);
    expect(r[2]).toBe(60);
    expect(r[37]).toBe(180);
    // A threshold above the edge difference disables sharpening.
    await patchLayer(page, 'sharp', { adjustment: { kind: 'sharpen', amount: 150, radius: 1.5, threshold: 200 } });
    r = await row();
    expect(r[19]).toBe(60);

    // In flat areas the neighbourhood luminance equals the pixel's own.
    const sh = (v: number, shadows: number, highlights: number) =>
      to8(applyShadowsHighlights([v / 255, v / 255, v / 255], v / 255, shadows, highlights))[0];
    await patchLayer(page, 'sharp', { adjustment: { kind: 'shadowsHighlights', shadows: 60, highlights: -50, radius: 5 } });
    r = await row();
    expect(r[2]!).toBeGreaterThan(75);
    expect(Math.abs(r[2]! - sh(60, 60, -50))).toBeLessThanOrEqual(2);
    expect(r[37]!).toBeLessThan(180);
    expect(Math.abs(r[37]! - sh(180, 60, -50))).toBeLessThanOrEqual(2);
    expectNoProblems(app);
  });

  test('histograms measure the composite and an adjustment input', async ({ page }) => {
    const app = await openApp(page);
    const pixels: RGB3[] = [];
    for (let i = 0; i < 100; i++) pixels.push(i < 25 ? [10, 20, 30] : [200, 100, 50]);
    await buildImageDoc(page, 10, 10, pixels);
    await addAdjustment(page, 'adj', { kind: 'hueSaturation', hue: 0, saturation: 0, lightness: -100, colorize: false });
    const result = await page.evaluate(async () => {
      const ed = (window as any).__emulsion;
      const doc = ed.store.get().doc;
      const composite = await ed.histograms.compute(doc);
      const input = await ed.histograms.compute(doc, 'adj');
      return { composite: { r0: composite.r[0], total: composite.total }, input: { r10: input.r[10], r200: input.r[200], g100: input.g[100], total: input.total } };
    });
    expect(result.composite).toEqual({ r0: 100, total: 100 });
    expect(result.input).toEqual({ r10: 25, r200: 75, g100: 75, total: 100 });
    expectNoProblems(app);
  });

  test('merging an adjustment layer down bakes it into the pixels', async ({ page }) => {
    const app = await openApp(page);
    const pixels = swatch(64);
    await buildImageDoc(page, 8, 8, pixels);
    await addAdjustment(page, 'adj', { kind: 'exposure', exposure: 0.8, offset: 0, gamma: 1 });
    const before = await readAll(page, 8, 8);
    await page.keyboard.press('Control+e');
    await settle(page);
    const info = await docInfo(page);
    expect(info!.layers.map((l) => l.type)).toEqual(['pixel']);
    expect(maxError(await readAll(page, 8, 8), Array.from({ length: 64 }, (_, i) => before.slice(i * 4, i * 4 + 3) as RGB3)).error).toBeLessThanOrEqual(1);
    expectNoProblems(app);
  });
});

// ------------------------------------------------------------------ UI

/** Grey ramp: pixel i has value i (16×16 → 0..255). */
function greyRamp(): RGB3[] {
  return Array.from({ length: 256 }, (_, i) => [i, i, i] as RGB3);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__emulsion.store.get().history.labels as string[]);
}

test.describe('Phase 4: adjustment UI', () => {
  test('Levels: Ctrl+L, drag the black point, one undo step', async ({ page }) => {
    const app = await openApp(page);
    await buildImageDoc(page, 16, 16, greyRamp());
    const zoomBefore = (await page.evaluate(() => (window as any).__emulsion.view.transform.zoom)) as number;
    await page.keyboard.press('Control+l');
    await expect(page.getByRole('heading', { name: 'Levels' })).toBeVisible();
    const handle = page.getByRole('slider', { name: 'Input black point' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole('textbox', { name: 'Input black' })).toHaveValue('64');
    // Levels below the black point clip to 0; the rest stretch to the full range.
    expect((await compositePixel(page, 0, 4))[0]).toBe(0); // value 64
    expect(Math.abs((await compositePixel(page, 0, 8))[0]! - Math.round(((128 - 64) / 191) * 255))).toBeLessThanOrEqual(1);
    const labels = await historyLabels(page);
    expect(labels.filter((l) => l === 'Modify Levels')).toHaveLength(1);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect((await compositePixel(page, 0, 4))[0]).toBe(64);

    // Typing a gamma value.
    const gamma = page.getByRole('textbox', { name: 'Gamma' });
    await gamma.fill('2');
    await gamma.press('Enter');
    expect((await compositePixel(page, 0, 8))[0]).toBeGreaterThan(160);
    expect(await page.evaluate(() => (window as any).__emulsion.view.transform.zoom)).toBe(zoomBefore);
    expectNoProblems(app);
  });

  test('Curves: add a point by clicking, remove it with Delete', async ({ page }) => {
    const app = await openApp(page);
    await buildImageDoc(page, 16, 16, greyRamp());
    await page.getByRole('menuitem', { name: 'Adjust' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Curves' }).click();
    const graph = page.getByTestId('curve-graph');
    await expect(graph).toBeVisible();
    const box = (await graph.boundingBox())!;
    // Input 64 → output 128 (y axis points up).
    await page.mouse.click(box.x + 64.5, box.y + (255 - 128) + 0.5);
    await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toHaveValue('64');
    await expect(page.getByRole('textbox', { name: 'Output', exact: true })).toHaveValue('128');
    expect((await compositePixel(page, 0, 4))[0]).toBe(128); // value 64
    // The curve is monotone and passes through the endpoints.
    expect((await compositePixel(page, 0, 0))[0]).toBe(0);
    expect((await compositePixel(page, 15, 15))[0]).toBe(255);
    await page.keyboard.press('ArrowUp');
    expect((await compositePixel(page, 0, 4))[0]).toBe(129);
    await page.keyboard.press('Delete');
    expect((await compositePixel(page, 0, 4))[0]).toBe(64);
    expectNoProblems(app);
  });

  test('Hue/Saturation from the layers panel; typed values; clipping from the context menu', async ({ page }) => {
    const app = await openApp(page);
    await page.evaluate(() => (window as any).__emulsion.newDocument({ name: 'H', width: 20, height: 20, resolution: 72, background: 'white' }));
    await addSolid(page, 'red', [255, 0, 0], [5, 5, 10, 10]);
    await page.getByRole('button', { name: 'New adjustment layer' }).click();
    await page.getByRole('menu', { name: 'New adjustment layer' }).getByRole('menuitem', { name: 'Hue/Saturation' }).click();
    await expect(page.getByRole('heading', { name: 'Hue/Saturation' })).toBeVisible();
    const hue = page.getByRole('textbox', { name: 'Hue', exact: true });
    await hue.fill('120');
    await hue.press('Enter');
    expect(await compositePixel(page, 10, 10)).toEqual([0, 255, 0, 255]);
    // White has no hue: unchanged.
    expect(await compositePixel(page, 1, 1)).toEqual([255, 255, 255, 255]);

    // Clip the adjustment to the red layer: now only that layer is affected.
    await page.getByText('Hue/Saturation 1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create Clipping Mask' }).click();
    await expect(page.getByLabel('Clipped')).toHaveCount(1);
    expect(await compositePixel(page, 10, 10)).toEqual([0, 255, 0, 255]);

    // Colorize starts from 25% saturation: red (lightness 50%) becomes a muted green.
    await page.getByRole('checkbox', { name: 'Colorize' }).check();
    const tinted = await compositePixel(page, 10, 10);
    expect(Math.abs(tinted[0]! - 96)).toBeLessThanOrEqual(1);
    expect(Math.abs(tinted[1]! - 159)).toBeLessThanOrEqual(1);
    expect(await compositePixel(page, 1, 1)).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Control+Alt+g');
    await settle(page);
    await expect(page.getByLabel('Clipped')).toHaveCount(0);
    expectNoProblems(app);
  });

  test('histogram panel shows statistics of the composite', async ({ page }) => {
    const app = await openApp(page);
    await buildImageDoc(page, 16, 16, greyRamp());
    await page.getByRole('tab', { name: 'Histogram' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('256', { exact: true })).toBeVisible();
    await expect(panel.getByText('127.50')).toBeVisible();
    expectNoProblems(app);
  });
});
