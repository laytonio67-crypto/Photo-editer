import { createId } from '../store';
import type { Adjustment } from '../adjustments/types';
import {
  NO_LOCKS,
  type AdjustmentLayer,
  type DocState,
  type GroupLayer,
  type Layer,
  type PixelLayer,
  type SurfaceId,
  type TextLayer,
  type TextStyle,
} from './types';

export function createDocState(init: {
  name: string;
  width: number;
  height: number;
  resolution?: number;
  layers?: Layer[];
}): DocState {
  const layers = init.layers ?? [];
  const top = layers[layers.length - 1] ?? null;
  return {
    id: createId('doc'),
    name: init.name,
    width: init.width,
    height: init.height,
    resolution: init.resolution ?? 72,
    layers,
    activeLayerId: top?.id ?? null,
    selectedLayerIds: top ? [top.id] : [],
    editTarget: 'content',
    selection: null,
  };
}

export function createPixelLayer(init: { name: string; surfaceId: SurfaceId; x?: number; y?: number }): PixelLayer {
  return {
    id: createId('layer'),
    type: 'pixel',
    name: init.name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    mask: null,
    clipped: false,
    surfaceId: init.surfaceId,
    x: init.x ?? 0,
    y: init.y ?? 0,
  };
}

export function createGroupLayer(init: { name: string; children?: Layer[] }): GroupLayer {
  return {
    id: createId('group'),
    type: 'group',
    name: init.name,
    visible: true,
    opacity: 1,
    blendMode: 'passThrough',
    locks: { ...NO_LOCKS },
    mask: null,
    clipped: false,
    children: init.children ?? [],
    expanded: true,
  };
}

export function createAdjustmentLayer(init: { name: string; adjustment: Adjustment }): AdjustmentLayer {
  return {
    id: createId('adj'),
    type: 'adjustment',
    name: init.name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    mask: null,
    clipped: false,
    adjustment: init.adjustment,
  };
}

export const DEFAULT_TEXT_STYLE: TextStyle = Object.freeze({
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 400,
  italic: false,
  color: Object.freeze({ r: 0, g: 0, b: 0 }),
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
}) as TextStyle;

export function createTextLayer(init: {
  content: string;
  x: number;
  y: number;
  style?: Partial<TextStyle>;
}): TextLayer {
  const firstLine = init.content.split('\n')[0]?.trim() ?? '';
  return {
    id: createId('text'),
    type: 'text',
    name: firstLine.slice(0, 40) || 'Text',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    mask: null,
    clipped: false,
    content: init.content,
    style: { ...DEFAULT_TEXT_STYLE, ...init.style },
    x: init.x,
    y: init.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}
