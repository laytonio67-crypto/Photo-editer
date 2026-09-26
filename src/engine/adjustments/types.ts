/**
 * Parameter sets for non-destructive adjustment layers. Values are stored in the
 * units shown in the UI so documents stay readable and stable across versions.
 */

export interface BrightnessContrastAdjustment {
  kind: 'brightnessContrast';
  /** -150..150 */
  brightness: number;
  /** -100..100 */
  contrast: number;
}

export interface ExposureAdjustment {
  kind: 'exposure';
  /** Stops, -5..5 */
  exposure: number;
  /** -0.5..0.5, added in linear light */
  offset: number;
  /** 0.1..9.99 gamma correction */
  gamma: number;
}

export interface LevelsChannel {
  inBlack: number; // 0..253
  inWhite: number; // 2..255
  gamma: number; // 0.1..9.99
  outBlack: number; // 0..255
  outWhite: number; // 0..255
}

export interface LevelsAdjustment {
  kind: 'levels';
  rgb: LevelsChannel;
  r: LevelsChannel;
  g: LevelsChannel;
  b: LevelsChannel;
}

export interface CurvePoint {
  /** Input 0..255 */
  x: number;
  /** Output 0..255 */
  y: number;
}

export interface CurvesAdjustment {
  kind: 'curves';
  rgb: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
}

export interface HueSaturationAdjustment {
  kind: 'hueSaturation';
  /** Degrees, -180..180 */
  hue: number;
  /** -100..100 */
  saturation: number;
  /** -100..100 */
  lightness: number;
  colorize: boolean;
}

export interface VibranceAdjustment {
  kind: 'vibrance';
  /** -100..100 */
  vibrance: number;
  /** -100..100 */
  saturation: number;
}

export interface WhiteBalanceAdjustment {
  kind: 'whiteBalance';
  /** -100 (cool) .. 100 (warm) */
  temperature: number;
  /** -100 (green) .. 100 (magenta) */
  tint: number;
}

export interface ShadowsHighlightsAdjustment {
  kind: 'shadowsHighlights';
  /** -100..100: lift (+) or deepen (-) shadows */
  shadows: number;
  /** -100..100: recover (-) or boost (+) highlights */
  highlights: number;
}

export interface BlackWhiteAdjustment {
  kind: 'blackWhite';
  /** Per hue-sector weights, percent (-200..300), Photoshop "Black & White" style. */
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
}

export interface GaussianBlurAdjustment {
  kind: 'gaussianBlur';
  /** Radius in document pixels (≈ 3σ is covered by the kernel). */
  radius: number;
}

export interface SharpenAdjustment {
  kind: 'sharpen';
  /** Unsharp-mask amount in percent, 0..500 */
  amount: number;
  /** Blur radius in document pixels */
  radius: number;
  /** Levels (0..255) of difference below which no sharpening is applied */
  threshold: number;
}

export type Adjustment =
  | BrightnessContrastAdjustment
  | ExposureAdjustment
  | LevelsAdjustment
  | CurvesAdjustment
  | HueSaturationAdjustment
  | VibranceAdjustment
  | WhiteBalanceAdjustment
  | ShadowsHighlightsAdjustment
  | BlackWhiteAdjustment
  | GaussianBlurAdjustment
  | SharpenAdjustment;

export type AdjustmentKind = Adjustment['kind'];
