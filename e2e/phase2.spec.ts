import { expect, test, type Page } from '@playwright/test';
import { blendReference, type RGB3 } from './blendReference';
import { buildDoc, compositePixel, docInfo, expectNoProblems, openApp, patchLayer, settle, viewInfo } from './helpers';

const BLEND_MODES = [
  'normal',
  'darken',
  'multiply',
  'colorBurn',
  'linearBurn',
  'darkerColor',
  'lighten',
  'screen',
  'colorDodge',
  'linearDodge',
  'lighterColor',
  'overlay',
  'softLight',
  'hardLight',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

function expectClose(actual: number[], expected: number[], tolerance: number, message?: string): void {
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]! - expected[i]!), `${message ?? ''} channel ${i}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

async function layerBounds(page: Page, id: string) {
  return page.evaluate(async (layerId) => {
    const ed = (window as any).__emulsion;
    const find = (layers: any[]): any => {
      for (const l of layers) {
        if (l.id === layerId) return l;
        if (l.children) {
          const f = find(l.children);
          if (f) return f;
        }
      }
      return null;
    };
    const layer = find(ed.store.get().doc.layers);
    const s = ed.surfaces.get(layer.surfaceId);
    return { x: layer.x, y: layer.y, width: s.width, height: s.height };
  }, id);
}

test.describe('Phase 2 — layer operations, transforms, blend modes, history', () => {
  test('every blend mode matches the reference formulas (opaque and 50% opacity)', async ({ page }) => {
    const app = await openApp(page);
    const backdrop: [number, number, number] = [200, 120, 40];
    const source: [number, number, number] = [60, 180, 220];
    const [, top] = await buildDoc(page, 16, 16, [
      { name: 'Backdrop', color: backdrop },
      { name: 'Source', color: source },
    ]);
    const cb = backdrop.map((v) => v / 255) as RGB3;
    const cs = source.map((v) => v / 255) as RGB3;
    for (const mode of BLEND_MODES) {
      await patchLayer(page, top!, { blendMode: mode, opacity: 1 });
      const ref = blendReference(mode, cb, cs).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
      expectClose(await compositePixel(page, 8, 8), [...ref, 255], 1, mode);
      // With 50% opacity the result is mix(backdrop, B, 0.5) for an opaque backdrop.
      await patchLayer(page, top!, { opacity: 0.5 });
      const half = blendReference(mode, cb, cs).map((v, i) => Math.round((cb[i]! * 0.5 + Math.min(1, Math.max(0, v)) * 0.5) * 255));
      expectClose(await compositePixel(page, 8, 8), [...half, 255], 1, `${mode} @50%`);
    }
    expectNoProblems(app);
  });

  test('changes blend mode and opacity from the layers panel', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 32, 32, [
      { name: 'Base', color: [100, 100, 100] },
      { name: 'Top', color: [200, 50, 250] },
    ]);
    const panel = page.getByRole('complementary', { name: 'Panels' });
    await panel.getByRole('combobox', { name: 'Blend mode' }).last().selectOption('multiply');
    expectClose(await compositePixel(page, 5, 5), [78, 20, 98, 255], 1, 'multiply');
    const opacity = panel.getByRole('textbox', { name: 'Opacity' }).last();
    await opacity.fill('50');
    await opacity.press('Enter');
    expectClose(await compositePixel(page, 5, 5), [89, 60, 99, 255], 1, 'multiply 50%');
    const info = await docInfo(page);
    expect(info!.layers).toHaveLength(2);
    // Both edits are undoable steps.
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expectClose(await compositePixel(page, 5, 5), [78, 20, 98, 255], 1, 'after undo');
    expectNoProblems(app);
  });

  test('isolated groups differ from pass-through groups', async ({ page }) => {
    const app = await openApp(page);
    const [base, inner] = await buildDoc(page, 16, 16, [
      { name: 'Base', color: [128, 128, 128] },
      { name: 'Inner', color: [255, 64, 0], blendMode: 'multiply' },
    ]);
    // Wrap Inner into a pass-through group: multiply reaches the base layer.
    await page.evaluate((ids) => {
      const ed = (window as any).__emulsion;
      ed.commit('Group', (d: any) => {
        const inner = d.layers.find((l: any) => l.id === ids.inner);
        const group = {
          id: 'grp',
          type: 'group',
          name: 'G',
          visible: true,
          opacity: 1,
          blendMode: 'passThrough',
          locks: { transparency: false, pixels: false, position: false },
          mask: null,
          clipped: false,
          children: [inner],
          expanded: true,
        };
        return { ...d, layers: [d.layers.find((l: any) => l.id === ids.base), group] };
      });
    }, { base: base!, inner: inner! });
    expectClose(await compositePixel(page, 4, 4), [128, 32, 0, 255], 1, 'pass-through');
    // Isolated: multiply happens against transparency inside the group.
    await patchLayer(page, 'grp', { blendMode: 'normal' });
    expectClose(await compositePixel(page, 4, 4), [255, 64, 0, 255], 1, 'isolated');
    // Pass-through at 50% mixes the group's effect with the backdrop.
    await patchLayer(page, 'grp', { blendMode: 'passThrough', opacity: 0.5 });
    expectClose(await compositePixel(page, 4, 4), [128, 80, 64, 255], 1, 'pass-through 50%');
    expectNoProblems(app);
  });

  test('moves a layer with the Move tool and nudges with arrow keys', async ({ page }) => {
    const app = await openApp(page);
    const [, top] = await buildDoc(page, 400, 300, [
      { name: 'Base', color: [20, 20, 20] },
      { name: 'Box', color: [240, 10, 10], rect: [50, 50, 100, 100] },
    ]);
    await page.keyboard.press('KeyV');
    await page.keyboard.press('Control+Digit1');
    const view = await viewInfo(page);
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const sx = stage.x + view.panX + 100;
    const sy = stage.y + view.panY + 100;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 30, sy + 20, { steps: 5 });
    await page.mouse.up();
    expect(await layerBounds(page, top!)).toMatchObject({ x: 80, y: 70 });
    expect(await compositePixel(page, 85, 75)).toEqual([240, 10, 10, 255]);
    expect(await compositePixel(page, 55, 55)).toEqual([20, 20, 20, 255]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await layerBounds(page, top!)).toMatchObject({ x: 81, y: 80 });
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    // Consecutive nudges merge into one step, so one undo returns to the dragged position.
    expect(await layerBounds(page, top!)).toMatchObject({ x: 80, y: 70 });
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expect(await layerBounds(page, top!)).toMatchObject({ x: 50, y: 50 });
    expectNoProblems(app);
  });

  test('Free Transform scales numerically around the centre and commits/undoes', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 400, 300, [
      { name: 'Base', color: [0, 0, 0] },
      { name: 'Box', color: [0, 200, 0], rect: [100, 100, 100, 100] },
    ]);
    await page.keyboard.press('Control+Alt+KeyT');
    const options = page.getByRole('region', { name: 'Tool options' });
    await expect(options.getByText('Free Transform')).toBeVisible();
    const w = options.getByRole('textbox', { name: 'W' });
    await w.fill('50');
    await w.press('Enter');
    // Linked: H follows.
    await expect(options.getByRole('textbox', { name: 'H' })).toHaveValue('50');
    await page.keyboard.press('Enter');
    await expect(options.getByText('Free Transform')).toHaveCount(0);
    // 100×100 at (100,100) scaled 50% about its centre → (125,125)-(175,175).
    expect(await compositePixel(page, 150, 150)).toEqual([0, 200, 0, 255]);
    expect(await compositePixel(page, 126, 126)).toEqual([0, 200, 0, 255]);
    expect(await compositePixel(page, 110, 110)).toEqual([0, 0, 0, 255]);
    expect(await compositePixel(page, 180, 180)).toEqual([0, 0, 0, 255]);
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expect(await compositePixel(page, 110, 110)).toEqual([0, 200, 0, 255]);
    expectNoProblems(app);
  });

  test('Free Transform rotates by dragging outside the box and Esc cancels', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 300, 300, [
      { name: 'Base', color: [0, 0, 0] },
      { name: 'Bar', color: [250, 250, 250], rect: [100, 140, 100, 20] },
    ]);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('Control+Alt+KeyT');
    const options = page.getByRole('region', { name: 'Tool options' });
    await expect(options.getByText('Free Transform')).toBeVisible();
    const angle = options.getByRole('textbox', { name: 'Angle' });
    await angle.fill('90');
    await angle.press('Enter');
    // Preview: the horizontal bar is now vertical through the centre.
    expect(await compositePixel(page, 150, 110)).toEqual([250, 250, 250, 255]);
    expect(await compositePixel(page, 110, 150)).toEqual([0, 0, 0, 255]);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await compositePixel(page, 110, 150)).toEqual([250, 250, 250, 255]);
    // Drag outside the corner to rotate interactively, then commit.
    const view = await viewInfo(page);
    const stage = (await page.getByTestId('stage').boundingBox())!;
    await page.keyboard.press('Control+Alt+KeyT');
    await expect(options.getByText('Free Transform')).toBeVisible();
    const cx = stage.x + view.panX + 150;
    const cy = stage.y + view.panY + 150;
    await page.mouse.move(cx + 80, cy);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(cx + 2, cy + 80, { steps: 8 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await expect(angle).toHaveValue('90');
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await compositePixel(page, 150, 110)).toEqual([250, 250, 250, 255]);
    expectNoProblems(app);
  });

  test('rotates and flips the canvas exactly', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 40, 20, [
      { name: 'Base', color: [0, 0, 255] },
      { name: 'Marker', color: [255, 0, 0], rect: [5, 2, 1, 1] },
    ]);
    await page.getByRole('menuitem', { name: 'Image' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Rotate Canvas 90° Clockwise' }).click();
    expect(await docInfo(page)).toMatchObject({ width: 20, height: 40 });
    // (x, y) → (H − 1 − y, x)
    expect(await compositePixel(page, 17, 5)).toEqual([255, 0, 0, 255]);
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    await page.getByRole('menuitem', { name: 'Image' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Flip Canvas Horizontal' }).click();
    expect(await compositePixel(page, 34, 2)).toEqual([255, 0, 0, 255]);
    expect(await compositePixel(page, 5, 2)).toEqual([0, 0, 255, 255]);
    expectNoProblems(app);
  });

  test('crops non-destructively with the Crop tool', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 200, 100, [
      { name: 'Base', color: [10, 10, 10] },
      { name: 'Right', color: [200, 0, 0], rect: [150, 0, 50, 100] },
    ]);
    await page.keyboard.press('KeyC');
    const options = page.getByRole('region', { name: 'Tool options' });
    const w = options.getByRole('textbox', { name: 'W' });
    await w.fill('120');
    await w.press('Enter');
    await page.keyboard.press('Enter');
    expect(await docInfo(page)).toMatchObject({ width: 120, height: 100 });
    // Layers keep their off-canvas pixels: widening the canvas again reveals them.
    await page.getByRole('menuitem', { name: 'Image' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Canvas Size…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Canvas Size' });
    await dialog.getByRole('textbox', { name: 'Canvas width' }).fill('200');
    await dialog.getByRole('radio', { name: 'Anchor left' }).click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    expect(await docInfo(page)).toMatchObject({ width: 200, height: 100 });
    expect(await compositePixel(page, 180, 50)).toEqual([200, 0, 0, 255]);
    // Undo twice returns to the original canvas.
    await page.keyboard.press('Control+KeyZ');
    await page.keyboard.press('Control+KeyZ');
    await settle(page);
    expect(await docInfo(page)).toMatchObject({ width: 200, height: 100 });
    expect(await compositePixel(page, 180, 50)).toEqual([200, 0, 0, 255]);
    expectNoProblems(app);
  });

  test('image size resamples with area averaging', async ({ page }) => {
    const app = await openApp(page);
    // 64×64 1-px black/white checkerboard averages to mid grey when halved.
    await page.evaluate(() => {
      const ed = (window as any).__emulsion;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      const img = g.createImageData(64, 64);
      for (let i = 0; i < 64 * 64; i++) {
        const v = ((i % 64) + Math.floor(i / 64)) % 2 ? 255 : 0;
        img.data.set([v, v, v, 255], i * 4);
      }
      g.putImageData(img, 0, 0);
      ed.openImage(c, 'Checker');
    });
    await page.getByRole('menuitem', { name: 'Image' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Image Size…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Image Size' });
    await dialog.getByRole('textbox', { name: 'Width', exact: true }).fill('32');
    await dialog.getByRole('textbox', { name: 'Width', exact: true }).press('Tab');
    await expect(dialog.getByRole('textbox', { name: 'Height', exact: true })).toHaveValue('32');
    await dialog.getByRole('button', { name: 'Resize' }).click();
    expect(await docInfo(page)).toMatchObject({ width: 32, height: 32 });
    const px = await compositePixel(page, 16, 16);
    expectClose(px, [128, 128, 128, 255], 4, 'averaged checker');
    expectNoProblems(app);
  });

  test('duplicates, groups, ungroups, merges down and flattens', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 50, 50, [
      { name: 'Base', color: [0, 0, 255] },
      { name: 'Top', color: [255, 0, 0], rect: [10, 10, 10, 10] },
    ]);
    const rows = page.getByTestId('layer-row');
    await page.keyboard.press('Control+KeyJ');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Top copy');
    await page.keyboard.press('Control+KeyG');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Group 1');
    await page.keyboard.press('Control+Shift+KeyG');
    await expect(rows).toHaveCount(3);
    await rows.first().click();
    await page.keyboard.press('Control+KeyE');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Top');
    expect(await compositePixel(page, 12, 12)).toEqual([255, 0, 0, 255]);
    await page.getByRole('menuitem', { name: 'Layer' }).dispatchEvent('pointerdown');
    await page.getByRole('menuitem', { name: 'Flatten Image' }).click();
    await expect(rows).toHaveCount(1);
    expect(await compositePixel(page, 12, 12)).toEqual([255, 0, 0, 255]);
    expect(await compositePixel(page, 40, 40)).toEqual([0, 0, 255, 255]);
    expectNoProblems(app);
  });

  test('reorders layers by dragging rows in the layers panel', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 20, 20, [
      { name: 'Blue', color: [0, 0, 255] },
      { name: 'Red', color: [255, 0, 0] },
    ]);
    expect(await compositePixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
    const rows = page.getByTestId('layer-row');
    const blue = rows.filter({ hasText: 'Blue' });
    const red = rows.filter({ hasText: 'Red' });
    const from = (await blue.locator('span[title]').first().boundingBox())!;
    const to = (await red.boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 60, to.y + 6, { steps: 8 });
    await page.mouse.up();
    await expect(rows.first()).toContainText('Blue');
    expect(await compositePixel(page, 5, 5)).toEqual([0, 0, 255, 255]);
    expectNoProblems(app);
  });

  test('history panel jumps between states', async ({ page }) => {
    const app = await openApp(page);
    await buildDoc(page, 20, 20, [{ name: 'Base', color: [10, 20, 30] }]);
    await page.getByRole('button', { name: 'New layer' }).click();
    await page.getByRole('button', { name: 'New layer' }).click();
    await page.getByRole('tab', { name: 'History' }).click();
    const states = page.getByTestId('history-row');
    await expect(states).toHaveCount(4);
    await states.nth(1).click();
    await settle(page);
    expect((await docInfo(page))!.layers).toHaveLength(1);
    await expect(states.nth(3)).toHaveAttribute('data-future', 'true');
    await states.nth(3).click();
    await settle(page);
    expect((await docInfo(page))!.layers).toHaveLength(3);
    expectNoProblems(app);
  });

  test('position lock blocks moving', async ({ page }) => {
    const app = await openApp(page);
    const [, top] = await buildDoc(page, 100, 100, [
      { name: 'Base', color: [0, 0, 0] },
      { name: 'Locked', color: [255, 255, 0], rect: [10, 10, 20, 20] },
    ]);
    await page.getByRole('button', { name: 'Lock position' }).click();
    await page.keyboard.press('KeyV');
    await page.keyboard.press('ArrowRight');
    expect(await layerBounds(page, top!)).toMatchObject({ x: 10, y: 10 });
    await expect(page.getByText('position-locked')).toBeVisible();
    expectNoProblems(app);
  });
});
