import type { ResampleMode } from '../render/Resampler';

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

export interface ToolOptions {
  move: MoveToolOptions;
  crop: CropToolOptions;
  transform: TransformToolOptions;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  move: { autoSelect: false },
  crop: { ratio: 'free', deletePixels: false, overlay: 'thirds' },
  transform: { interpolation: 'bicubic' },
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
