import type { AdjustmentKind } from '../../../engine/adjustments/types';

/** Slider-only adjustment kinds and the parameters they expose. */
export type SliderKind = Exclude<AdjustmentKind, 'levels' | 'curves'>;

export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  unit?: string;
  track?: string;
}

const GREY_RAMP = 'linear-gradient(90deg, #000, #fff)';
const HUE_RAMP = 'linear-gradient(90deg, #0ff, #00f, #f0f, #f00, #ff0, #0f0, #0ff)';
const SATURATION_RAMP = 'linear-gradient(90deg, #808080, #e0302a)';

/** Track for a Black & White weight: from dark to light rendering of that hue. */
const weightRamp = (color: string) => `linear-gradient(90deg, #000, ${color} 45%, #fff)`;

export const SLIDER_SPECS: Record<SliderKind, SliderSpec[]> = {
  brightnessContrast: [
    { key: 'brightness', label: 'Brightness', min: -150, max: 150, track: GREY_RAMP },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, track: 'linear-gradient(90deg, #666, #777 50%, #000 50.5%, #fff)' },
  ],
  exposure: [
    { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, precision: 2, track: GREY_RAMP },
    { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.001, precision: 3 },
    { key: 'gamma', label: 'Gamma correction', min: 0.1, max: 9.99, step: 0.01, precision: 2 },
  ],
  shadowsHighlights: [
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, unit: '%', track: 'linear-gradient(90deg, #000, #555)' },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, unit: '%', track: 'linear-gradient(90deg, #aaa, #fff)' },
    { key: 'radius', label: 'Tonal radius', min: 1, max: 100, unit: 'px' },
  ],
  vibrance: [
    { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, track: 'linear-gradient(90deg, #8a8a8a, #c9a15a, #e05a2a)' },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, track: SATURATION_RAMP },
  ],
  hueSaturation: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, unit: '°', track: HUE_RAMP },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, track: SATURATION_RAMP },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, track: GREY_RAMP },
  ],
  whiteBalance: [
    { key: 'temperature', label: 'Temperature', min: -100, max: 100, track: 'linear-gradient(90deg, #3d7bf0, #e8e8e8, #f0b43d)' },
    { key: 'tint', label: 'Tint', min: -100, max: 100, track: 'linear-gradient(90deg, #3dbf55, #e8e8e8, #d04ad0)' },
  ],
  blackWhite: [
    { key: 'reds', label: 'Reds', min: -200, max: 300, unit: '%', track: weightRamp('#e33') },
    { key: 'yellows', label: 'Yellows', min: -200, max: 300, unit: '%', track: weightRamp('#ee3') },
    { key: 'greens', label: 'Greens', min: -200, max: 300, unit: '%', track: weightRamp('#3e3') },
    { key: 'cyans', label: 'Cyans', min: -200, max: 300, unit: '%', track: weightRamp('#3ee') },
    { key: 'blues', label: 'Blues', min: -200, max: 300, unit: '%', track: weightRamp('#33e') },
    { key: 'magentas', label: 'Magentas', min: -200, max: 300, unit: '%', track: weightRamp('#e3e') },
  ],
  gaussianBlur: [{ key: 'radius', label: 'Radius', min: 0.1, max: 100, step: 0.1, precision: 1, unit: 'px' }],
  sharpen: [
    { key: 'amount', label: 'Amount', min: 0, max: 500, unit: '%' },
    { key: 'radius', label: 'Radius', min: 0.1, max: 64, step: 0.1, precision: 1, unit: 'px' },
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, unit: 'lv' },
  ],
};

export function isSliderKind(kind: AdjustmentKind): kind is SliderKind {
  return kind !== 'levels' && kind !== 'curves';
}
