import { useEffect, useState } from 'react';
import { useEditor, useEditorState } from '../ui/editorContext';
import { MenuBar } from '../ui/menubar/MenuBar';
import { OptionsBar } from '../ui/optionsbar/OptionsBar';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { Viewport } from '../ui/viewport/Viewport';
import { Sidebar } from '../ui/panels/Sidebar';
import { StatusBar } from '../ui/statusbar/StatusBar';
import { DialogHost } from '../ui/dialogs/DialogHost';
import { Notices } from '../ui/notices/Notices';
import { Button } from '../ui/controls/Button';
import { imageFilesFromDataTransfer } from '../engine/io/decode';
import { commandEnabled, commandForEvent, runCommand } from './commands';
import { handlePastedFiles } from './clipboard';
import { isEditableTarget } from './shortcuts';
import styles from './App.module.css';

export function App() {
  const editor = useEditor();
  const fatalError = useEditorState((s) => s.fatalError);
  const [dragging, setDragging] = useState(false);

  // Global keyboard handling: commands first, then the active tool.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (editor.store.get().dialog) return;
      if (isEditableTarget(e.target)) return;
      if (editor.tools.capturesKey(e)) {
        if (editor.tools.handleKeyDown(e)) e.preventDefault();
        return;
      }
      const command = commandForEvent(e);
      if (command) {
        e.preventDefault();
        if (e.repeat && !command.repeatable) return;
        if (commandEnabled(command, editor.store.get(), editor) === true) runCommand(editor, command.id);
        return;
      }
      if (editor.tools.handleKeyDown(e)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return;
      if (editor.tools.handleKeyUp(e)) e.preventDefault();
    };
    const onBlur = (): void => editor.tools.handleBlur();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [editor]);

  // Paste: images from the system clipboard, or pixels copied inside the editor.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isEditableTarget(e.target) || editor.store.get().dialog) return;
      const files = imageFilesFromDataTransfer(e.clipboardData);
      if (files.length === 0 && !editor.clipboard) return;
      e.preventDefault();
      void handlePastedFiles(editor, files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [editor]);

  // Drag & drop anywhere in the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = imageFilesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) {
        editor.notify('error', 'Only image files (PNG, JPEG, WebP, AVIF, GIF, BMP, SVG) can be opened.');
        return;
      }
      void editor.importFiles(files, 'auto');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [editor]);

  // Warn before leaving with unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (editor.store.get().modified) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editor]);

  return (
    <div className={styles.app}>
      <MenuBar className={styles.menu} />
      <OptionsBar className={styles.options} />
      <Toolbar className={styles.tools} />
      <main className={styles.canvas} aria-label="Canvas">
        <Viewport />
        {dragging && <div className={styles.dropOverlay}>Drop images to open or place them as layers</div>}
      </main>
      <Sidebar className={styles.side} />
      <StatusBar className={styles.status} />
      <DialogHost />
      <Notices />
      {fatalError && (
        <div className={styles.fatal} role="alertdialog" aria-labelledby="fatal-title">
          <div className={styles.fatalBox}>
            <h1 id="fatal-title">Emulsion stopped</h1>
            <p>{fatalError}</p>
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
