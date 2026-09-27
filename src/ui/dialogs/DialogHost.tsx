import { useEditor, useEditorState } from '../editorContext';
import { Modal } from '../controls/Modal';
import { Button } from '../controls/Button';
import { COMMANDS, commandLabel } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import { NewDocumentDialog } from './NewDocumentDialog';
import { CanvasSizeDialog, ImageSizeDialog } from './SizeDialogs';
import { FeatherDialog } from './FeatherDialog';
import { ExportDialog } from './ExportDialog';
import { SaveProjectDialog } from '../projects/SaveProjectDialog';
import { ProjectsDialog } from '../projects/ProjectsDialog';
import styles from './Dialogs.module.css';

function ShortcutsDialog() {
  const editor = useEditor();
  const state = useEditorState((s) => s);
  const groups: Record<string, typeof COMMANDS> = {};
  for (const c of COMMANDS) {
    if (!c.shortcut) continue;
    const group = c.id.split('.')[0]!;
    (groups[group] ??= []).push(c);
  }
  const titles: Record<string, string> = {
    file: 'File',
    edit: 'Edit',
    image: 'Image',
    layer: 'Layer',
    adjust: 'Adjustments',
    select: 'Select',
    toolGroup: 'Tools',
    toolGroupCycle: 'Tools',
    view: 'View',
    tool: 'Tools',
    color: 'Colors',
    help: 'Help',
  };
  return (
    <Modal
      title="Keyboard Shortcuts"
      width={460}
      onClose={() => editor.closeDialog()}
      footer={<Button onClick={() => editor.closeDialog()}>Close</Button>}
    >
      <table className={styles.shortcutTable}>
        <tbody>
          {Object.entries(groups).map(([group, commands]) => (
            <Group key={group} title={titles[group] ?? group}>
              {commands.map((c) => (
                <tr key={c.id}>
                  <td>{commandLabel(c, state)}</td>
                  <td>{formatShortcut(c.shortcut!)}</td>
                </tr>
              ))}
            </Group>
          ))}
          <Group title="Viewport">
            <tr>
              <td>Pan (temporary Hand)</td>
              <td>Space + drag</td>
            </tr>
            <tr>
              <td>Pan</td>
              <td>Middle mouse / wheel</td>
            </tr>
            <tr>
              <td>Zoom at cursor</td>
              <td>{formatShortcut('Mod+')}wheel · Alt+wheel · pinch</td>
            </tr>
          </Group>
          <Group title="Painting & text">
            <tr>
              <td>Brush size / hardness</td>
              <td>[ ] · Shift+[ ]</td>
            </tr>
            <tr>
              <td>Opacity (Shift: flow)</td>
              <td>1 … 0</td>
            </tr>
            <tr>
              <td>Set clone / healing source</td>
              <td>Alt+click</td>
            </tr>
            <tr>
              <td>Finish editing text</td>
              <td>Esc · {formatShortcut('Mod+Enter')}</td>
            </tr>
          </Group>
        </tbody>
      </table>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={2}>{title}</th>
      </tr>
      {children}
    </>
  );
}

function AboutDialog() {
  const editor = useEditor();
  return (
    <Modal
      title="About Emulsion"
      width={420}
      onClose={() => editor.closeDialog()}
      footer={<Button onClick={() => editor.closeDialog()}>Close</Button>}
    >
      <p className={styles.message}>
        Emulsion is a layer-based photo editor that runs entirely in your browser. Images never leave this
        device: compositing, adjustments and painting run on your GPU through WebGL 2.
      </p>
      <p className={styles.message} style={{ marginTop: 10 }}>
        Renderer: {editor.caps.renderer}
        <br />
        Maximum document size: {editor.caps.maxDocumentSize} × {editor.caps.maxDocumentSize} px
        <br />
        Compositing precision: {editor.gpu.accumFormat === 'rgba16f' ? '16-bit float' : '8-bit'}
      </p>
    </Modal>
  );
}

export function DialogHost() {
  const dialog = useEditorState((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'newDocument':
      return <NewDocumentDialog />;
    case 'confirm':
      return (
        <Modal
          title={dialog.title}
          width={420}
          onClose={() => dialog.resolve(false)}
          onSubmit={() => dialog.resolve(true)}
          footer={
            <>
              <Button onClick={() => dialog.resolve(false)}>{dialog.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={dialog.danger ? 'danger' : 'primary'} data-autofocus onClick={() => dialog.resolve(true)}>
                {dialog.confirmLabel}
              </Button>
            </>
          }
        >
          <p className={styles.message}>{dialog.message}</p>
        </Modal>
      );
    case 'about':
      return <AboutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'imageSize':
      return <ImageSizeDialog />;
    case 'canvasSize':
      return <CanvasSizeDialog />;
    case 'feather':
      return <FeatherDialog />;
    case 'export':
      return <ExportDialog />;
    case 'saveProject':
      return <SaveProjectDialog saveAs={dialog.saveAs} />;
    case 'projects':
      return <ProjectsDialog />;
  }
}
