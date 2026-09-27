import type { TextStyle } from '../doc/types';
import type { ResampleMode } from '../render/Resampler';
import type { SelectionMode } from '../selection/SelectionOps';

export type CropRatio = 'free' | 'original' | '1:1' | '4:5' | '5:4' | '2:3' | '3:2' | '16:9' | '9:16';

export interface MoveToolOptions {
  /** Click selects the topmost layer with pixels under the cursor (Ctrl/Cmd toggles). */
  autoSelect: boolean;
}

export interface CropToolOptions {
  ratio: CropRatio;
  deletePixels: boolean;
  overlay: 'thirds' | 'grid' | 'none';
}

export interface TransformToolOptions {
  interpolation: ResampleMode;
}

export interface BrushOptions {
  /** Diameter in document px. */
  size: number;
  /** 0 (soft) .. 1 (hard). */
  hardness: number;
  /** Maximum coverage of one stroke, 0..1. */
  opacity: number;
  /** Coverage added per dab, 0..1 (builds up within a stroke). */
  flow: number;
  /** Dab spacing as a fraction of the diameter. */
  spacing: number;
  /** Lazy-mouse smoothing, 0..1. */
  smoothing: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
}

export interface CloneOptions extends BrushOptions {
  /**
   * Aligned: the source moves with the brush and keeps its offset between strokes.
   * Otherwise every stroke starts sampling at the source point again.
   */
  aligned: boolean;
  /** Sample the active layer or the visible composite. */
  sample: 'current' | 'all';
}

export interface SelectionToolOptions {
  mode: SelectionMode;
  /** Feather radius in px applied to new shapes. */
  feather: number;
}

export interface MagicWandOptions {
  /** 0..255 per-channel tolerance. */
  tolerance: number;
  contiguous: boolean;
  /** Sample the merged image instead of the active layer. */
  sampleAll: boolean;
}

export interface EyedropperOptions {
  /** Averaging window: 1 (point), 3 or 5 px. */
  sampleSize: 1 | 3 | 5;
  sample: 'all' | 'current';
}

/** Style for new text layers (their colour is the foreground colour). */
export type TextToolOptions = Omit<TextStyle, 'color'>;

export interface ToolOptions {
  move: MoveToolOptions;
  text: TextToolOptions;
  crop: CropToolOptions;
  transform: TransformToolOptions;
  brush: BrushOptions;
  eraser: BrushOptions;
  cloneStamp: CloneOptions;
  healingBrush: CloneOptions;
  selection: SelectionToolOptions;
  magicWand: MagicWandOptions;
  eyedropper: EyedropperOptions;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  move: { autoSelect: false },
  text: { fontFamily: 'Arial', fontSize: 48, fontWeight: 400, italic: false, align: 'left', lineHeight: 1.2, letterSpacing: 0 },
  crop: { ratio: 'free', deletePixels: false, overlay: 'thirds' },
  transform: { interpolation: 'bicubic' },
  brush: {
    size: 30,
    hardness: 0.6,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    smoothing: 0.1,
    pressureSize: true,
    pressureOpacity: false,
  },
  eraser: {
    size: 50,
    hardness: 0.6,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    smoothing: 0.1,
    pressureSize: true,
    pressureOpacity: false,
  },
  cloneStamp: {
    size: 40,
    hardness: 0.5,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    smoothing: 0.1,
    pressureSize: true,
    pressureOpacity: false,
    aligned: true,
    sample: 'current',
  },
  healingBrush: {
    size: 40,
    hardness: 0.8,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    smoothing: 0.1,
    pressureSize: true,
    pressureOpacity: false,
    aligned: true,
    sample: 'current',
  },
  selection: { mode: 'replace', feather: 0 },
  magicWand: { tolerance: 32, contiguous: true, sampleAll: true },
  eyedropper: { sampleSize: 1, sample: 'all' },
};

/** Numeric state of an in-progress Free Transform, mirrored for the options bar. */
export interface TransformState {
  kind: 'transform';
  /** Centre of the transformed box in document px. */
  cx: number;
  cy: number;
  /** Scale in percent (negative when flipped). */
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  angle: number;
  /** Original content size in px. */
  width: number;
  height: number;
}

export interface CropState {
  kind: 'crop';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Interaction = TransformState | CropState | null;
