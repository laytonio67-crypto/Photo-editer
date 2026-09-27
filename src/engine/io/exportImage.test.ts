import { describe, expect, it } from 'vitest';
import { exportFileName, prepareExportPixels } from './exportImage';

describe('export pixel preparation', () => {
  const premultiplied = new Uint8Array([128, 0, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255]);

  it('un-premultiplies when keeping transparency', () => {
    expect(Array.from(prepareExportPixels(premultiplied, true, { r: 255, g: 255, b: 255 }))).toEqual([
      255, 0, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255,
    ]);
  });

  it('flattens onto the matte otherwise', () => {
    expect(Array.from(prepareExportPixels(premultiplied, false, { r: 255, g: 255, b: 255 }))).toEqual([
      255, 127, 127, 255, 255, 255, 255, 255, 10, 20, 30, 255,
    ]);
  });
});

describe('export file names', () => {
  it('uses the document name with the format extension', () => {
    expect(exportFileName('Holiday', 'jpeg')).toBe('Holiday.jpg');
    expect(exportFileName('a/b: c?', 'png')).toBe('a b c.png');
    expect(exportFileName('  ', 'webp')).toBe('Untitled.webp');
  });
});
