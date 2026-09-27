import type { Editor, EditorState } from '../Editor';
import { findLayer } from '../doc/layerTree';
import type { DocState, Layer, LayerId, PixelLayer, TextLayer, TextStyle } from '../doc/types';
import { replaceLayer } from '../ops/layerOps';
import { renderLayersToSurface } from './layerActions';

/** Text layers a style change applies to when no text is being edited. */
function selectedTextLayers(doc: DocState | null): TextLayer[] {
  if (!doc) return [];
  return doc.selectedLayerIds.map((id) => findLayer(doc.layers, id)).filter((l): l is TextLayer => l?.type === 'text');
}

/**
 * The style shown by text controls: the text being edited, else the active text layer,
 * else the defaults for new text (in the foreground colour).
 */
export function currentTextStyle(state: EditorState): TextStyle {
  const doc = state.doc;
  const id = state.textEditing?.layerId ?? doc?.activeLayerId;
  const layer = doc && id ? findLayer(doc.layers, id) : null;
  if (layer?.type === 'text') return layer.style;
  return { ...state.toolOptions.text, color: { ...state.foreground } };
}

/** Value equality of two text styles (for memoised selectors). */
export function sameTextStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.italic === b.italic &&
    a.align === b.align &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b
  );
}

/**
 * Applies a style change: to the text being edited (part of that edit), otherwise to
 * the selected text layers (one history entry; `mergeKey` merges slider drags). The
 * change also becomes the default for new text.
 */
export function applyTextStyle(editor: Editor, patch: Partial<TextStyle>, mergeKey?: string): void {
  const { color, ...rest } = patch;
  if (Object.keys(rest).length > 0) editor.setToolOptions('text', rest);
  if (editor.textTool.setStyle(patch)) return;
  const keys = Object.keys(patch) as (keyof TextStyle)[];
  const differs = (l: TextLayer) => keys.some((k) => JSON.stringify(l.style[k]) !== JSON.stringify(patch[k]));
  const selected = selectedTextLayers(editor.doc);
  if (selected.length === 0) {
    // No text to restyle: the colour control sets the colour of new text.
    if (color) editor.setColors({ foreground: color });
    return;
  }
  const targets = selected.filter(differs);
  if (targets.length === 0) return;
  editor.commit(
    'Text Style',
    (d) => targets.reduce((acc, t) => replaceLayer(acc, t.id, (l) => (l.type === 'text' ? { ...l, style: { ...l.style, ...patch } } : l)), d),
    mergeKey,
  );
}

export function canRasterize(doc: DocState | null): true | string {
  if (!doc) return 'Open or create a document first';
  const layer = findLayer(doc.layers, doc.activeLayerId);
  if (!layer) return 'No layer selected';
  return layer.type === 'text' ? true : 'Only text layers can be rasterized';
}

/**
 * Converts the active text layer into a pixel layer with the same appearance. Layer
 * properties (opacity, blend mode, mask, clipping, locks) carry over.
 */
export function rasterizeTextLayer(editor: Editor, id?: LayerId): void {
  const doc = editor.doc;
  const layer = doc ? findLayer(doc.layers, id ?? doc.activeLayerId) : null;
  if (!doc || !layer || layer.type !== 'text') return;
  const bounds = editor.text.bounds(layer);
  const region = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  // Render just the glyphs: full strength, normal mode, no mask or clipping.
  const flat: Layer = { ...layer, visible: true, opacity: 1, blendMode: 'normal', mask: null, clipped: false };
  const surface = bounds
    ? renderLayersToSurface(editor, doc, [flat], region)
    : editor.surfaces.createBlank(1, 1, 'rgba8');
  editor.commit('Rasterize Layer', (d) =>
    replaceLayer(d, layer.id, (l): Layer => {
      if (l.type !== 'text') return l;
      const pixel: PixelLayer = {
        id: l.id,
        type: 'pixel',
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        locks: l.locks,
        mask: l.mask,
        clipped: l.clipped,
        surfaceId: surface.id,
        x: region.x,
        y: region.y,
      };
      return pixel;
    }),
  );
}
