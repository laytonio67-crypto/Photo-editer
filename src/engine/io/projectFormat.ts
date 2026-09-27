import { collectDocSurfaces, mapLayers } from '../doc/layerTree';
import type { DocState, Layer, SurfaceId } from '../doc/types';

/** Version of the stored document format; bump with a migration when it changes. */
export const PROJECT_FORMAT_VERSION = 1;

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export interface StoredSurfaceInfo {
  id: SurfaceId;
  width: number;
  height: number;
  format: 'rgba8' | 'r8';
}

/** The document part of a saved project (pixels are stored separately per surface). */
export interface StoredDocument {
  id: string;
  formatVersion: number;
  doc: DocState;
  surfaces: StoredSurfaceInfo[];
}

/** Surfaces a document needs to be restored. */
export function documentSurfaceIds(doc: DocState): Set<SurfaceId> {
  return collectDocSurfaces(doc);
}

/** Rewrites surface ids (content, masks, selection) through `map`; unknown ids stay. */
export function remapSurfaceIds(doc: DocState, map: ReadonlyMap<SurfaceId, SurfaceId>): DocState {
  const re = (id: SurfaceId) => map.get(id) ?? id;
  const layers = mapLayers(doc.layers, (l): Layer => {
    const mask = l.mask ? { ...l.mask, surfaceId: re(l.mask.surfaceId) } : null;
    return l.type === 'pixel' ? { ...l, mask, surfaceId: re(l.surfaceId) } : { ...l, mask };
  });
  return { ...doc, layers, selection: doc.selection ? { ...doc.selection, surfaceId: re(doc.selection.surfaceId) } : null };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const LAYER_TYPES = new Set(['pixel', 'text', 'adjustment', 'group']);

function checkLayers(layers: unknown, path: string): void {
  if (!Array.isArray(layers)) throw new ProjectFormatError(`${path} is not a list of layers`);
  for (const l of layers) {
    if (!isObject(l) || typeof l.id !== 'string' || !LAYER_TYPES.has(l.type as string)) {
      throw new ProjectFormatError(`${path} contains an invalid layer`);
    }
    if (l.type === 'pixel' && typeof l.surfaceId !== 'string') throw new ProjectFormatError(`Layer “${String(l.name)}” has no pixels`);
    if (l.type === 'group') checkLayers(l.children, `Group “${String(l.name)}”`);
  }
}

/**
 * Checks a stored document before it is opened, so a damaged or foreign record fails
 * with a clear message instead of breaking the editor later.
 */
export function validateStoredDocument(value: unknown): StoredDocument {
  if (!isObject(value) || !isObject(value.doc) || !Array.isArray(value.surfaces)) {
    throw new ProjectFormatError('The project data is damaged.');
  }
  if (typeof value.formatVersion !== 'number' || value.formatVersion > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError('This project was saved by a newer version of Emulsion.');
  }
  const doc = value.doc;
  const dims = [doc.width, doc.height];
  if (!dims.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)) {
    throw new ProjectFormatError('The project has an invalid canvas size.');
  }
  checkLayers(doc.layers, 'The document');
  const stored = value as unknown as StoredDocument;
  const known = new Set(stored.surfaces.map((s) => s.id));
  for (const id of documentSurfaceIds(stored.doc)) {
    if (!known.has(id)) throw new ProjectFormatError('The project is missing pixel data.');
  }
  return stored;
}
