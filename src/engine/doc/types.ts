import type { Rect } from '../geometry';
import type { Adjustment } from '../adjustments/types';

export type LayerId = string;
export type SurfaceId = string;

/** Separable/non-separable blend modes, named after their Photoshop equivalents. */
export const BLEND_MODES = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'colorBurn',
  'linearBurn',
  'darkerColor',
  'lighten',
  'screen',
  'colorDodge',
  'linearDodge',
  'lighterColor',
  'overlay',
  'softLight',
  'hardLight',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/** Groups can additionally pass their children through to the backdrop. */
export type LayerBlendMode = BlendMode | 'passThrough';

export interface RGB {
  r: number; // 0..255
  g: number;
  b: number;
}

export interface LayerLocks {
  /** Painting only affects existing alpha (Photoshop "lock transparent pixels"). */
  transparency: boolean;
  /** No pixel edits at all. */
  pixels: boolean;
  /** No moving/transforming. */
  position: boolean;
}

export const NO_LOCKS: LayerLocks = Object.freeze({ transparency: false, pixels: false, position: false });

/**
 * A layer mask is a single-channel surface placed in document space. Outside the
 * surface, coverage is `defaultValue` (255 = reveal, 0 = hide), which lets masks stay
 * small while behaving as if they were infinite.
 */
export interface LayerMask {
  surfaceId: SurfaceId;
  x: number;
  y: number;
  defaultValue: number;
  enabled: boolean;
  /** When linked, moving the layer moves the mask with it. */
  linked: boolean;
}

interface LayerCommon {
  id: LayerId;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: LayerBlendMode;
  locks: LayerLocks;
  mask: LayerMask | null;
  /** Clipped to the layer directly below (clipping mask). */
  clipped: boolean;
}

/** Raster layer. Pixels live in a surface placed at an integer offset. */
export interface PixelLayer extends LayerCommon {
  type: 'pixel';
  surfaceId: SurfaceId;
  x: number;
  y: number;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  fontFamily: string;
  /** Size in document pixels. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: RGB;
  align: TextAlign;
  /** Line height as a multiple of font size. */
  lineHeight: number;
  /** Extra spacing between characters in document pixels. */
  letterSpacing: number;
}

/** Vector text layer. Its raster is a cache regenerated from these properties. */
export interface TextLayer extends LayerCommon {
  type: 'text';
  content: string;
  style: TextStyle;
  /** Anchor point (top of first line, at the alignment edge) in document space. */
  x: number;
  y: number;
  /** Radians, clockwise. */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Non-destructive adjustment applied to everything below it in the same group. */
export interface AdjustmentLayer extends LayerCommon {
  type: 'adjustment';
  adjustment: Adjustment;
}

export interface GroupLayer extends LayerCommon {
  type: 'group';
  /** Children bottom → top. */
  children: Layer[];
  expanded: boolean;
}

export type Layer = PixelLayer | TextLayer | AdjustmentLayer | GroupLayer;
export type LayerType = Layer['type'];

/**
 * Selection as a single-channel coverage surface (R8, 0..255) placed at (x, y) in
 * document space. Outside the surface, coverage is `defaultValue` (0, or 255 for
 * inverted selections), mirroring how layer masks are stored. `bounds` conservatively
 * encloses all selected (coverage > 0) document pixels, clamped to the canvas.
 */
export interface Selection {
  surfaceId: SurfaceId;
  x: number;
  y: number;
  defaultValue: number;
  bounds: Rect;
}

export type EditTarget = 'content' | 'mask';

export interface DocState {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Pixels per inch, stored as metadata for export. */
  resolution: number;
  /** Root layers bottom → top. */
  layers: Layer[];
  activeLayerId: LayerId | null;
  /** Layers selected in the layers panel (always includes the active layer when set). */
  selectedLayerIds: LayerId[];
  /** Whether edits on the active layer target its pixels or its mask. */
  editTarget: EditTarget;
  selection: Selection | null;
}
