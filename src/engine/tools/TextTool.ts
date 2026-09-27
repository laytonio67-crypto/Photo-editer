import type { Editor, Transaction } from '../Editor';
import { createTextLayer } from '../doc/factory';
import { findLayer, flattenLayers, isEffectivelyVisible } from '../doc/layerTree';
import type { LayerId, TextLayer, TextStyle } from '../doc/types';
import { applyAffine, expandRect, invertAffine, type Point } from '../geometry';
import { addLayer, deleteLayers, replaceLayer, selectLayer } from '../ops/layerOps';
import { textMatrix } from '../text/layout';
import type { Tool, ToolPointerEvent } from './types';

/** Default layer name for text content: its first line (like pro editors). */
export function textLayerName(content: string): string {
  return content.split('\n')[0]?.trim().slice(0, 40) || 'Text';
}

interface EditSession {
  tx: Transaction;
  layerId: LayerId;
  isNew: boolean;
}

/**
 * Text tool. Click empty canvas to start a new text layer (the click sets the first
 * baseline), click existing text to edit it. An editing session is one transaction:
 * typing and style changes preview live and become a single history entry on commit.
 * The editable text itself lives in a DOM overlay (see ui/viewport/TextEditOverlay).
 */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  private session: EditSession | null = null;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return 'text';
  }

  get editingLayerId(): LayerId | null {
    return this.session?.layerId ?? null;
  }

  onPointerDown(e: ToolPointerEvent): void {
    if (e.button !== 0) return;
    if (this.session) {
      // Clicking outside the text being edited finishes editing.
      this.commit();
      return;
    }
    const hit = this.textLayerAt(e.doc);
    if (hit) this.edit(hit.id);
    else this.create(e.doc);
  }

  /** Topmost visible text layer whose text box contains `p`. */
  textLayerAt(p: Point): TextLayer | null {
    const doc = this.editor.doc;
    if (!doc) return null;
    const layers = flattenLayers(doc.layers).reverse();
    for (const layer of layers) {
      if (layer.type !== 'text' || !isEffectivelyVisible(doc.layers, layer.id)) continue;
      const inv = invertAffine(textMatrix(layer));
      if (!inv) continue;
      const local = applyAffine(inv, p);
      const box = expandRect(this.editor.text.layout(layer).box, 4 / Math.max(0.01, Math.abs(layer.scaleX)));
      if (local.x >= box.x && local.x <= box.x + box.width && local.y >= box.y && local.y <= box.y + box.height) return layer;
    }
    return null;
  }

  /** Style for new text: tool defaults in the foreground colour. */
  newTextStyle(): TextStyle {
    const state = this.editor.store.get();
    return { ...state.toolOptions.text, color: { ...state.foreground } };
  }

  /** Starts a new, empty text layer whose first baseline passes through `p`. */
  create(p: Point): void {
    const editor = this.editor;
    if (!editor.doc) return;
    const style = this.newTextStyle();
    const baseline = editor.text.layout({ content: 'X', style }).lines[0]!.baseline;
    const layer = createTextLayer({ content: '', x: Math.round(p.x), y: Math.round(p.y - baseline), style });
    const tx = editor.beginTransaction();
    if (!tx) return;
    tx.update((d) => addLayer(d, layer));
    this.begin({ tx, layerId: layer.id, isNew: true });
  }

  /** Starts editing an existing text layer. */
  edit(layerId: LayerId): void {
    const editor = this.editor;
    const doc = editor.doc;
    const layer = doc ? findLayer(doc.layers, layerId) : null;
    if (!layer || layer.type !== 'text') return;
    if (this.session) this.commit();
    if (layer.locks.pixels) {
      editor.notify('info', 'The text layer is locked.');
      return;
    }
    const tx = editor.beginTransaction();
    if (!tx) return;
    tx.update((d) => selectLayer(d, layerId));
    this.begin({ tx, layerId, isNew: false });
  }

  private begin(session: EditSession): void {
    this.session = session;
    this.editor.store.set({ textEditing: { layerId: session.layerId, isNew: session.isNew } });
    this.editor.requestOverlay();
  }

  /** Replaces the edited layer's text (called by the editing overlay). */
  setContent(content: string): void {
    const s = this.session;
    if (!s?.tx.isOpen) return;
    s.tx.update((d) =>
      replaceLayer(d, s.layerId, (l) => {
        if (l.type !== 'text' || l.content === content) return l;
        // The name follows the text until the user renames the layer.
        const name = l.name === textLayerName(l.content) ? textLayerName(content) : l.name;
        return { ...l, content, name };
      }),
    );
  }

  /** Style change during editing (part of the session's history entry). */
  setStyle(patch: Partial<TextStyle>): boolean {
    const s = this.session;
    if (!s?.tx.isOpen) return false;
    s.tx.update((d) => replaceLayer(d, s.layerId, (l) => (l.type === 'text' ? { ...l, style: { ...l.style, ...patch } } : l)));
    return true;
  }

  /** Finishes editing. Empty text removes the layer. */
  commit(): void {
    const s = this.session;
    if (!s) return;
    this.end();
    if (!s.tx.isOpen) return;
    const doc = this.editor.doc;
    const layer = doc ? findLayer(doc.layers, s.layerId) : null;
    if (!layer || layer.type !== 'text' || layer.content.trim() === '') {
      if (s.isNew) {
        s.tx.cancel();
        return;
      }
      s.tx.update((d) => deleteLayers(d, [s.layerId]));
      s.tx.commit('Delete Text Layer');
      return;
    }
    s.tx.commit(s.isNew ? 'New Text Layer' : 'Edit Text');
  }

  /** Abandons editing and restores the text as it was. */
  cancel(): void {
    const s = this.session;
    if (!s) return;
    this.end();
    s.tx.cancel();
  }

  private end(): void {
    this.session = null;
    this.editor.store.set({ textEditing: null });
    this.editor.requestOverlay();
  }

  deactivate(): void {
    this.commit();
  }

  onCancel(): void {
    // Pointer capture lost: nothing to abort (editing happens in the overlay).
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    // Outline the text box being edited.
    const s = this.session;
    const doc = this.editor.doc;
    const layer = s && doc ? findLayer(doc.layers, s.layerId) : null;
    if (!layer || layer.type !== 'text') return;
    const view = this.editor.view;
    const m = textMatrix(layer);
    const box = this.editor.text.layout(layer).box;
    const pad = 3 / Math.max(0.01, view.zoom * Math.abs(layer.scaleX));
    const corners = [
      { x: box.x - pad, y: box.y - pad },
      { x: box.x + box.width + pad, y: box.y - pad },
      { x: box.x + box.width + pad, y: box.y + box.height + pad },
      { x: box.x - pad, y: box.y + box.height + pad },
    ].map((p) => view.docToScreen(applyAffine(m, p)));
    ctx.save();
    ctx.setLineDash([4 * view.dpr, 3 * view.dpr]);
    ctx.lineWidth = view.dpr;
    ctx.strokeStyle = 'rgba(61, 134, 245, 0.9)';
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
