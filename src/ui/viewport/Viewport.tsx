import { useLayoutEffect, useRef } from 'react';
import { FilePlus, FolderOpen, ImagePlus } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { getCommand, runCommand } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import { Ruler } from './Ruler';
import { TextEditOverlay } from './TextEditOverlay';
import { RecentProjects } from '../projects/RecentProjects';
import styles from './Viewport.module.css';

function StartScreen() {
  const editor = useEditor();
  const action = (id: string, icon: React.ReactNode, label: string) => {
    const shortcut = getCommand(id).shortcut;
    return (
      <button type="button" className={styles.startAction} onClick={() => runCommand(editor, id)}>
        {icon}
        <span>{label}</span>
        {shortcut && <kbd>{formatShortcut(shortcut)}</kbd>}
      </button>
    );
  };
  return (
    <div className={styles.start}>
      <div className={styles.startPanel}>
        <h1 className={styles.startTitle}>Start editing</h1>
        <p className={styles.startSubtitle}>Open a photo or create a blank canvas.</p>
        <div className={styles.startActions}>
          {action('file.open', <ImagePlus size={17} strokeWidth={1.6} />, 'Open image…')}
          {action('file.new', <FilePlus size={17} strokeWidth={1.6} />, 'New document…')}
          {action('file.openProject', <FolderOpen size={17} strokeWidth={1.6} />, 'Open project…')}
        </div>
        <p className={styles.startHint}>
          PNG, JPEG, WebP, AVIF, GIF and BMP are supported. You can also drop images anywhere in this window
          or paste one from the clipboard.
        </p>
        <RecentProjects />
      </div>
    </div>
  );
}

export function Viewport() {
  const editor = useEditor();
  const stageRef = useRef<HTMLDivElement>(null);
  const showRulers = useEditorState((s) => s.showRulers);
  const hasDoc = useEditorState((s) => s.doc !== null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.appendChild(editor.canvas);
    stage.appendChild(editor.overlay);
    const detach = editor.tools.attach(stage);

    const update = (width: number, height: number): void => {
      editor.view.setViewportSize(width, height, window.devicePixelRatio || 1);
    };
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const device = entry.devicePixelContentBoxSize?.[0];
      if (device) {
        update(device.inlineSize, device.blockSize);
      } else {
        const dpr = window.devicePixelRatio || 1;
        update(Math.round(entry.contentRect.width * dpr), Math.round(entry.contentRect.height * dpr));
      }
    });
    try {
      ro.observe(stage, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(stage);
    }
    return () => {
      ro.disconnect();
      detach();
      if (editor.canvas.parentNode === stage) stage.removeChild(editor.canvas);
      if (editor.overlay.parentNode === stage) stage.removeChild(editor.overlay);
    };
  }, [editor]);

  return (
    <div className={styles.viewport} data-rulers={showRulers && hasDoc ? 'true' : 'false'}>
      {showRulers && hasDoc && (
        <>
          <div className={styles.corner} />
          <Ruler orientation="horizontal" className={styles.rulerH} />
          <Ruler orientation="vertical" className={styles.rulerV} />
        </>
      )}
      <div ref={stageRef} className={styles.stage} tabIndex={-1} aria-label="Document canvas" data-testid="stage" />
      <TextEditOverlay />
      {!hasDoc && <StartScreen />}
    </div>
  );
}
