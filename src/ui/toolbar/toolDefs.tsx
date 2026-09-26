import type { ReactNode } from 'react';
import {
  Bandage,
  Brush,
  CircleDashed,
  Crop,
  Eraser,
  Hand,
  Lasso,
  LassoSelect,
  Move,
  Pipette,
  SquareDashed,
  Stamp,
  Type,
  WandSparkles,
  ZoomIn,
} from 'lucide-react';
import type { ToolId } from '../../engine/tools/types';

export interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: ReactNode;
  /** Visual group; a separator is drawn between groups. */
  group: number;
}

const s = { size: 17, strokeWidth: 1.6 };

export const TOOL_DEFS: ToolDef[] = [
  { id: 'move', label: 'Move Tool', shortcut: 'V', icon: <Move {...s} />, group: 0 },
  { id: 'marqueeRect', label: 'Rectangular Marquee', shortcut: 'M', icon: <SquareDashed {...s} />, group: 0 },
  { id: 'marqueeEllipse', label: 'Elliptical Marquee', shortcut: 'M', icon: <CircleDashed {...s} />, group: 0 },
  { id: 'lasso', label: 'Lasso', shortcut: 'L', icon: <Lasso {...s} />, group: 0 },
  { id: 'polygonLasso', label: 'Polygonal Lasso', shortcut: 'L', icon: <LassoSelect {...s} />, group: 0 },
  { id: 'magicWand', label: 'Magic Wand', shortcut: 'W', icon: <WandSparkles {...s} />, group: 0 },
  { id: 'crop', label: 'Crop Tool', shortcut: 'C', icon: <Crop {...s} />, group: 1 },
  { id: 'eyedropper', label: 'Eyedropper', shortcut: 'I', icon: <Pipette {...s} />, group: 1 },
  { id: 'brush', label: 'Brush Tool', shortcut: 'B', icon: <Brush {...s} />, group: 2 },
  { id: 'eraser', label: 'Eraser Tool', shortcut: 'E', icon: <Eraser {...s} />, group: 2 },
  { id: 'cloneStamp', label: 'Clone Stamp', shortcut: 'S', icon: <Stamp {...s} />, group: 2 },
  { id: 'healingBrush', label: 'Healing Brush', shortcut: 'J', icon: <Bandage {...s} />, group: 2 },
  { id: 'text', label: 'Text Tool', shortcut: 'T', icon: <Type {...s} />, group: 3 },
  { id: 'hand', label: 'Hand Tool', shortcut: 'H', icon: <Hand {...s} />, group: 4 },
  { id: 'zoom', label: 'Zoom Tool', shortcut: 'Z', icon: <ZoomIn {...s} />, group: 4 },
];

export function toolDef(id: ToolId): ToolDef {
  return TOOL_DEFS.find((t) => t.id === id)!;
}
