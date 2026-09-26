import type { Editor, Transaction } from '../Editor';
import type { Point } from '../geometry';
import { ancestorsOf, panelOrder } from '../doc/layerTree';
import type { LayerId } from '../doc/types';
import { moveLayers, movableLayerIds } from '../ops/transformOps';
import { selectLayer } from '../ops/layerOps';
import type { Tool, ToolKeyEvent, ToolPointerEvent } from './types';

/**
 * Topmost visible pixel layer with a non-transparent pixel at a document point.
 * Reads single pixels synchronously; only used on click.
 */
export function pickLayerAt(editor: Editor, p: Point): LayerId | null {
  const doc = editor.doc;
  if (!doc) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  for (const { layer } of panelOrder(doc.layers, true)) {
    if (layer.type !== 'pixel' || !layer.visible) continue;
    if (!ancestorsOf(doc.layers, layer.id).every((g) => g.visible)) continue;
    const s = editor.surfaces.tryGet(layer.surfaceId);
    if (!s) continue;
    const lx = x - layer.x;
    const ly = y - layer.y;
    if (lx < 0 || ly < 0 || lx >= s.width || ly >= s.height) continue;
    const px = editor.surfaces.readSync(layer.surfaceId, { x: lx, y: ly, width: 1, height: 1 });
    if ((px[3] ?? 0) > 0) return layer.id;
  }
  return null;
}

/** Moves the selected layers by whole pixels (drag or arrow keys). */
export class MoveTool implements Tool {
  readonly id = 'move' as const;
  private drag: { start: Point; tx: Transaction; ids: LayerId[]; dx: number; dy: number } | null = null;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return 'move';
  }

  onPointerDown(e: ToolPointerEvent): void {
    const editor = this.editor;
    const autoSelect = editor.store.get().toolOptions.move.autoSelect !== e.mod;
    if (autoSelect) {
      const hit = pickLayerAt(editor, e.doc);
      if (hit) editor.updateDocSilently((d) => selectLayer(d, hit, e.shift ? 'toggle' : 'replace'));
    }
    const doc = editor.doc;
    if (!doc) return;
    const { ids, locked } = movableLayerIds(doc);
    if (ids.length === 0) {
      if (locked.length) editor.notify('info', 'The selected layer is position-locked.');
      return;
    }
    const tx = editor.beginTransaction();
    if (!tx) return;
    this.drag = { start: e.doc, tx, ids, dx: 0, dy: 0 };
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    const drag = this.drag;
    if (!pressed || !drag) return;
    let dx = Math.round(e.doc.x - drag.start.x);
    let dy = Math.round(e.doc.y - drag.start.y);
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (dx === drag.dx && dy === drag.dy) return;
    drag.dx = dx;
    drag.dy = dy;
    drag.tx.update(() => moveLayers(drag.tx.base, drag.ids, dx, dy));
  }

  onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.dx !== 0 || drag.dy !== 0) drag.tx.commit('Move');
    else drag.tx.cancel();
  }

  onCancel(): void {
    this.drag?.tx.cancel();
    this.drag = null;
  }

  onKeyDown(e: ToolKeyEvent): boolean {
    const step = e.shift ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d || e.mod || e.alt) return false;
    const doc = this.editor.doc;
    if (!doc) return false;
    const { ids, locked } = movableLayerIds(doc);
    if (ids.length === 0) {
      if (locked.length) this.editor.notify('info', 'The selected layer is position-locked.');
      return true;
    }
    this.editor.commit('Nudge', (x) => moveLayers(x, ids, d[0], d[1]), 'nudge');
    return true;
  }

  hasActiveGesture(): boolean {
    return this.drag !== null;
  }
}
