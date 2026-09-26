import type { LayerBlendMode } from '../../engine/doc/types';

/** Blend modes grouped like pro editors list them; null = separator. */
export const BLEND_MODE_GROUPS: { value: LayerBlendMode; label: string }[][] = [
  [
    { value: 'normal', label: 'Normal' },
    { value: 'dissolve', label: 'Dissolve' },
  ],
  [
    { value: 'darken', label: 'Darken' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'colorBurn', label: 'Color Burn' },
    { value: 'linearBurn', label: 'Linear Burn' },
    { value: 'darkerColor', label: 'Darker Color' },
  ],
  [
    { value: 'lighten', label: 'Lighten' },
    { value: 'screen', label: 'Screen' },
    { value: 'colorDodge', label: 'Color Dodge' },
    { value: 'linearDodge', label: 'Linear Dodge (Add)' },
    { value: 'lighterColor', label: 'Lighter Color' },
  ],
  [
    { value: 'overlay', label: 'Overlay' },
    { value: 'softLight', label: 'Soft Light' },
    { value: 'hardLight', label: 'Hard Light' },
    { value: 'vividLight', label: 'Vivid Light' },
    { value: 'linearLight', label: 'Linear Light' },
    { value: 'pinLight', label: 'Pin Light' },
    { value: 'hardMix', label: 'Hard Mix' },
  ],
  [
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'divide', label: 'Divide' },
  ],
  [
    { value: 'hue', label: 'Hue' },
    { value: 'saturation', label: 'Saturation' },
    { value: 'color', label: 'Color' },
    { value: 'luminosity', label: 'Luminosity' },
  ],
];

export function blendModeLabel(mode: LayerBlendMode): string {
  if (mode === 'passThrough') return 'Pass Through';
  for (const g of BLEND_MODE_GROUPS) for (const m of g) if (m.value === mode) return m.label;
  return mode;
}
