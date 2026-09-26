import type { Editor } from '../Editor';
import { findLayer } from '../doc/layerTree';
import type { RGB } from '../doc/types';
import { intersectRects, isEmptyRect, type Point } from '../geometry';

/**
 * Averages the colour under a document point. `size` is the square window (1, 3 or 5).
 * `source` 'all' samples the composite, 'current' the active pixel layer.
 * Returns null over fully transparent pixels.
 */
export function sampleColor(editor: Editor, p: Point, size: 1 | 3 | 5, source: 'all' | 'current'): RGB | null {
  const doc = editor.doc;
  if (!doc) return null;
  const half = (size - 1) / 2;
  const rect = intersectRects(
    { x: Math.floor(p.x) - half, y: Math.floor(p.y) - half, width: size, height: size },
    { x: 0, y: 0, width: doc.width, height: doc.height },
  );
  if (isEmptyRect(rect)) return null;
  let pixels: Uint8Array | null = null;
  const layer = source === 'current' ? findLayer(doc.layers, doc.activeLayerId) : null;
  if (layer?.type === 'pixel') {
    const s = editor.surfaces.get(layer.surfaceId);
    const local = intersectRects({ ...rect, x: rect.x - layer.x, y: rect.y - layer.y }, { x: 0, y: 0, width: s.width, height: s.height });
    if (isEmptyRect(local)) return null;
    pixels = editor.surfaces.readSync(layer.surfaceId, local);
  } else {
    pixels = editor.readComposite(rect);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    a += pixels[i + 3]!;
  }
  if (a === 0) return null;
  // Premultiplied sums → straight colour.
  return {
    r: Math.min(255, Math.round((r * 255) / a)),
    g: Math.min(255, Math.round((g * 255) / a)),
    b: Math.min(255, Math.round((b * 255) / a)),
  };
}
