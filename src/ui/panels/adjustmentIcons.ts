import {
  Aperture,
  ChartColumn,
  Contrast,
  Droplets,
  Focus,
  Palette,
  Sparkles,
  Spline,
  SunMedium,
  SunMoon,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import type { AdjustmentKind } from '../../engine/adjustments/types';

/** Icon shown for each adjustment kind (layer thumbnails, menus). */
export const ADJUSTMENT_ICONS: Record<AdjustmentKind, LucideIcon> = {
  brightnessContrast: SunMedium,
  levels: ChartColumn,
  curves: Spline,
  exposure: Aperture,
  shadowsHighlights: SunMoon,
  vibrance: Sparkles,
  hueSaturation: Palette,
  whiteBalance: Thermometer,
  blackWhite: Contrast,
  gaussianBlur: Droplets,
  sharpen: Focus,
};
