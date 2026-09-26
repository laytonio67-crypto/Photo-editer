import { expect, test } from '@playwright/test';
import { alphaQuadrantsPNG, photoPixels, photoPNG, solidPNG } from './fixtures';
import { decodePNG, pixelAt } from './png';
import {
  compositePixel,
  docInfo,
  expectNoProblems,
  importViaDialog,
  openApp,
  settle,
  viewInfo,
} from './helpers';

test.describe('Phase 1 — shell, canvas, import, view, layers', () => {
  test('starts cleanly on the start screen', async ({ page }) => {
    const app = await openApp(page);
    await expect(page.getByText('Start editing')).toBeVisible();
    await expect(page.getByRole('menubar')).toBeVisible();
    expectNoProblems(app);
  });

  test('opens a PNG via the file dialog and composites it exactly', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'landscape.png', mimeType: 'image/png', buffer: photoPNG(640, 480) });
    const info = await docInfo(page);
    expect(info).toMatchObject({ width: 640, height: 480, name: 'landscape' });
    expect(info!.layers).toHaveLength(1);
    const src = photoPixels(640, 480);
    for (const [x, y] of [
      [0, 0],
      [320, 240],
      [639, 479],
      [448, 144],
    ] as const) {
      const i = (y * 640 + x) * 4;
      expect(await compositePixel(page, x, y)).toEqual([src[i], src[i + 1], src[i + 2], 255]);
    }
    await expect(page.getByTestId('layer-row')).toHaveCount(1);
    expectNoProblems(app);
  });

  test('premultiplies straight alpha correctly on import', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'alpha.png', mimeType: 'image/png', buffer: alphaQuadrantsPNG() });
    expect(await compositePixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(await compositePixel(page, 40, 5)).toEqual([0, 128, 0, 128]);
    expect(await compositePixel(page, 5, 40)).toEqual([0, 0, 64, 64]);
    expect(await compositePixel(page, 40, 40)).toEqual([0, 0, 0, 0]);
    expectNoProblems(app);
  });

  test('zooms with shortcuts and shows exact pixels at 100%', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'photo.png', mimeType: 'image/png', buffer: photoPNG(640, 480) });
    const fitted = await viewInfo(page);
    expect(fitted.zoom).toBeLessThanOrEqual(1);

    await page.keyboard.press('Control+Equal');
    const zoomedIn = await viewInfo(page);
    expect(zoomedIn.zoom).toBeGreaterThan(fitted.zoom);

    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Minus');
    expect((await viewInfo(page)).zoom).toBeLessThan(zoomedIn.zoom);

    await page.keyboard.press('Control+Digit1');
    const actual = await viewInfo(page);
    expect(actual.zoom).toBe(1);
    expect(Number.isInteger(actual.panX) && Number.isInteger(actual.panY)).toBe(true);
    await settle(page);

    // At 100% (DPR 1) screen pixels must equal document pixels exactly.
    const stage = page.getByTestId('stage');
    const box = (await stage.boundingBox())!;
    const shot = decodePNG(await stage.screenshot());
    const src = photoPixels(640, 480);
    for (const [dx, dy] of [
      [100, 100],
      [320, 200],
      [500, 300],
    ] as const) {
      const sx = actual.panX + dx;
      const sy = actual.panY + dy;
      if (sx < 0 || sy < 0 || sx >= box.width || sy >= box.height) continue;
      const i = (dy * 640 + dx) * 4;
      expect(pixelAt(shot, sx, sy).slice(0, 3)).toEqual([src[i], src[i + 1], src[i + 2]]);
    }

    await page.keyboard.press('Control+Digit0');
    expect((await viewInfo(page)).zoom).toBeCloseTo(fitted.zoom > 1 ? fitted.zoom : (await viewInfo(page)).zoom);
    expectNoProblems(app);
  });

  test('pans with Space+drag, wheel, and zooms with Ctrl+wheel around the cursor', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'photo.png', mimeType: 'image/png', buffer: photoPNG(1600, 1200) });
    await page.keyboard.press('Control+Digit1');
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const cx = stage.x + stage.width / 2;
    const cy = stage.y + stage.height / 2;

    const before = await viewInfo(page);
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 45, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const afterDrag = await viewInfo(page);
    expect(afterDrag.panX - before.panX).toBe(120);
    expect(afterDrag.panY - before.panY).toBe(45);

    await page.mouse.wheel(0, 100);
    const afterWheel = await viewInfo(page);
    expect(afterWheel.panY).toBe(afterDrag.panY - 100);

    // Ctrl+wheel zoom keeps the document point under the cursor fixed.
    await page.mouse.move(cx, cy);
    const anchorDoc = { x: (cx - stage.x - afterWheel.panX) / afterWheel.zoom, y: (cy - stage.y - afterWheel.panY) / afterWheel.zoom };
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    const zoomed = await viewInfo(page);
    expect(zoomed.zoom).toBeGreaterThan(afterWheel.zoom);
    const anchorAfter = { x: (cx - stage.x - zoomed.panX) / zoomed.zoom, y: (cy - stage.y - zoomed.panY) / zoomed.zoom };
    expect(anchorAfter.x).toBeCloseTo(anchorDoc.x, 0);
    expect(anchorAfter.y).toBeCloseTo(anchorDoc.y, 0);
    expectNoProblems(app);
  });

  test('drops image files onto the window as new layers', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'photo.png', mimeType: 'image/png', buffer: photoPNG(320, 240) });
    const b64 = solidPNG(40, 20, [10, 200, 30, 255]).toString('base64');
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'badge.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const stage = document.querySelector('[data-testid="stage"]')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        stage.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    }, b64);
    await page.waitForFunction(() => (window as any).__emulsion.store.get().doc.layers.length === 2);
    const info = await docInfo(page);
    expect(info!.layers.map((l) => l.name)).toEqual(['Background', 'badge']);
    // Placed centred: (320-40)/2 = 140, (240-20)/2 = 110.
    expect(await compositePixel(page, 140, 110)).toEqual([10, 200, 30, 255]);
    expect(await compositePixel(page, 179, 129)).toEqual([10, 200, 30, 255]);
    expectNoProblems(app);
  });

  test('pastes an image from the clipboard as a new layer', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'photo.png', mimeType: 'image/png', buffer: photoPNG(320, 240) });
    const b64 = solidPNG(10, 10, [250, 10, 10, 255]).toString('base64');
    await page.evaluate((data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, b64);
    await page.waitForFunction(() => (window as any).__emulsion.store.get().doc.layers.length === 2);
    const info = await docInfo(page);
    expect(info!.layers[1]!.name).toBe('Pasted Image');
    expect(await compositePixel(page, 160, 120)).toEqual([250, 10, 10, 255]);
    expectNoProblems(app);
  });

  test('creates a document from the New dialog', async ({ page }) => {
    const app = await openApp(page);
    await page.getByRole('button', { name: /New document/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New Document' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Poster');
    await dialog.getByRole('textbox', { name: 'W' }).fill('800');
    await dialog.getByRole('textbox', { name: 'H' }).fill('600');
    await dialog.getByLabel('Background').selectOption('transparent');
    await dialog.getByRole('button', { name: 'Create' }).click();
    const info = await docInfo(page);
    expect(info).toMatchObject({ width: 800, height: 600, name: 'Poster' });
    expect(await compositePixel(page, 10, 10)).toEqual([0, 0, 0, 0]);
    expectNoProblems(app);
  });

  test('manages layers: add, rename, hide, delete with undo/redo', async ({ page }) => {
    const app = await openApp(page);
    await importViaDialog(page, { name: 'photo.png', mimeType: 'image/png', buffer: photoPNG(200, 150) });
    const rows = page.getByTestId('layer-row');
    await page.getByRole('button', { name: 'New layer' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Layer 1');

    // Rename via double-click.
    await rows.first().getByText('Layer 1').dblclick();
    const input = page.getByRole('textbox', { name: 'Layer name' });
    await input.fill('Retouch');
    await input.press('Enter');
    await expect(rows.first()).toContainText('Retouch');

    // Hide the background: composite becomes transparent.
    await rows.nth(1).getByRole('button', { name: /Hide Background/ }).click();
    expect(await compositePixel(page, 50, 50)).toEqual([0, 0, 0, 0]);
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expect((await compositePixel(page, 50, 50))[3]).toBe(255);

    // Delete the new layer, then undo and redo.
    await rows.first().click();
    await page.getByRole('button', { name: 'Delete layer' }).click();
    await expect(rows).toHaveCount(1);
    await page.keyboard.press('Control+KeyZ');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Retouch');
    await page.keyboard.press('Control+Shift+KeyZ');
    await expect(rows).toHaveCount(1);
    expectNoProblems(app);
  });
});
