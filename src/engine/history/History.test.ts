import { describe, expect, it } from 'vitest';
import { History, type PatchTarget } from './History';
import { createDocState } from '../doc/factory';
import type { DocState } from '../doc/types';
import type { Rect } from '../geometry';

/** In-memory single-channel "surfaces" for testing patch application. */
class FakeSurfaces implements PatchTarget {
  data = new Map<string, { w: number; px: Uint8Array }>();
  add(id: string, w: number, h: number): void {
    this.data.set(id, { w, px: new Uint8Array(w * h) });
  }
  async read(id: string, r: Rect): Promise<Uint8Array> {
    const s = this.data.get(id)!;
    const out = new Uint8Array(r.width * r.height);
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) out[y * r.width + x] = s.px[(r.y + y) * s.w + r.x + x]!;
    return out;
  }
  write(id: string, r: Rect, d: Uint8Array): void {
    const s = this.data.get(id)!;
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) s.px[(r.y + y) * s.w + r.x + x] = d[y * r.width + x]!;
  }
  has(id: string): boolean {
    return this.data.has(id);
  }
  bytesPerPixel(): number {
    return 1;
  }
  fill(id: string, r: Rect, v: number): void {
    this.write(id, r, new Uint8Array(r.width * r.height).fill(v));
  }
}

function doc(name: string): DocState {
  return createDocState({ name, width: 4, height: 4 });
}

describe('History', () => {
  it('undoes and redoes structural states', async () => {
    const h = new History(new FakeSurfaces());
    let current = doc('a');
    const b = { ...current, name: 'b' };
    h.push({ label: 'Rename', before: current, after: b, patches: [] });
    current = b;
    await h.undo((d) => (current = d));
    expect(current.name).toBe('a');
    expect(h.canRedo).toBe(true);
    await h.redo((d) => (current = d));
    expect(current.name).toBe('b');
  });

  it('restores pixel patches, capturing after-state lazily', async () => {
    const s = new FakeSurfaces();
    s.add('px', 4, 4);
    const h = new History(s);
    const rect = { x: 1, y: 1, width: 2, height: 2 };
    const d = doc('a');
    // Edit 1: fill region with 10.
    const before1 = await s.read('px', rect);
    s.fill('px', rect, 10);
    h.push({ label: 'Paint 1', before: d, after: d, patches: [{ surfaceId: 'px', rect, before: before1, after: null }] });
    // Edit 2 (overlapping): fill with 20.
    const rect2 = { x: 2, y: 2, width: 2, height: 2 };
    const before2 = s.read('px', rect2); // promise form is supported too
    s.fill('px', rect2, 20);
    h.push({ label: 'Paint 2', before: d, after: d, patches: [{ surfaceId: 'px', rect: rect2, before: await before2, after: null }] });

    const noop = () => {};
    await h.undo(noop);
    expect(Array.from(await s.read('px', { x: 0, y: 0, width: 4, height: 4 }))).toEqual([
      0, 0, 0, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 0, 0, 0,
    ]);
    await h.undo(noop);
    expect(Array.from(s.data.get('px')!.px).every((v) => v === 0)).toBe(true);
    await h.redo(noop);
    await h.redo(noop);
    expect(Array.from(s.data.get('px')!.px)).toEqual([0, 0, 0, 0, 0, 10, 10, 0, 0, 10, 20, 20, 0, 0, 20, 20]);
  });

  it('discards the redo branch on push and merges by key', async () => {
    const h = new History(new FakeSurfaces());
    const a = doc('a');
    h.push({ label: 'One', before: a, after: a, patches: [] });
    h.push({ label: 'Two', before: a, after: a, patches: [] });
    await h.undo(() => {});
    h.push({ label: 'Three', before: a, after: a, patches: [] });
    expect(h.snapshot().labels).toEqual(['One', 'Three']);
    h.push({ label: 'Nudge', before: a, after: a, patches: [], mergeKey: 'nudge' });
    h.push({ label: 'Nudge', before: a, after: { ...a, name: 'z' }, patches: [], mergeKey: 'nudge' });
    expect(h.snapshot().labels).toEqual(['One', 'Three', 'Nudge']);
  });

  it('trims the oldest entries beyond the cap', () => {
    const h = new History(new FakeSurfaces(), { maxEntries: 3 });
    const a = doc('a');
    for (let i = 0; i < 5; i++) h.push({ label: `E${i}`, before: a, after: a, patches: [] });
    const snap = h.snapshot();
    expect(snap.labels).toEqual(['E2', 'E3', 'E4']);
    expect(snap.baseLabel).toBe('E1');
    expect(snap.index).toBe(3);
  });

  it('jumps to arbitrary positions', async () => {
    const h = new History(new FakeSurfaces());
    const states = ['s0', 's1', 's2', 's3'].map(doc);
    for (let i = 1; i < states.length; i++) h.push({ label: `to ${i}`, before: states[i - 1]!, after: states[i]!, patches: [] });
    let current = states[3]!;
    await h.goTo(1, (d) => (current = d));
    expect(current.name).toBe('s1');
    await h.goTo(3, (d) => (current = d));
    expect(current.name).toBe('s3');
    await h.goTo(0, (d) => (current = d));
    expect(current.name).toBe('s0');
  });
});
