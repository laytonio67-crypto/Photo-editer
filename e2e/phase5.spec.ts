import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildDoc, clickDoc, compositePixel, dragDoc, expectNoProblems, openApp, setToolOptions, settle } from './helpers';
import { decodePNG, pixelAt } from './png';

/** Document whose single layer is drawn by `paint` on a 2D canvas (opaque). */
async function canvasDoc(page: Page, width: number, height: number, paint: string): Promise<void> {
  await page.evaluate(
    ({ width, height, paint }) => {
      const ed = (window as any).__emulsion;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d')!;
      new Function('g', paint)(g);
      ed.openImage(c, 'Test');
    },
    { width, height, paint },
  );
  await settle(page);
}

async function noticeMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__emulsion.store.get().notices.map((n: any) => n.message as string));
}

test.describe('Phase 5: clone stamp and healing brush', () => {
  test('clone stamp copies from the Alt-clicked source, aligned across strokes', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 120, 60, [
      { name: 'Red', color: [220, 30, 30], rect: [0, 0, 60, 60] },
      { name: 'Blue', color: [30, 30, 220], rect: [60, 0, 60, 60] },
    ]);
    // Merge into one layer so the clone samples a single "current layer".
    await page.keyboard.press('Control+e');
    await settle(page);
    await page.keyboard.press('s');
    await setToolOptions(page, 'cloneStamp', { size: 10, hardness: 1, pressureSize: false, smoothing: 0 });

    // Without a source there is a clear message and no change.
    await clickDoc(page, 90, 30);
    expect(await noticeMessages(page)).toContain('Alt-click to set the Clone Stamp source point first.');
    expect(await compositePixel(page, 90, 30)).toEqual([30, 30, 220, 255]);

    await clickDoc(page, 20, 30, { modifiers: ['Alt'] });
    await dragDoc(page, [
      [80, 30],
      [100, 30],
    ]);
    // Offset (−60, 0): x = 80..100 receives the red from x = 20..40.
    expect(await compositePixel(page, 90, 30)).toEqual([220, 30, 30, 255]);
    expect(await compositePixel(page, 90, 10)).toEqual([30, 30, 220, 255]);
    // Aligned: a second stroke elsewhere keeps the offset (x = 110 samples x = 50 → red).
    await clickDoc(page, 110, 45);
    expect(await compositePixel(page, 110, 45)).toEqual([220, 30, 30, 255]);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await compositePixel(page, 110, 45)).toEqual([30, 30, 220, 255]);
    expect(await compositePixel(page, 90, 30)).toEqual([220, 30, 30, 255]);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await compositePixel(page, 90, 30)).toEqual([30, 30, 220, 255]);
    expectNoProblems(app);
  });

  test('clone stamp can sample all layers onto an empty layer', async ({ page }) => {
    const app = await openApp(page);
    await canvasDoc(page, 80, 40, "g.fillStyle = '#20c040'; g.fillRect(0, 0, 40, 40); g.fillStyle = '#ffffff'; g.fillRect(40, 0, 40, 40);");
    await page.keyboard.press('Control+Alt+Shift+n'); // new empty layer
    await settle(page);
    await page.keyboard.press('s');
    await setToolOptions(page, 'cloneStamp', { size: 8, hardness: 1, pressureSize: false, smoothing: 0, sample: 'current' });
    await clickDoc(page, 20, 20, { modifiers: ['Alt'] });
    // The empty layer has nothing to clone.
    await clickDoc(page, 60, 20);
    expect(await compositePixel(page, 60, 20)).toEqual([255, 255, 255, 255]);
    await setToolOptions(page, 'cloneStamp', { sample: 'all' });
    await clickDoc(page, 20, 20, { modifiers: ['Alt'] });
    await clickDoc(page, 60, 20);
    expect(await compositePixel(page, 60, 20)).toEqual([32, 192, 64, 255]);
    // The green landed on the new (top) layer, not the background.
    const onTop = await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      const doc = ed.store.get().doc;
      const top = doc.layers[doc.layers.length - 1];
      const px = ed.surfaces.readSync(top.surfaceId, { x: 60 - top.x, y: 20 - top.y, width: 1, height: 1 });
      return Array.from(px);
    });
    expect(onTop).toEqual([32, 192, 64, 255]);
    expectNoProblems(app);
  });

  test('healing brush keeps source texture but adopts destination tone', async ({ page }) => {
    const app = await openApp(page);
    // Left: grey 60 with a darker vertical line (40) at x = 30. Right: grey 200.
    await canvasDoc(
      page,
      120,
      60,
      "g.fillStyle = 'rgb(60,60,60)'; g.fillRect(0, 0, 60, 60); g.fillStyle = 'rgb(40,40,40)'; g.fillRect(30, 0, 1, 60); g.fillStyle = 'rgb(200,200,200)'; g.fillRect(60, 0, 60, 60);",
    );
    await page.keyboard.press('j');
    await setToolOptions(page, 'healingBrush', { size: 20, hardness: 1, pressureSize: false, smoothing: 0 });
    await clickDoc(page, 30.5, 30.5, { modifiers: ['Alt'] });
    await clickDoc(page, 90.5, 30.5);
    const line = (await compositePixel(page, 90, 30))[0]!;
    const beside = (await compositePixel(page, 86, 30))[0]!;
    // A plain clone would give 40 / 60; healing shifts the patch to the surrounding 200
    // while keeping the line 20 levels darker.
    expect(Math.abs(beside - 200)).toBeLessThanOrEqual(8);
    expect(beside - line).toBeGreaterThanOrEqual(12);
    expect(beside - line).toBeLessThanOrEqual(28);
    // Outside the brush nothing changed.
    expect(await compositePixel(page, 90, 5)).toEqual([200, 200, 200, 255]);
    const labels = await page.evaluate(() => (window as any).__emulsion.store.get().history.labels as string[]);
    expect(labels[labels.length - 1]).toBe('Healing Brush');
    expectNoProblems(app);
  });
});

// ------------------------------------------------------------------ text

async function layerList(page: Page): Promise<{ id: string; type: string; name: string; content?: string; style?: any; x?: number; y?: number; scaleX?: number }[]> {
  return page.evaluate(() =>
    (window as any).__emulsion.store
      .get()
      .doc.layers.map((l: any) => ({ id: l.id, type: l.type, name: l.name, content: l.content, style: l.style, x: l.x, y: l.y, scaleX: l.scaleX })),
  );
}

/** Number of dark (ink) pixels in a document rect of the composite. */
async function inkCount(page: Page, rect: [number, number, number, number]): Promise<number> {
  return page.evaluate(([x, y, w, h]) => {
    const px: Uint8Array = (window as any).__emulsion.readComposite({ x, y, width: w, height: h });
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! < 128) n++;
    return n;
  }, rect);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__emulsion.store.get().history.labels as string[]);
}

test.describe('Phase 5: text layers', () => {
  test('creates, edits, restyles, moves and rasterizes text', async ({ page }) => {
    const app = await openApp(page);
    await page.evaluate(() => (window as any).__emulsion.newDocument({ name: 'T', width: 400, height: 200, resolution: 72, background: 'white' }));
    await page.keyboard.press('t');
    await setToolOptions(page, 'text', { fontSize: 40, fontFamily: 'sans-serif' });
    // Clicking sets the first baseline.
    await clickDoc(page, 40, 100);
    await expect(page.getByTestId('text-input')).toBeFocused();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await settle(page);
    let layers = await layerList(page);
    expect(layers.map((l) => [l.type, l.name, l.content])).toEqual([
      ['pixel', 'Background', undefined],
      ['text', 'Hello', 'Hello'],
    ]);
    expect((await historyLabels(page)).at(-1)).toBe('New Text Layer');
    // Glyphs sit above the baseline at y = 100, starting near x = 40.
    expect(await inkCount(page, [38, 65, 130, 36])).toBeGreaterThan(150);
    expect(await inkCount(page, [0, 0, 400, 60])).toBe(0);
    expect(await inkCount(page, [0, 106, 400, 94])).toBe(0);

    // Click the text to edit it: the content is selected, typing replaces it.
    await clickDoc(page, 60, 85);
    await expect(page.getByTestId('text-input')).toBeFocused();
    await page.keyboard.type('Hi there');
    await page.keyboard.press('Control+Enter');
    await settle(page);
    layers = await layerList(page);
    expect(layers[1]!.content).toBe('Hi there');
    expect(layers[1]!.name).toBe('Hi there');
    expect((await historyLabels(page)).at(-1)).toBe('Edit Text');

    // Options bar size applies to the selected text layer.
    const size = page.getByRole('textbox', { name: 'Font size' }).first();
    await size.fill('60');
    await size.press('Enter');
    layers = await layerList(page);
    expect(layers[1]!.style.fontSize).toBe(60);
    const inkLarge = await inkCount(page, [0, 0, 400, 200]);

    // Move tool: text stays vector, only its anchor moves.
    await page.keyboard.press('v');
    await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    layers = await layerList(page);
    expect(layers[1]!.x).toBe(50);
    expect(layers[1]!.type).toBe('text');

    // Rasterize keeps the look.
    const before = await page.evaluate(() => Array.from((window as any).__emulsion.readComposite({ x: 0, y: 0, width: 400, height: 200 })));
    await page.getByRole('menuitem', { name: 'Layer' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Rasterize Layer' }).click();
    await settle(page);
    layers = await layerList(page);
    expect(layers[1]!.type).toBe('pixel');
    const after = await page.evaluate(() => Array.from((window as any).__emulsion.readComposite({ x: 0, y: 0, width: 400, height: 200 })));
    let worst = 0;
    for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs((before[i] as number) - (after[i] as number)));
    expect(worst).toBeLessThanOrEqual(2);
    expect(inkLarge).toBeGreaterThan(300);
    expectNoProblems(app);
  });

  test('empty text is discarded; Free Transform scales text as vector', async ({ page }) => {
    const app = await openApp(page);
    await page.evaluate(() => (window as any).__emulsion.newDocument({ name: 'T', width: 300, height: 200, resolution: 72, background: 'white' }));
    await page.keyboard.press('t');
    await setToolOptions(page, 'text', { fontSize: 30, fontFamily: 'sans-serif' });
    const labelsBefore = await historyLabels(page);
    await clickDoc(page, 50, 80);
    await clickDoc(page, 200, 150); // click away without typing
    await settle(page);
    expect((await layerList(page)).length).toBe(1);
    expect(await historyLabels(page)).toEqual(labelsBefore);

    await clickDoc(page, 50, 80);
    await page.keyboard.type('Scale');
    await page.keyboard.press('Escape');
    await settle(page);
    const ink1 = await inkCount(page, [0, 0, 300, 200]);
    await page.keyboard.press('Control+t');
    const width = page.getByRole('region', { name: 'Tool options' }).getByRole('textbox', { name: 'W', exact: true });
    await width.fill('200');
    await width.press('Enter');
    await page.keyboard.press('Enter');
    await settle(page);
    const layers = await layerList(page);
    expect(layers[1]!.type).toBe('text');
    expect(layers[1]!.scaleX).toBeCloseTo(2, 5);
    const ink2 = await inkCount(page, [0, 0, 300, 200]);
    // Four times the area (minus anti-aliasing differences).
    expect(ink2 / ink1).toBeGreaterThan(3);
    expect(ink2 / ink1).toBeLessThan(5);
    expectNoProblems(app);
  });
});

// ------------------------------------------------------------------ export

async function exportWith(page: Page, configure: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  await page.keyboard.press('Control+Alt+Shift+w');
  await expect(page.getByRole('dialog', { name: 'Export As' })).toBeVisible();
  await configure();
  await expect(page.getByTestId('export-size')).not.toHaveText('Calculating…');
  await expect(page.getByTestId('export-size')).toHaveText(/\d+(\.\d+)? (B|KB|MB)/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  await expect(page.getByRole('dialog', { name: 'Export As' })).toHaveCount(0);
  return { name: download.suggestedFilename(), bytes: readFileSync((await download.path())!) };
}

/** Decodes an image in the browser (for JPEG/WebP) and returns RGBA pixels. */
async function decodeInBrowser(page: Page, bytes: Buffer, type: string): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(
    async ({ b64, type }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([arr], { type }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) };
    },
    { b64: bytes.toString('base64'), type },
  );
}

test.describe('Phase 5: export', () => {
  test('exports exact PNGs with transparency, resolution and scaling; JPEG and WebP', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 40, 20, [
      { name: 'Red', color: [255, 0, 0], rect: [0, 0, 20, 20], opacity: 0.5 },
      { name: 'Blue', color: [0, 0, 255], rect: [20, 0, 20, 20] },
    ]);
    await page.evaluate(() => (window as any).__emulsion.commit('Resolution', (d: any) => ({ ...d, name: 'My: Export', resolution: 300 })));

    // PNG: straight alpha, exact values, pHYs = 300 ppi.
    const png = await exportWith(page, async () => {});
    expect(png.name).toBe('My Export.png');
    const img = decodePNG(png.bytes);
    expect([img.width, img.height]).toEqual([40, 20]);
    expect(pixelAt(img, 5, 5)).toEqual([255, 0, 0, 128]);
    expect(pixelAt(img, 30, 5)).toEqual([0, 0, 255, 255]);
    const physAt = png.bytes.indexOf(Buffer.from('pHYs'));
    expect(physAt).toBeGreaterThan(0);
    expect(png.bytes.readUInt32BE(physAt + 4)).toBe(Math.round(300 / 0.0254));

    // PNG without transparency, half size: flattened onto the white matte.
    const flat = await exportWith(page, async () => {
      await page.getByRole('checkbox', { name: 'Transparency' }).uncheck();
      const scale = page.getByRole('textbox', { name: 'Export scale' });
      await scale.fill('50');
      await scale.press('Tab');
    });
    const small = decodePNG(flat.bytes);
    expect([small.width, small.height]).toEqual([20, 10]);
    const pink = pixelAt(small, 3, 5);
    expect(pink[3]).toBe(255);
    expect(Math.abs(pink[0] - 255)).toBeLessThanOrEqual(1);
    expect(Math.abs(pink[1] - 127)).toBeLessThanOrEqual(2);
    expect(pixelAt(small, 16, 5)).toEqual([0, 0, 255, 255]);

    // JPEG: lossy, always flattened.
    const jpeg = await exportWith(page, async () => {
      await page.getByRole('radio', { name: 'JPEG' }).click();
      await expect(page.getByRole('checkbox', { name: 'Transparency' })).toBeDisabled();
    });
    expect(jpeg.name).toBe('My Export.jpg');
    expect([jpeg.bytes[0], jpeg.bytes[1]]).toEqual([0xff, 0xd8]);
    // JFIF density patched to 300 dpi.
    expect([jpeg.bytes[13], jpeg.bytes.readUInt16BE(14)]).toEqual([1, 300]);
    const j = await decodeInBrowser(page, jpeg.bytes, 'image/jpeg');
    expect([j.width, j.height]).toEqual([40, 20]);
    const jp = j.data.slice((5 * 40 + 5) * 4, (5 * 40 + 5) * 4 + 3);
    expect(Math.abs(jp[0]! - 255)).toBeLessThanOrEqual(12);
    expect(Math.abs(jp[1]! - 127)).toBeLessThanOrEqual(12);

    // WebP keeps transparency.
    const webp = await exportWith(page, async () => {
      await page.getByRole('radio', { name: 'WebP' }).click();
    });
    expect(webp.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(webp.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const w = await decodeInBrowser(page, webp.bytes, 'image/webp');
    expect(w.data[(5 * 40 + 5) * 4 + 3]).toBeGreaterThan(100);
    expect(w.data[(5 * 40 + 5) * 4 + 3]).toBeLessThan(160);
    expectNoProblems(app);
  });
});

// ------------------------------------------------------------------ projects

async function snapshot(page: Page): Promise<{ pixels: number[]; layers: unknown }> {
  return page.evaluate(() => {
    const ed = (window as any).__emulsion;
    const doc = ed.store.get().doc;
    const strip = (layers: any[]): any[] =>
      layers.map((l) => ({
        type: l.type,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        clipped: l.clipped,
        mask: l.mask ? { x: l.mask.x, y: l.mask.y, defaultValue: l.mask.defaultValue } : null,
        content: l.content,
        adjustment: l.adjustment,
        children: l.children ? strip(l.children) : undefined,
      }));
    return {
      pixels: Array.from(ed.readComposite({ x: 0, y: 0, width: doc.width, height: doc.height })) as number[],
      layers: { name: doc.name, width: doc.width, height: doc.height, resolution: doc.resolution, hasSelection: !!doc.selection, layers: strip(doc.layers) },
    };
  });
}

test.describe('Phase 5: projects', () => {
  test('saves to browser storage, saves incrementally, reopens exactly and deletes', async ({ page }) => {
    const app = await openApp(page);
    await canvasDoc(
      page,
      120,
      80,
      "const gr = g.createLinearGradient(0, 0, 120, 80); gr.addColorStop(0, '#203050'); gr.addColorStop(1, '#f0a040'); g.fillStyle = gr; g.fillRect(0, 0, 120, 80);",
    );
    // A text layer, an adjustment layer with a selection-shaped mask, and a clipped layer in a group.
    await page.keyboard.press('t');
    await setToolOptions(page, 'text', { fontSize: 24, fontFamily: 'sans-serif' });
    await clickDoc(page, 10, 40);
    await page.keyboard.type('Saved');
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    await dragDocRect(page, 60, 10, 110, 70);
    await page.keyboard.press('Control+u');
    await page.getByRole('textbox', { name: 'Hue', exact: true }).fill('90');
    await page.getByRole('textbox', { name: 'Hue', exact: true }).press('Enter');
    await settle(page);
    const before = await snapshot(page);

    await page.keyboard.press('Control+s');
    await expect(page.getByRole('dialog', { name: 'Save Project' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).fill('Persist Test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Save Project' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__emulsion.store.get().project?.name)).toBe('Persist Test');
    expect(await page.evaluate(() => (window as any).__emulsion.store.get().modified)).toBe(false);
    const first = await page.evaluate(() => (window as any).__emulsion.projects.lastSaveStats);
    expect(first.written).toBeGreaterThanOrEqual(2);
    expect(first.kept).toBe(0);

    // A property-only change rewrites no pixels.
    await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      ed.commit('Rename', (d: any) => ({ ...d, layers: d.layers.map((l: any, i: number) => (i === 0 ? { ...l, name: 'Photo' } : l)) }));
    });
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as any).__emulsion.store.get().modified)).toBe(false);
    const second = await page.evaluate(() => (window as any).__emulsion.projects.lastSaveStats);
    expect(second).toEqual({ written: 0, kept: first.written, removed: 0 });
    const saved = await snapshot(page);

    // Reload the page: the project is offered on the start screen and reopens identically.
    await page.reload();
    await page.waitForFunction(() => '__emulsion' in window);
    const recent = page.getByRole('region', { name: 'Recent projects' });
    await expect(recent.getByRole('button', { name: /Persist Test/ })).toBeVisible();
    await recent.getByRole('button', { name: /Persist Test/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__emulsion.store.get().doc?.name)).toBe('Persist Test');
    await settle(page);
    const reopened = await snapshot(page);
    expect(reopened.layers).toEqual(saved.layers);
    let worst = 0;
    for (let i = 0; i < saved.pixels.length; i++) worst = Math.max(worst, Math.abs(saved.pixels[i]! - reopened.pixels[i]!));
    expect(worst).toBeLessThanOrEqual(1);
    expect(before.pixels.length).toBe(saved.pixels.length);
    // Ctrl+S now updates the reopened project without asking for a name.
    await page.evaluate(() => (window as any).__emulsion.markModified());
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as any).__emulsion.store.get().modified)).toBe(false);
    expect(await page.evaluate(() => (window as any).__emulsion.projects.lastSaveStats.written)).toBe(0);

    // Delete it from the Open Project dialog.
    await page.keyboard.press('Control+Alt+o');
    const dialog = page.getByRole('dialog', { name: 'Open Project' });
    await expect(dialog.getByTestId('project-card')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Delete Persist Test' }).click();
    await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Open Project' }).getByText('No saved projects yet', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__emulsion.store.get().project)).toBeNull();
    expectNoProblems(app);
  });
});

async function dragDocRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await dragDoc(page, [
    [x0, y0],
    [x1, y1],
  ]);
}
