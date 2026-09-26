import type { Editor, EditorState } from '../engine/Editor';
import type { ToolId } from '../engine/tools/types';
import { IMPORT_ACCEPT } from '../engine/io/decode';
import { deleteSelectedLayers, newPixelLayer } from '../engine/actions/layerActions';
import { pickFiles } from './filePicker';
import { matchesShortcut, parseShortcut, type ParsedShortcut } from './shortcuts';

/**
 * A user-invocable action. Menus, keyboard shortcuts and buttons all dispatch through
 * commands, so every entry point shares the same enabled-state logic.
 */
export interface Command {
  id: string;
  label: string | ((state: EditorState) => string);
  /** Primary shortcut shown in menus. */
  shortcut?: string;
  /** Extra shortcuts that also trigger the command. */
  altShortcuts?: string[];
  /** true when available; a string explains why it is disabled. */
  enabled?: (state: EditorState, editor: Editor) => true | string;
  checked?: (state: EditorState) => boolean;
  run: (editor: Editor) => void | Promise<void>;
  /** Shortcut should fire even with repeat keydown events (e.g. zoom). */
  repeatable?: boolean;
}

const NEEDS_DOC = 'Open or create a document first';

function needsDoc(state: EditorState): true | string {
  return state.doc ? true : NEEDS_DOC;
}

function toolCommand(id: ToolId, label: string, shortcut: string): Command {
  return {
    id: `tool.${id}`,
    label,
    shortcut,
    checked: (s) => s.tool === id,
    enabled: (_s, editor) => (editor.tools.has(id) ? true : 'Tool unavailable'),
    run: (editor) => editor.setTool(id),
  };
}

export const COMMANDS: Command[] = [
  // File
  {
    id: 'file.new',
    label: 'New…',
    shortcut: 'Alt+Mod+N',
    run: (editor) => editor.openDialog({ kind: 'newDocument' }),
  },
  {
    id: 'file.open',
    label: 'Open Image…',
    shortcut: 'Mod+O',
    run: async (editor) => {
      const files = await pickFiles(IMPORT_ACCEPT, false);
      if (files.length) await editor.importFiles(files, 'open');
    },
  },
  {
    id: 'file.place',
    label: 'Place Image as Layer…',
    shortcut: 'Shift+Mod+P',
    enabled: needsDoc,
    run: async (editor) => {
      const files = await pickFiles(IMPORT_ACCEPT, true);
      if (files.length) await editor.importFiles(files, 'place');
    },
  },
  {
    id: 'file.close',
    label: 'Close Document',
    shortcut: 'Alt+Mod+W',
    enabled: needsDoc,
    run: (editor) => editor.closeDocument(),
  },

  // Edit
  {
    id: 'edit.undo',
    label: (s) => (s.history.index > 0 ? `Undo ${s.history.labels[s.history.index - 1]}` : 'Undo'),
    shortcut: 'Mod+Z',
    enabled: (s) => (s.doc && s.history.index > 0 ? true : 'Nothing to undo'),
    run: (editor) => editor.undo(),
    repeatable: true,
  },
  {
    id: 'edit.redo',
    label: (s) =>
      s.history.index < s.history.labels.length ? `Redo ${s.history.labels[s.history.index]}` : 'Redo',
    shortcut: 'Shift+Mod+Z',
    altShortcuts: ['Mod+Y'],
    enabled: (s) => (s.doc && s.history.index < s.history.labels.length ? true : 'Nothing to redo'),
    run: (editor) => editor.redo(),
    repeatable: true,
  },

  // Layer
  {
    id: 'layer.new',
    label: 'New Layer',
    shortcut: 'Alt+Shift+Mod+N',
    enabled: needsDoc,
    run: (editor) => {
      newPixelLayer(editor);
    },
  },
  {
    id: 'layer.delete',
    label: 'Delete Layer',
    enabled: (s) => (!s.doc ? NEEDS_DOC : s.doc.selectedLayerIds.length === 0 ? 'No layer selected' : true),
    run: (editor) => deleteSelectedLayers(editor),
  },

  // View
  {
    id: 'view.zoomIn',
    label: 'Zoom In',
    shortcut: 'Mod+=',
    enabled: needsDoc,
    run: (editor) => editor.view.zoomIn(),
    repeatable: true,
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom Out',
    shortcut: 'Mod+-',
    enabled: needsDoc,
    run: (editor) => editor.view.zoomOut(),
    repeatable: true,
  },
  {
    id: 'view.fit',
    label: 'Fit on Screen',
    shortcut: 'Mod+0',
    enabled: needsDoc,
    run: (editor) => editor.view.fit(),
  },
  {
    id: 'view.actualPixels',
    label: '100% (Actual Pixels)',
    shortcut: 'Mod+1',
    enabled: needsDoc,
    run: (editor) => editor.view.actualPixels(),
  },
  {
    id: 'view.printSize',
    label: 'Screen Size (CSS Pixels)',
    enabled: needsDoc,
    run: (editor) => editor.view.printSize(),
  },
  {
    id: 'view.rulers',
    label: 'Rulers',
    shortcut: 'Mod+R',
    checked: (s) => s.showRulers,
    run: (editor) => editor.store.set((s) => ({ showRulers: !s.showRulers })),
  },
  {
    id: 'view.pixelGrid',
    label: 'Pixel Grid',
    shortcut: "Mod+'",
    checked: (s) => s.showPixelGrid,
    run: (editor) => {
      editor.store.set((s) => ({ showPixelGrid: !s.showPixelGrid }));
      editor.requestRender();
    },
  },

  // Tools
  toolCommand('hand', 'Hand Tool', 'H'),
  toolCommand('zoom', 'Zoom Tool', 'Z'),

  // Colours
  {
    id: 'color.swap',
    label: 'Swap Foreground/Background',
    shortcut: 'X',
    run: (editor) => editor.swapColors(),
  },
  {
    id: 'color.reset',
    label: 'Default Colors',
    shortcut: 'D',
    run: (editor) => editor.resetColors(),
  },

  // Help
  {
    id: 'help.shortcuts',
    label: 'Keyboard Shortcuts',
    shortcut: 'Mod+/',
    run: (editor) => editor.openDialog({ kind: 'shortcuts' }),
  },
  {
    id: 'help.about',
    label: 'About Emulsion',
    run: (editor) => editor.openDialog({ kind: 'about' }),
  },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): Command {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return c;
}

export function commandLabel(c: Command, state: EditorState): string {
  return typeof c.label === 'function' ? c.label(state) : c.label;
}

export function commandEnabled(c: Command, state: EditorState, editor: Editor): true | string {
  return c.enabled ? c.enabled(state, editor) : true;
}

/** Runs a command if enabled; reports failures as notices. */
export function runCommand(editor: Editor, id: string): void {
  const c = getCommand(id);
  if (commandEnabled(c, editor.store.get(), editor) !== true) return;
  try {
    const result = c.run(editor);
    if (result instanceof Promise) {
      result.catch((err: unknown) => editor.notify('error', `${commandLabel(c, editor.store.get())} failed`, String(err)));
    }
  } catch (err) {
    editor.notify('error', `${commandLabel(c, editor.store.get())} failed`, String(err));
  }
}

let parsed: { command: Command; shortcut: ParsedShortcut }[] | null = null;

function shortcutTable(): { command: Command; shortcut: ParsedShortcut }[] {
  if (!parsed) {
    parsed = [];
    for (const command of COMMANDS) {
      for (const spec of [command.shortcut, ...(command.altShortcuts ?? [])]) {
        if (spec) parsed.push({ command, shortcut: parseShortcut(spec) });
      }
    }
  }
  return parsed;
}

/** Finds the command bound to a key event (null if none). */
export function commandForEvent(e: KeyboardEvent): Command | null {
  for (const { command, shortcut } of shortcutTable()) {
    if (matchesShortcut(e, shortcut)) return command;
  }
  return null;
}
