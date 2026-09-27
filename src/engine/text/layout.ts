import type { TextLayer, TextStyle } from '../doc/types';
import { multiplyAffine, rotation, scaling, translation, unionRects, type Affine, type Rect } from '../geometry';

/**
 * Point-text layout: lines are split on '\n' only (no wrapping). Coordinates are
 * layer-local, in unscaled document pixels: the anchor (x = alignment edge, y = top of
 * the first line box) is the origin and y grows downwards. Line boxes follow the CSS
 * model (half-leading around the font's ascent + descent), so a textarea styled with
 * the same font, line-height and letter-spacing overlays the rendered text exactly.
 */

/** Measurements the layout needs from a text engine (a 2D canvas in the browser). */
export interface TextMeasurer {
  /** Advance width and ink extents (relative to the pen position at the baseline). */
  measure(text: string, font: string, letterSpacing: number): {
    width: number;
    inkLeft: number;
    inkRight: number;
    inkAscent: number;
    inkDescent: number;
  };
  /** Ascent/descent of the font's line box. */
  fontExtents(font: string): { ascent: number; descent: number };
}

export interface LineLayout {
  text: string;
  /** Pen x of the line start (depends on alignment). */
  x: number;
  baseline: number;
  width: number;
}

export interface TextLayout {
  font: string;
  lines: LineLayout[];
  lineHeight: number;
  /** Union of the line boxes. */
  box: Rect;
  /** Glyph extents (padded); empty when there is no visible glyph. */
  ink: Rect | null;
}

/** Quotes a family name unless it is a CSS generic family. */
function familyToken(family: string): string {
  const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
  if (generic.includes(family)) return family;
  return `"${family.replace(/["\\]/g, '')}"`;
}

/** CSS font shorthand for a text style (also used by the canvas renderer). */
export function fontString(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${familyToken(style.fontFamily)}`;
}

/** Ink padding (px) so anti-aliased edges are never clipped. */
const INK_PAD = 2;

export function layoutText(content: string, style: TextStyle, measurer: TextMeasurer): TextLayout {
  const font = fontString(style);
  const lineHeight = Math.max(1, style.fontSize * style.lineHeight);
  const { ascent, descent } = measurer.fontExtents(font);
  const halfLeading = (lineHeight - (ascent + descent)) / 2;
  const lines: LineLayout[] = [];
  let ink: Rect | null = null;
  let x0 = Infinity;
  let x1 = -Infinity;
  content.split('\n').forEach((text, i) => {
    const m = measurer.measure(text, font, style.letterSpacing);
    const x = style.align === 'center' ? -m.width / 2 : style.align === 'right' ? -m.width : 0;
    const top = i * lineHeight;
    const baseline = top + halfLeading + ascent;
    lines.push({ text, x, baseline, width: m.width });
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x + m.width);
    if (text.trim().length > 0) {
      const glyphs = {
        x: x - m.inkLeft - INK_PAD,
        y: baseline - m.inkAscent - INK_PAD,
        width: m.inkLeft + m.inkRight + INK_PAD * 2,
        height: m.inkAscent + m.inkDescent + INK_PAD * 2,
      };
      ink = ink ? unionRects(ink, glyphs) : glyphs;
    }
  });
  // Every line counts towards the box, empty ones included (they still take a line).
  const box = { x: x0, y: 0, width: x1 - x0, height: lines.length * lineHeight };
  return { font, lines, lineHeight, box, ink };
}

/** Layer-local → document transform of a text layer. */
export function textMatrix(layer: Pick<TextLayer, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>): Affine {
  return multiplyAffine(translation(layer.x, layer.y), multiplyAffine(rotation(layer.rotation), scaling(layer.scaleX, layer.scaleY)));
}
