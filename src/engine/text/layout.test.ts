import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '../doc/factory';
import { applyAffine } from '../geometry';
import { fontString, layoutText, textMatrix, type TextMeasurer } from './layout';

/** Monospace fake: every character is 0.6 em wide, ink fills the advance. */
const mono: TextMeasurer = {
  measure(text, font, letterSpacing) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
    const width = text.length * (size * 0.6 + letterSpacing);
    return { width, inkLeft: 0, inkRight: width, inkAscent: size * 0.7, inkDescent: size * 0.2 };
  },
  fontExtents(font) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
    return { ascent: size * 0.8, descent: size * 0.2 };
  },
};

const style = { ...DEFAULT_TEXT_STYLE, fontSize: 20, lineHeight: 1.5 };

describe('text layout', () => {
  it('builds the CSS font shorthand, quoting non-generic families', () => {
    expect(fontString({ ...style, fontFamily: 'Times New Roman', italic: true, fontWeight: 700 })).toBe('italic 700 20px "Times New Roman"');
    expect(fontString({ ...style, fontFamily: 'monospace' })).toBe('400 20px monospace');
  });

  it('places baselines with CSS half-leading and aligns lines on the anchor', () => {
    const left = layoutText('ab\nabcd', style, mono);
    expect(left.lineHeight).toBe(30);
    // half-leading = (30 − 20) / 2 = 5; baseline = 5 + ascent 16 = 21
    expect(left.lines.map((l) => l.baseline)).toEqual([21, 51]);
    expect(left.lines.map((l) => l.x)).toEqual([0, 0]);
    expect(left.box).toEqual({ x: 0, y: 0, width: 48, height: 60 });

    const center = layoutText('ab\nabcd', { ...style, align: 'center' }, mono);
    expect(center.lines.map((l) => l.x)).toEqual([-12, -24]);
    const right = layoutText('ab\nabcd', { ...style, align: 'right' }, mono);
    expect(right.lines.map((l) => l.x)).toEqual([-24, -48]);
    expect(right.box.x).toBe(-48);
  });

  it('counts empty lines in the box but not in the ink', () => {
    const l = layoutText('abc\n\n', style, mono);
    expect(l.box.height).toBe(90);
    expect(l.ink!.y + l.ink!.height).toBeLessThan(30);
    expect(layoutText('   ', style, mono).ink).toBeNull();
  });

  it('letter spacing widens lines', () => {
    expect(layoutText('abcd', { ...style, letterSpacing: 5 }, mono).lines[0]!.width).toBe(68);
  });

  it('maps local coordinates through position, rotation and scale', () => {
    const m = textMatrix({ x: 100, y: 50, rotation: Math.PI / 2, scaleX: 2, scaleY: 1 });
    const p = applyAffine(m, { x: 10, y: 0 });
    // Scaled to 20 along x, rotated 90° clockwise (y-down) → +20 in y.
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(70, 9);
  });
});
