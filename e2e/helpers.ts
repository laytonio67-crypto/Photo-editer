import { expect, type Page } from '@playwright/test';

/** Console messages that come from the headless software GPU, not from the app. */
const IGNORED_CONSOLE = [
  /Automatic fallback to software WebGL/,
  /GPU stall due to ReadPixels/,
  /React DevTools/,
  /\[vite\]/,
  /GL Driver Message/,
];

export interface AppHandle {
  page: Page;
  /** Console errors/warnings and page errors not on the ignore list. */
  problems: string[];
}

export async function openApp(page: Page): Promise<AppHandle> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    problems.push(`[${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  await page.goto('/');
  await page.waitForFunction(() => '__emulsion' in window);
  return { page, problems };
}

export async function importViaDialog(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  mode: 'open' | 'place' = 'open',
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(mode === 'open' ? 'Control+KeyO' : 'Control+Shift+KeyP');
  await (await chooser).setFiles(file);
  await page.waitForFunction(() => {
    const ed = (window as any).__emulsion;
    return ed.store.get().busy === null && ed.store.get().doc !== null;
  });
}

/** Premultiplied RGBA of one composite pixel. */
export async function compositePixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py]) => Array.from((window as any).__emulsion.readComposite({ x: px, y: py, width: 1, height: 1 })),
    [x, y],
  );
}

export interface LayerSummary {
  id: string;
  name: string;
  type: string;
  visible: boolean;
}

export interface DocSummary {
  width: number;
  height: number;
  name: string;
  layers: LayerSummary[];
  activeLayerId: string | null;
}

export async function docInfo(page: Page): Promise<DocSummary | null> {
  return page.evaluate(() => {
    const ed = (window as any).__emulsion;
    const d = ed.store.get().doc;
    const flatten = (layers: any[]): any[] => layers.flatMap((l) => [l, ...(l.children ? flatten(l.children) : [])]);
    return d
      ? {
          width: d.width as number,
          height: d.height as number,
          name: d.name as string,
          layers: flatten(d.layers).map((l: any) => ({ id: l.id, name: l.name, type: l.type, visible: l.visible })),
          activeLayerId: d.activeLayerId as string | null,
        }
      : null;
  });
}

export async function viewInfo(page: Page): Promise<{ zoom: number; panX: number; panY: number }> {
  return page.evaluate(() => ({ ...(window as any).__emulsion.view.transform }));
}

/** Waits until queued undo/redo and a render frame have completed. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ed = (window as any).__emulsion;
    await ed.history.idle();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

export function expectNoProblems(app: AppHandle): void {
  expect(app.problems, app.problems.join('\n')).toEqual([]);
}

export interface SolidLayerSpec {
  name: string;
  color: [number, number, number];
  /** x, y, width, height in document px (defaults to the whole document). */
  rect?: [number, number, number, number];
  blendMode?: string;
  opacity?: number;
}

/**
 * Builds a document from opaque solid-colour layers (bottom → top) through the editor's
 * public engine objects. Returns the created layer ids.
 */
export async function buildDoc(page: Page, width: number, height: number, layers: SolidLayerSpec[]): Promise<string[]> {
  return page.evaluate(
    ({ width, height, layers }) => {
      const ed = (window as any).__emulsion;
      const canvasFor = (w: number, h: number, color: number[]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        g.fillRect(0, 0, w, h);
        return c;
      };
      ed.newDocument({ name: 'Test', width, height, resolution: 72, background: 'transparent' });
      const ids: string[] = [];
      const built = layers.map((l, i) => {
        const [x, y, w, h] = l.rect ?? [0, 0, width, height];
        const surface = ed.surfaces.createFromImage(canvasFor(w, h, l.color));
        const id = `test_layer_${i}`;
        ids.push(id);
        return {
          id,
          type: 'pixel',
          name: l.name,
          visible: true,
          opacity: l.opacity ?? 1,
          blendMode: l.blendMode ?? 'normal',
          locks: { transparency: false, pixels: false, position: false },
          mask: null,
          clipped: false,
          surfaceId: surface.id,
          x,
          y,
        };
      });
      ed.commit('Build', (d: any) => ({
        ...d,
        layers: built,
        activeLayerId: ids[ids.length - 1],
        selectedLayerIds: [ids[ids.length - 1]],
      }));
      return ids;
    },
    { width, height, layers },
  );
}

/** Runs a document transformation inside the page (plain-object doc), recorded in history. */
export async function patchLayer(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ id, patch }) => {
      const ed = (window as any).__emulsion;
      const walk = (layers: any[]): any[] =>
        layers.map((l) => (l.id === id ? { ...l, ...patch } : l.children ? { ...l, children: walk(l.children) } : l));
      ed.commit('Patch', (d: any) => ({ ...d, layers: walk(d.layers) }));
    },
    { id, patch },
  );
}

/** Converts document coordinates to page (CSS) coordinates of the viewport. */
export async function docToPage(page: Page, x: number, y: number): Promise<[number, number]> {
  const view = await viewInfo(page);
  const box = (await page.getByTestId('stage').boundingBox())!;
  const dpr = await page.evaluate(() => (window as any).__emulsion.view.dpr as number);
  return [box.x + (view.panX + x * view.zoom) / dpr, box.y + (view.panY + y * view.zoom) / dpr];
}

/** Drags through document-space points with the mouse (modifiers held by the caller). */
export async function dragDoc(page: Page, points: [number, number][], steps = 4): Promise<void> {
  const [x0, y0] = await docToPage(page, points[0]![0], points[0]![1]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    const [px, py] = await docToPage(page, x, y);
    await page.mouse.move(px, py, { steps });
  }
  await page.mouse.up();
}

export async function clickDoc(page: Page, x: number, y: number, options?: { modifiers?: ('Shift' | 'Alt' | 'Control')[] }) {
  const [px, py] = await docToPage(page, x, y);
  for (const m of options?.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.click(px, py);
  for (const m of options?.modifiers ?? []) await page.keyboard.up(m);
}

/** Selection coverage (0..255) at a document pixel, or null without a selection. */
export async function selectionValue(page: Page, x: number, y: number): Promise<number | null> {
  return page.evaluate(
    ([px, py]) => {
      const ed = (window as any).__emulsion;
      const sel = ed.store.get().doc.selection;
      if (!sel) return null;
      const s = ed.surfaces.get(sel.surfaceId);
      const lx = px - sel.x;
      const ly = py - sel.y;
      if (lx < 0 || ly < 0 || lx >= s.width || ly >= s.height) return sel.defaultValue;
      return ed.surfaces.readSync(sel.surfaceId, { x: lx, y: ly, width: 1, height: 1 })[0];
    },
    [x, y],
  );
}

/** Sets tool options through the editor (faster and deterministic for tests). */
export async function setToolOptions(page: Page, tool: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ tool, patch }) => (window as any).__emulsion.setToolOptions(tool, patch), { tool, patch });
}

export async function setColors(page: Page, fg: [number, number, number], bg?: [number, number, number]): Promise<void> {
  await page.evaluate(
    ({ fg, bg }) =>
      (window as any).__emulsion.setColors({
        foreground: { r: fg[0], g: fg[1], b: fg[2] },
        ...(bg ? { background: { r: bg[0], g: bg[1], b: bg[2] } } : {}),
      }),
    { fg, bg },
  );
}
