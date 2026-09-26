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
