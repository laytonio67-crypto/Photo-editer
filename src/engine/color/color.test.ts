import { describe, expect, it } from 'vitest';
import { hexToRgb, hsvToRgb, linearToSrgb, rgbToHex, rgbToHsv, srgbToLinear } from './color';
import { evaluateExpression } from '../../ui/controls/expression';
import { parseShortcut } from '../../app/shortcuts';

describe('color conversions', () => {
  it('round-trips RGB through HSV for every 17th value', () => {
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          expect(hsvToRgb(rgbToHsv({ r, g, b }))).toEqual({ r, g, b });
        }
  });

  it('parses and formats hex', () => {
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('3d86f5')).toEqual({ r: 0x3d, g: 0x86, b: 0xf5 });
    expect(hexToRgb('#12345')).toBeNull();
    expect(rgbToHex({ r: 1, g: 2, b: 255 })).toBe('0102ff');
  });

  it('inverts the sRGB transfer function', () => {
    for (const v of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
});

describe('numeric expressions', () => {
  it('evaluates arithmetic safely', () => {
    expect(evaluateExpression('1920/2')).toBe(960);
    expect(evaluateExpression('(100+25)*2')).toBe(250);
    expect(evaluateExpression('-3.5')).toBe(-3.5);
    expect(evaluateExpression('2,5')).toBe(2.5);
    expect(evaluateExpression('2+')).toBeNull();
    expect(evaluateExpression('alert(1)')).toBeNull();
    expect(evaluateExpression('1/0')).toBeNull();
  });
});

describe('shortcuts', () => {
  it('parses modifiers', () => {
    expect(parseShortcut('Shift+Mod+Z')).toEqual({ mod: true, shift: true, alt: false, key: 'z' });
    expect(parseShortcut('Mod+=')).toEqual({ mod: true, shift: false, alt: false, key: '=' });
    expect(parseShortcut('[')).toEqual({ mod: false, shift: false, alt: false, key: '[' });
  });
});
