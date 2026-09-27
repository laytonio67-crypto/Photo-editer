import { IDENTITY_CURVE, IDENTITY_LEVELS, isIdentityCurve, isIdentityLevels } from './curves';
import type { Adjustment, AdjustmentKind } from './types';

/** Static description of an adjustment kind: naming, defaults and render traits. */
export interface AdjustmentInfo {
  kind: AdjustmentKind;
  /** Name used for new layers and menus. */
  label: string;
  defaults: () => Adjustment;
  /** True when the parameters leave the image unchanged (rendering is skipped). */
  isIdentity: (a: Adjustment) => boolean;
  /**
   * How far (px) the result at a pixel depends on its neighbours. 0 for point
   * operations; filters make the compositor render with this much margin.
   */
  margin: (a: Adjustment) => number;
}

/** Kernel reach for a Gaussian of standard deviation σ. */
export function gaussianReach(sigma: number): number {
  return sigma <= 0 ? 0 : Math.ceil(sigma * 3) + 1;
}

const pointwise = () => 0;

export const ADJUSTMENTS: Record<AdjustmentKind, AdjustmentInfo> = {
  brightnessContrast: {
    kind: 'brightnessContrast',
    label: 'Brightness/Contrast',
    defaults: () => ({ kind: 'brightnessContrast', brightness: 0, contrast: 0 }),
    isIdentity: (a) => a.kind === 'brightnessContrast' && a.brightness === 0 && a.contrast === 0,
    margin: pointwise,
  },
  levels: {
    kind: 'levels',
    label: 'Levels',
    defaults: () => ({ kind: 'levels', rgb: { ...IDENTITY_LEVELS }, r: { ...IDENTITY_LEVELS }, g: { ...IDENTITY_LEVELS }, b: { ...IDENTITY_LEVELS } }),
    isIdentity: (a) =>
      a.kind === 'levels' && isIdentityLevels(a.rgb) && isIdentityLevels(a.r) && isIdentityLevels(a.g) && isIdentityLevels(a.b),
    margin: pointwise,
  },
  curves: {
    kind: 'curves',
    label: 'Curves',
    defaults: () => ({ kind: 'curves', rgb: [...IDENTITY_CURVE], r: [...IDENTITY_CURVE], g: [...IDENTITY_CURVE], b: [...IDENTITY_CURVE] }),
    isIdentity: (a) =>
      a.kind === 'curves' && isIdentityCurve(a.rgb) && isIdentityCurve(a.r) && isIdentityCurve(a.g) && isIdentityCurve(a.b),
    margin: pointwise,
  },
  exposure: {
    kind: 'exposure',
    label: 'Exposure',
    defaults: () => ({ kind: 'exposure', exposure: 0, offset: 0, gamma: 1 }),
    isIdentity: (a) => a.kind === 'exposure' && a.exposure === 0 && a.offset === 0 && a.gamma === 1,
    margin: pointwise,
  },
  vibrance: {
    kind: 'vibrance',
    label: 'Vibrance',
    defaults: () => ({ kind: 'vibrance', vibrance: 0, saturation: 0 }),
    isIdentity: (a) => a.kind === 'vibrance' && a.vibrance === 0 && a.saturation === 0,
    margin: pointwise,
  },
  hueSaturation: {
    kind: 'hueSaturation',
    label: 'Hue/Saturation',
    defaults: () => ({ kind: 'hueSaturation', hue: 0, saturation: 0, lightness: 0, colorize: false }),
    isIdentity: (a) => a.kind === 'hueSaturation' && !a.colorize && a.hue === 0 && a.saturation === 0 && a.lightness === 0,
    margin: pointwise,
  },
  whiteBalance: {
    kind: 'whiteBalance',
    label: 'White Balance',
    defaults: () => ({ kind: 'whiteBalance', temperature: 0, tint: 0 }),
    isIdentity: (a) => a.kind === 'whiteBalance' && a.temperature === 0 && a.tint === 0,
    margin: pointwise,
  },
  shadowsHighlights: {
    kind: 'shadowsHighlights',
    label: 'Shadows/Highlights',
    defaults: () => ({ kind: 'shadowsHighlights', shadows: 0, highlights: 0, radius: 30 }),
    isIdentity: (a) => a.kind === 'shadowsHighlights' && a.shadows === 0 && a.highlights === 0,
    margin: (a) => (a.kind === 'shadowsHighlights' ? gaussianReach(a.radius) : 0),
  },
  blackWhite: {
    kind: 'blackWhite',
    label: 'Black & White',
    // Photoshop's default mix.
    defaults: () => ({ kind: 'blackWhite', reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }),
    isIdentity: () => false,
    margin: pointwise,
  },
  gaussianBlur: {
    kind: 'gaussianBlur',
    label: 'Gaussian Blur',
    defaults: () => ({ kind: 'gaussianBlur', radius: 4 }),
    isIdentity: (a) => a.kind === 'gaussianBlur' && a.radius <= 0,
    margin: (a) => (a.kind === 'gaussianBlur' ? gaussianReach(a.radius) : 0),
  },
  sharpen: {
    kind: 'sharpen',
    label: 'Sharpen',
    defaults: () => ({ kind: 'sharpen', amount: 100, radius: 1.5, threshold: 0 }),
    isIdentity: (a) => a.kind === 'sharpen' && (a.amount <= 0 || a.radius <= 0),
    margin: (a) => (a.kind === 'sharpen' ? gaussianReach(a.radius) : 0),
  },
};

/** Menu order: tonal first, then colour, then filters. */
export const ADJUSTMENT_ORDER: AdjustmentKind[] = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'shadowsHighlights',
  'vibrance',
  'hueSaturation',
  'whiteBalance',
  'blackWhite',
  'gaussianBlur',
  'sharpen',
];

export function adjustmentInfo(kind: AdjustmentKind): AdjustmentInfo {
  return ADJUSTMENTS[kind];
}

export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  return ADJUSTMENTS[kind].defaults();
}
