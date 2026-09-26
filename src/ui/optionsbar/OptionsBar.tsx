import type { ReactNode } from 'react';
import { useEditor, useEditorState } from '../editorContext';
import { toolDef } from '../toolbar/toolDefs';
import { Button } from '../controls/Button';
import type { ToolId } from '../../engine/tools/types';
import styles from './OptionsBar.module.css';

function ViewButtons() {
  const editor = useEditor();
  const hasDoc = useEditorState((s) => s.doc !== null);
  return (
    <div className={styles.group}>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.actualPixels()}>
        100%
      </Button>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.fit()}>
        Fit Screen
      </Button>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.fill()}>
        Fill Screen
      </Button>
    </div>
  );
}

const OPTION_PANELS: Partial<Record<ToolId, () => ReactNode>> = {
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
  const def = toolDef(tool);
  const Panel = OPTION_PANELS[tool];
  return (
    <div className={`${styles.bar} ${className ?? ''}`} role="region" aria-label="Tool options">
      <div className={styles.toolBadge}>
        {def.icon}
        <span>{def.label}</span>
      </div>
      {Panel && <Panel />}
    </div>
  );
}

