import { expect, test, type Page } from '@playwright/test';
import {
  buildDoc,
  clickDoc,
  compositePixel,
  docInfo,
  dragDoc,
  expectNoProblems,
  openApp,
  selectionValue,
  setColors,
  setToolOptions,
  settle,
} from './helpers';

function expectClose(actual: number[], expected: number[], tolerance: number, message = ''): void {
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]! - expected[i]!), `${message} channel ${i}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
  }
}

const HARD = { size: 20, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, smoothing: 0, pressureSize: false, pressureOpacity: false };

async function whiteDocWithEmptyLayer(page: Page, width = 200, height = 150): Promise<void> {
  await buildDoc(page, width, height, [{ name: 'Paper', color: [255, 255, 255] }]);
  await page.getByRole('button', { name: 'New layer' }).click();
  await page.keyboard.press('Control+Digit1');
}

test.describe('Phase 3 — brush, eraser, selections, masks, clipboard', () => {
  test('paints hard strokes with the foreground colour and undoes them', async ({ page }) => {
    const app = await openApp(page);
    await whiteDocWithEmptyLayer(page);
    await page.keyboard.press('KeyB');
    await setToolOptions(page, 'brush', HARD);
    await setColors(page, [200, 30, 60]);
    await dragDoc(page, [
      [20, 50],
      [180, 50],
    ]);
    expect(await compositePixel(page, 100, 50)).toEqual([200, 30, 60, 255]);
    expect(await compositePixel(page, 100, 75)).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expect(await compositePixel(page, 100, 50)).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Control+Shift+KeyZ');
    await settle(page);
    expect(await compositePixel(page, 100, 50)).toEqual([200, 30, 60, 255]);
    expectNoProblems(app);
  });

  test('opacity caps a stroke while flow builds up per dab', async ({ page }) => {
    const app = await openApp(page);
    await whiteDocWithEmptyLayer(page);
    await page.keyboard.press('KeyB');
    await setColors(page, [0, 0, 0]);
    // 50% opacity: overlapping dabs never exceed half coverage.
    await setToolOptions(page, 'brush', { ...HARD, opacity: 0.5 });
    await dragDoc(page, [
      [20, 40],
      [180, 40],
      [20, 40],
    ]);
    expectClose(await compositePixel(page, 100, 40), [128, 128, 128, 255], 2, 'opacity cap');
    // 25% flow, single dab (click): exactly one quarter coverage.
    await setToolOptions(page, 'brush', { ...HARD, flow: 0.25 });
    await clickDoc(page, 100, 110);
    expectClose(await compositePixel(page, 100, 110), [191, 191, 191, 255], 2, 'flow single dab');
    expectNoProblems(app);
  });

  test('erases to transparency, or paints the background colour when transparency is locked', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 120, 80, [{ name: 'Photo', color: [40, 90, 200] }]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyE');
    await setToolOptions(page, 'eraser', HARD);
    await dragDoc(page, [
      [10, 20],
      [110, 20],
    ]);
    expect(await compositePixel(page, 60, 20)).toEqual([0, 0, 0, 0]);
    expect(await compositePixel(page, 60, 60)).toEqual([40, 90, 200, 255]);
    await page.getByRole('button', { name: 'Lock transparent pixels' }).click();
    await setColors(page, [0, 0, 0], [0, 255, 0]);
    await dragDoc(page, [
      [10, 60],
      [110, 60],
    ]);
    expect(await compositePixel(page, 60, 60)).toEqual([0, 255, 0, 255]);
    // Still transparent where alpha was already zero.
    expect(await compositePixel(page, 60, 20)).toEqual([0, 0, 0, 0]);
    expectNoProblems(app);
  });

  test('rectangular marquee, boolean modes, invert, deselect and reselect', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 200, 150, [{ name: 'Base', color: [90, 90, 90] }]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyM');
    await dragDoc(page, [
      [20, 20],
      [80, 80],
    ]);
    expect(await selectionValue(page, 50, 50)).toBe(255);
    expect(await selectionValue(page, 100, 50)).toBe(0);
    // Shift adds.
    await page.keyboard.down('Shift');
    await dragDoc(page, [
      [100, 20],
      [150, 80],
    ]);
    await page.keyboard.up('Shift');
    expect(await selectionValue(page, 120, 50)).toBe(255);
    // Alt subtracts.
    await page.keyboard.down('Alt');
    await dragDoc(page, [
      [40, 40],
      [60, 60],
    ]);
    await page.keyboard.up('Alt');
    expect(await selectionValue(page, 50, 50)).toBe(0);
    expect(await selectionValue(page, 30, 30)).toBe(255);
    // Inverse.
    await page.keyboard.press('Control+Shift+KeyI');
    expect(await selectionValue(page, 30, 30)).toBe(0);
    expect(await selectionValue(page, 190, 140)).toBe(255);
    await page.keyboard.press('Control+KeyD');
    expect(await selectionValue(page, 30, 30)).toBeNull();
    await page.keyboard.press('Control+Shift+KeyD');
    expect(await selectionValue(page, 190, 140)).toBe(255);
    expectNoProblems(app);
  });

  test('clears and fills inside the selection and clips painting to it', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 200, 150, [{ name: 'Base', color: [90, 90, 90] }]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyM');
    await dragDoc(page, [
      [50, 50],
      [150, 100],
    ]);
    await page.keyboard.press('Delete');
    await expect.poll(() => compositePixel(page, 100, 75)).toEqual([0, 0, 0, 0]);
    expect(await compositePixel(page, 20, 20)).toEqual([90, 90, 90, 255]);
    await setColors(page, [250, 200, 0]);
    await page.keyboard.press('Alt+Backspace');
    await expect.poll(() => compositePixel(page, 100, 75)).toEqual([250, 200, 0, 255]);
    // Painting across the selection only affects the inside.
    await page.keyboard.press('KeyB');
    await setToolOptions(page, 'brush', HARD);
    await setColors(page, [0, 0, 255]);
    await dragDoc(page, [
      [10, 75],
      [190, 75],
    ]);
    expect(await compositePixel(page, 100, 75)).toEqual([0, 0, 255, 255]);
    expect(await compositePixel(page, 20, 75)).toEqual([90, 90, 90, 255]);
    expectNoProblems(app);
  });

  test('elliptical marquee is anti-aliased and feathering softens edges', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 200, 200, [{ name: 'Base', color: [0, 0, 0] }]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyM');
    await page.keyboard.press('Shift+KeyM');
    await dragDoc(page, [
      [50, 50],
      [150, 150],
    ]);
    expect(await selectionValue(page, 100, 100)).toBe(255);
    expect(await selectionValue(page, 55, 55)).toBe(0);
    // Pixels along the 45° edge have partial (anti-aliased) coverage.
    const edge = [];
    for (let d = 60; d <= 70; d++) edge.push(await selectionValue(page, d, d));
    expect(edge.some((v) => v! > 0 && v! < 255)).toBe(true);
    await page.keyboard.press('Shift+F6');
    const dialog = page.getByRole('dialog', { name: 'Feather Selection' });
    await dialog.getByRole('textbox', { name: 'Feather radius' }).fill('8');
    await dialog.getByRole('button', { name: 'Feather' }).click();
    const v = await selectionValue(page, 50, 100);
    expect(v!).toBeGreaterThan(20);
    expect(v!).toBeLessThan(235);
    expect(await selectionValue(page, 100, 100)).toBe(255);
    expectNoProblems(app);
  });

  test('lasso and polygonal lasso select polygons', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 200, 200, [{ name: 'Base', color: [0, 0, 0] }]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyL');
    await dragDoc(page, [
      [20, 20],
      [120, 20],
      [120, 120],
      [20, 120],
    ]);
    expect(await selectionValue(page, 70, 70)).toBe(255);
    expect(await selectionValue(page, 150, 150)).toBe(0);
    await page.keyboard.press('Shift+KeyL');
    await clickDoc(page, 130, 130);
    await clickDoc(page, 190, 130);
    await page.waitForTimeout(400);
    await clickDoc(page, 160, 190);
    await page.keyboard.press('Enter');
    expect(await selectionValue(page, 160, 150)).toBe(255);
    expect(await selectionValue(page, 70, 70)).toBe(0);
    expectNoProblems(app);
  });

  test('magic wand selects a contiguous colour region', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 120, 80, [
      { name: 'Base', color: [255, 255, 255] },
      { name: 'Left', color: [220, 20, 20], rect: [10, 10, 30, 30] },
      { name: 'Right', color: [220, 20, 20], rect: [70, 10, 30, 30] },
    ]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyW');
    await clickDoc(page, 20, 20);
    await expect.poll(() => selectionValue(page, 20, 20)).toBe(255);
    expect(await selectionValue(page, 80, 20)).toBe(0);
    expect(await selectionValue(page, 50, 50)).toBe(0);
    await setToolOptions(page, 'magicWand', { contiguous: false });
    await clickDoc(page, 20, 20);
    await expect.poll(() => selectionValue(page, 80, 20)).toBe(255);
    expectNoProblems(app);
  });

  test('copies, cuts and pastes selected pixels in place', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 100, 100, [
      { name: 'Base', color: [255, 255, 255] },
      { name: 'Art', color: [10, 120, 200], rect: [20, 20, 40, 40] },
    ]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyM');
    await dragDoc(page, [
      [30, 30],
      [50, 50],
    ]);
    await page.keyboard.press('Control+KeyC');
    await page.waitForFunction(() => (window as any).__emulsion.clipboard !== null);
    await page.keyboard.press('Control+KeyD');
    await page.keyboard.press('Control+KeyV');
    await page.waitForFunction(() => (window as any).__emulsion.store.get().doc.layers.length === 3);
    const info = await docInfo(page);
    expect(info!.layers[2]!.name).toBe('Pasted Layer');
    const bounds = await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      const l = ed.store.get().doc.layers[2];
      const s = ed.surfaces.get(l.surfaceId);
      return { x: l.x, y: l.y, w: s.width, h: s.height };
    });
    expect(bounds).toEqual({ x: 30, y: 30, w: 20, h: 20 });
    // Cut from the Art layer leaves a hole.
    await page.getByTestId('layer-row').filter({ hasText: 'Art' }).click();
    await dragDoc(page, [
      [22, 22],
      [28, 28],
    ]);
    await page.keyboard.press('Control+KeyX');
    await expect.poll(() => compositePixel(page, 25, 25)).toEqual([255, 255, 255, 255]);
    expectNoProblems(app);
  });

  test('layer masks hide, disable, invert and apply', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 100, 100, [
      { name: 'Base', color: [255, 255, 255] },
      { name: 'Top', color: [200, 0, 0] },
    ]);
    await page.keyboard.press('Control+Digit1');
    await page.getByRole('button', { name: 'Add layer mask' }).click();
    await expect(page.getByTestId('mask-thumb')).toHaveCount(1);
    // Paint black on the mask: the top layer disappears there.
    await page.keyboard.press('KeyB');
    await setToolOptions(page, 'brush', HARD);
    await setColors(page, [0, 0, 0]);
    await dragDoc(page, [
      [10, 50],
      [90, 50],
    ]);
    expect(await compositePixel(page, 50, 50)).toEqual([255, 255, 255, 255]);
    expect(await compositePixel(page, 50, 10)).toEqual([200, 0, 0, 255]);
    // Shift-click the mask thumbnail disables it.
    await page.getByTestId('mask-thumb').click({ modifiers: ['Shift'] });
    expect(await compositePixel(page, 50, 50)).toEqual([200, 0, 0, 255]);
    await page.getByTestId('mask-thumb').click({ modifiers: ['Shift'] });
    expect(await compositePixel(page, 50, 50)).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Control+KeyI');
    expect(await compositePixel(page, 50, 50)).toEqual([200, 0, 0, 255]);
    expect(await compositePixel(page, 50, 10)).toEqual([255, 255, 255, 255]);
    // Apply: the mask is baked into the pixels.
    await page.getByRole('menuitem', { name: 'Layer' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Apply Layer Mask' }).click();
    await expect(page.getByTestId('mask-thumb')).toHaveCount(0);
    expect(await compositePixel(page, 50, 50)).toEqual([200, 0, 0, 255]);
    expect(await compositePixel(page, 50, 10)).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    await expect(page.getByTestId('mask-thumb')).toHaveCount(1);
    expectNoProblems(app);
  });

  test('eyedropper and brush shortcuts', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 60, 60, [
      { name: 'Base', color: [12, 34, 56] },
      { name: 'Spot', color: [240, 180, 20], rect: [30, 30, 30, 30] },
    ]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('KeyI');
    await clickDoc(page, 40, 40);
    const fg = await page.evaluate(() => (window as any).__emulsion.store.get().foreground);
    expect(fg).toEqual({ r: 240, g: 180, b: 20 });
    await clickDoc(page, 10, 10, { modifiers: ['Alt'] });
    const bg = await page.evaluate(() => (window as any).__emulsion.store.get().background);
    expect(bg).toEqual({ r: 12, g: 34, b: 56 });
    await page.keyboard.press('KeyB');
    await setToolOptions(page, 'brush', { size: 30 });
    await page.keyboard.press('BracketRight');
    await page.keyboard.press('BracketRight');
    await page.keyboard.press('BracketLeft');
    await page.keyboard.press('Digit5');
    const opts = await page.evaluate(() => (window as any).__emulsion.store.get().toolOptions.brush);
    expect(opts.size).toBe(40);
    expect(opts.opacity).toBe(0.5);
    expectNoProblems(app);
  });
});
