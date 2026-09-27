import { describe, expect, it } from 'vitest';
import { createGroupLayer, createPixelLayer, createDocState, createTextLayer } from '../doc/factory';
import type { DocState } from '../doc/types';
import { packSurface, unpackSurface } from './projectCodec';
import { PROJECT_FORMAT_VERSION, ProjectFormatError, remapSurfaceIds, validateStoredDocument } from './projectFormat';

function photoLike(width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      px[i] = (x * 2 + y) & 255;
      px[i + 1] = (x + y * 3) & 255;
      px[i + 2] = 128 + Math.round(40 * Math.sin(x / 5));
      px[i + 3] = 255;
    }
  }
  return px;
}

describe('project surface codec', () => {
  it('round-trips RGBA and R8 exactly and compresses smooth images', async () => {
    const rgba = photoLike(64, 48);
    const packed = await packSurface(rgba, 64, 48, 4);
    expect(packed.length).toBeLessThan(rgba.length / 4);
    expect(Array.from(await unpackSurface(packed, 64, 48, 4))).toEqual(Array.from(rgba));
    const mask = new Uint8Array(31 * 7).map((_, i) => (i * 13) & 255);
    expect(Array.from(await unpackSurface(await packSurface(mask, 31, 7, 1), 31, 7, 1))).toEqual(Array.from(mask));
  });

  it('rejects data of the wrong size', async () => {
    await expect(packSurface(new Uint8Array(10), 2, 2, 4)).rejects.toThrow();
    const packed = await packSurface(new Uint8Array(16), 2, 2, 4);
    await expect(unpackSurface(packed, 3, 3, 4)).rejects.toThrow();
  });
});

function sampleDoc(): DocState {
  const bg = createPixelLayer({ name: 'bg', surfaceId: 's_bg' });
  const masked = { ...createPixelLayer({ name: 'm', surfaceId: 's_px' }), mask: { surfaceId: 's_mask', x: 0, y: 0, defaultValue: 255, enabled: true, linked: true } };
  const text = createTextLayer({ content: 'Hi', x: 1, y: 2 });
  const doc = createDocState({ name: 'P', width: 10, height: 8, layers: [bg, createGroupLayer({ name: 'g', children: [masked, text] })] });
  return { ...doc, selection: { surfaceId: 's_sel', x: 0, y: 0, defaultValue: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } } };
}

describe('project format', () => {
  const surfaces = ['s_bg', 's_px', 's_mask', 's_sel'].map((id) => ({ id, width: 1, height: 1, format: 'rgba8' as const }));

  it('remaps content, mask and selection surface ids', () => {
    const doc = remapSurfaceIds(sampleDoc(), new Map([
      ['s_px', 'n_px'],
      ['s_mask', 'n_mask'],
      ['s_sel', 'n_sel'],
    ]));
    const group = doc.layers[1]!;
    expect(doc.layers[0]!.type === 'pixel' && doc.layers[0]!.surfaceId).toBe('s_bg');
    expect(group.type === 'group' && group.children[0]!.type === 'pixel' && group.children[0]!.surfaceId).toBe('n_px');
    expect(group.type === 'group' && group.children[0]!.mask?.surfaceId).toBe('n_mask');
    expect(doc.selection?.surfaceId).toBe('n_sel');
  });

  it('accepts valid documents and explains broken ones', () => {
    const doc = sampleDoc();
    expect(validateStoredDocument({ id: 'p', formatVersion: PROJECT_FORMAT_VERSION, doc, surfaces }).doc.name).toBe('P');
    expect(() => validateStoredDocument(null)).toThrow(ProjectFormatError);
    expect(() => validateStoredDocument({ id: 'p', formatVersion: 99, doc, surfaces })).toThrow(/newer version/);
    expect(() => validateStoredDocument({ id: 'p', formatVersion: 1, doc, surfaces: surfaces.slice(1) })).toThrow(/missing pixel data/);
    expect(() => validateStoredDocument({ id: 'p', formatVersion: 1, doc: { ...doc, width: 0 }, surfaces })).toThrow(/canvas size/);
    expect(() =>
      validateStoredDocument({ id: 'p', formatVersion: 1, doc: { ...doc, layers: [{ id: 'x', type: 'weird' }] }, surfaces }),
    ).toThrow(/invalid layer/);
  });
});
