import type { ReactNode } from 'react';
import { Scan } from 'lucide-react';
import { useEditorState } from '../editorContext';
import { toolDef } from '../toolbar/toolDefs';
import type { ToolId } from '../../engine/tools/types';
import { CropOptions, MoveOptions, TransformOptions, ViewButtons } from './panels';
import { MagicWandOptions, SelectionOptions } from './selectionPanels';
import { BrushOptionsPanel, EyedropperOptionsPanel } from './paintPanels';
import styles from './OptionsBar.module.css';

const OPTION_PANELS: Partial<Record<ToolId, () => ReactNode>> = {
  move: () => <MoveOptions />,
  marqueeRect: () => <SelectionOptions hint="Drag to select · Shift square · Alt from centre · drag inside to move" />,
  marqueeEllipse: () => <SelectionOptions hint="Drag to select · Shift circle · Alt from centre · drag inside to move" />,
  lasso: () => <SelectionOptions hint="Drag to draw a freehand selection" />,
  polygonLasso: () => (
    <SelectionOptions hint="Click to add points · click the start, double-click or Enter to close · Backspace undoes a point" />
  ),
  magicWand: () => <MagicWandOptions />,
  crop: () => <CropOptions />,
  eyedropper: () => <EyedropperOptionsPanel />,
  brush: () => <BrushOptionsPanel tool="brush" />,
  eraser: () => <BrushOptionsPanel tool="eraser" />,
  hand: () => (
    <>
      <ViewButtons />
      <span className={styles.hint}>Drag to pan · Hold Space with any tool</span>
    </>
  ),
  zoom: () => (
    <>
      <ViewButtons />
      <span className={styles.hint}>Click to zoom in · Alt-click to zoom out · Drag to scrub</span>
    </>
  ),
};

export function OptionsBar({ className }: { className?: string }) {
  const tool = useEditorState((s) => s.tool);
  const transforming = useEditorState((s) => s.interaction?.kind === 'transform');
  const def = toolDef(tool);
  const Panel = OPTION_PANELS[tool];
  return (
    <div className={`${styles.bar} ${className ?? ''}`} role="region" aria-label="Tool options">
      {transforming ? (
        <>
          <div className={styles.toolBadge}>
            <Scan size={17} strokeWidth={1.6} />
            <span>Free Transform</span>
          </div>
          <TransformOptions />
        </>
      ) : (
        <>
          <div className={styles.toolBadge}>
            {def.icon}
            <span>{def.label}</span>
          </div>
          {Panel && <Panel />}
        </>
      )}
    </div>
  );
}
