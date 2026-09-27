import type { Editor, EditorState } from '../engine/Editor';
import type { ToolId } from '../engine/tools/types';
import { IMPORT_ACCEPT } from '../engine/io/decode';
import {
  canMergeDown,
  deleteSelectedLayers,
  duplicateSelectedLayers,
  flattenImage,
  groupSelected,
  mergeDown,
  mergeVisible,
  newGroup,
  newPixelLayer,
  selectAdjacentLayer,
  shiftActiveLayer,
  ungroupActive,
} from '../engine/actions/layerActions';
import { flipCanvas, flipLayers, rotateCanvas, rotateLayers } from '../engine/actions/transformActions';
import {
  cropToSelection,
  deselect,
  inverseSelection,
  loadLayerTransparency,
  reselect,
  selectAllAction,
} from '../engine/actions/selectionActions';
import { copySelection, cutSelection, pasteClipboard } from '../engine/actions/clipboardActions';
import {
  addLayerMask,
  applyLayerMask,
  canAddMask,
  deleteLayerMask,
  invertLayerMask,
  needsMask,
  setEditTarget,
  toggleLayerMask,
} from '../engine/actions/maskActions';
import { fillSelection } from '../engine/paint/PixelOps';
import { addAdjustmentLayer, canToggleClipping, toggleClippingMask } from '../engine/actions/adjustmentActions';
import { ADJUSTMENTS, ADJUSTMENT_ORDER } from '../engine/adjustments/registry';
import type { AdjustmentKind } from '../engine/adjustments/types';
import { importClipboardImages } from './clipboard';
import { findLayer } from '../engine/doc/layerTree';
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

/** Photoshop-compatible shortcuts for the most used adjustments. */
const ADJUSTMENT_SHORTCUTS: Partial<Record<AdjustmentKind, string>> = {
  levels: 'Mod+L',
  curves: 'Mod+M',
  hueSaturation: 'Mod+U',
  blackWhite: 'Alt+Shift+Mod+B',
};

function needsDoc(state: EditorState): true | string {
  return state.doc ? true : NEEDS_DOC;
}

function needsLayer(state: EditorState): true | string {
  if (!state.doc) return NEEDS_DOC;
  return state.doc.activeLayerId ? true : 'No layer selected';
}

function needsGroup(state: EditorState): true | string {
  if (!state.doc) return NEEDS_DOC;
  const layer = findLayer(state.doc.layers, state.doc.activeLayerId);
  return layer?.type === 'group' ? true : 'Select a group first';
}

/** Structure-changing commands are unavailable during Free Transform. */
function notTransforming(state: EditorState): true | string {
  return state.interaction?.kind === 'transform' ? 'Finish the transform first (Enter or Esc)' : true;
}

function all(...checks: ((s: EditorState) => true | string)[]): (s: EditorState) => true | string {
  return (s) => {
    for (const c of checks) {
      const r = c(s);
      if (r !== true) return r;
    }
    return true;
  };
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

/**
 * A shortcut shared by a tool group (M: marquees, L: lassos). The key keeps the
 * current member if one is active; Shift+key cycles through the group.
 */
function toolGroupCommands(ids: ToolId[], key: string, labels: string[]): Command[] {
  return [
    {
      id: `toolGroup.${ids[0]}`,
      label: labels[0]!,
      shortcut: key,
      run: (editor) => {
        const current = editor.store.get().tool;
        editor.setTool(ids.includes(current) ? current : ids[0]!);
      },
    },
    {
      id: `toolGroupCycle.${ids[0]}`,
      label: `Cycle ${labels[0]}`,
      shortcut: `Shift+${key}`,
      run: (editor) => {
        const current = editor.store.get().tool;
        const i = ids.indexOf(current);
        editor.setTool(ids[(i + 1) % ids.length]!);
      },
    },
    ...ids.map((id, i) => ({
      id: `tool.${id}`,
      label: labels[i]!,
      checked: (s: EditorState) => s.tool === id,
      run: (editor: Editor) => editor.setTool(id),
    })),
  ];
}

function needsSelection(state: EditorState): true | string {
  if (!state.doc) return NEEDS_DOC;
  return state.doc.selection ? true : 'Make a selection first';
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

  {
    id: 'edit.cut',
    label: 'Cut',
    shortcut: 'Mod+X',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => cutSelection(editor),
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    shortcut: 'Mod+C',
    enabled: all(needsLayer, notTransforming),
    run: async (editor) => {
      await copySelection(editor, false);
    },
  },
  {
    id: 'edit.copyMerged',
    label: 'Copy Merged',
    shortcut: 'Shift+Mod+C',
    enabled: all(needsDoc, notTransforming),
    run: async (editor) => {
      await copySelection(editor, true);
    },
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    // Ctrl/Cmd+V is handled through the browser paste event (see App).
    enabled: all(needsDoc, notTransforming),
    run: async (editor) => {
      if (await importClipboardImages(editor)) return;
      if (!pasteClipboard(editor)) editor.notify('info', 'The clipboard contains no image.');
    },
  },
  {
    id: 'edit.clear',
    label: 'Clear',
    shortcut: 'Delete',
    altShortcuts: ['Backspace'],
    enabled: all(needsLayer, notTransforming),
    run: (editor) => {
      // Without a selection, Delete removes the active layer.
      if (editor.doc?.selection) void fillSelection(editor, 'clear', 'Clear');
      else deleteSelectedLayers(editor);
    },
  },
  {
    id: 'edit.fillForeground',
    label: 'Fill with Foreground Color',
    shortcut: 'Alt+Backspace',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => fillSelection(editor, 'foreground', 'Fill').then(() => undefined),
  },
  {
    id: 'edit.fillBackground',
    label: 'Fill with Background Color',
    shortcut: 'Mod+Backspace',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => fillSelection(editor, 'background', 'Fill').then(() => undefined),
  },
  {
    id: 'edit.freeTransform',
    label: 'Free Transform',
    shortcut: 'Alt+Mod+T',
    altShortcuts: ['Mod+T'],
    enabled: all(needsLayer, notTransforming),
    run: (editor) => editor.transformTool.begin(),
  },
  {
    id: 'edit.flipH',
    label: 'Flip Layer Horizontal',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => flipLayers(editor, 'horizontal'),
  },
  {
    id: 'edit.flipV',
    label: 'Flip Layer Vertical',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => flipLayers(editor, 'vertical'),
  },
  {
    id: 'edit.rotateCW',
    label: 'Rotate Layer 90° Clockwise',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => rotateLayers(editor, 90),
  },
  {
    id: 'edit.rotateCCW',
    label: 'Rotate Layer 90° Counter Clockwise',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => rotateLayers(editor, -90),
  },
  {
    id: 'edit.rotate180',
    label: 'Rotate Layer 180°',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => rotateLayers(editor, 180),
  },

  // Select
  {
    id: 'select.all',
    label: 'All',
    shortcut: 'Mod+A',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => selectAllAction(editor),
  },
  {
    id: 'select.deselect',
    label: 'Deselect',
    shortcut: 'Mod+D',
    enabled: all(needsSelection, notTransforming),
    run: (editor) => deselect(editor),
  },
  {
    id: 'select.reselect',
    label: 'Reselect',
    shortcut: 'Shift+Mod+D',
    enabled: (s, editor) => (!s.doc ? NEEDS_DOC : editor.lastSelection ? true : 'No previous selection'),
    run: (editor) => reselect(editor),
  },
  {
    id: 'select.inverse',
    label: 'Inverse',
    shortcut: 'Shift+Mod+I',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => inverseSelection(editor),
  },
  {
    id: 'select.feather',
    label: 'Feather…',
    shortcut: 'Shift+F6',
    enabled: all(needsSelection, notTransforming),
    run: (editor) => editor.openDialog({ kind: 'feather' }),
  },
  {
    id: 'select.loadTransparency',
    label: 'Load Layer Transparency',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => loadLayerTransparency(editor),
  },

  // Image
  {
    id: 'image.cropToSelection',
    label: 'Crop to Selection',
    enabled: all(needsSelection, notTransforming),
    run: (editor) => cropToSelection(editor),
  },
  {
    id: 'image.size',
    label: 'Image Size…',
    shortcut: 'Alt+Mod+I',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => editor.openDialog({ kind: 'imageSize' }),
  },
  {
    id: 'image.canvasSize',
    label: 'Canvas Size…',
    shortcut: 'Alt+Mod+C',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => editor.openDialog({ kind: 'canvasSize' }),
  },
  {
    id: 'image.rotateCW',
    label: 'Rotate Canvas 90° Clockwise',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => rotateCanvas(editor, 90),
  },
  {
    id: 'image.rotateCCW',
    label: 'Rotate Canvas 90° Counter Clockwise',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => rotateCanvas(editor, -90),
  },
  {
    id: 'image.rotate180',
    label: 'Rotate Canvas 180°',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => rotateCanvas(editor, 180),
  },
  {
    id: 'image.flipH',
    label: 'Flip Canvas Horizontal',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => flipCanvas(editor, 'horizontal'),
  },
  {
    id: 'image.flipV',
    label: 'Flip Canvas Vertical',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => flipCanvas(editor, 'vertical'),
  },

  // Layer
  {
    id: 'layer.new',
    label: 'New Layer',
    shortcut: 'Alt+Shift+Mod+N',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => {
      newPixelLayer(editor);
    },
  },
  {
    id: 'layer.newGroup',
    label: 'New Group',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => newGroup(editor),
  },
  {
    id: 'layer.duplicate',
    label: 'Duplicate Layer',
    shortcut: 'Mod+J',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => duplicateSelectedLayers(editor),
  },
  {
    id: 'layer.delete',
    label: 'Delete Layer',
    enabled: all((s) => (!s.doc ? NEEDS_DOC : s.doc.selectedLayerIds.length === 0 ? 'No layer selected' : true), notTransforming),
    run: (editor) => deleteSelectedLayers(editor),
  },
  {
    id: 'layer.group',
    label: 'Group Layers',
    shortcut: 'Mod+G',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => groupSelected(editor),
  },
  {
    id: 'layer.ungroup',
    label: 'Ungroup Layers',
    shortcut: 'Shift+Mod+G',
    enabled: all(needsGroup, notTransforming),
    run: (editor) => ungroupActive(editor),
  },
  {
    id: 'layer.mergeDown',
    label: 'Merge Down',
    shortcut: 'Mod+E',
    enabled: all((s) => canMergeDown(s.doc), notTransforming),
    run: (editor) => mergeDown(editor),
  },
  {
    id: 'layer.mergeVisible',
    label: 'Merge Visible',
    shortcut: 'Shift+Mod+E',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => mergeVisible(editor),
  },
  {
    id: 'layer.flatten',
    label: 'Flatten Image',
    enabled: all(needsDoc, notTransforming),
    run: (editor) => flattenImage(editor),
  },
  {
    id: 'layer.clip',
    label: (s) => (findLayer(s.doc?.layers ?? [], s.doc?.activeLayerId)?.clipped ? 'Release Clipping Mask' : 'Create Clipping Mask'),
    shortcut: 'Alt+Mod+G',
    enabled: all((s) => canToggleClipping(s.doc), notTransforming),
    run: (editor) => toggleClippingMask(editor),
  },

  // Adjustment layers (non-destructive; each creates a layer above the active one)
  ...ADJUSTMENT_ORDER.map(
    (kind): Command => ({
      id: `adjust.${kind}`,
      label: ADJUSTMENTS[kind].label,
      shortcut: ADJUSTMENT_SHORTCUTS[kind],
      enabled: all(needsDoc, notTransforming),
      run: (editor) => {
        if (addAdjustmentLayer(editor, kind)) editor.events.emit('revealPanel', 'properties');
      },
    }),
  ),
  {
    id: 'layer.addMask',
    label: 'Add Layer Mask (Reveal)',
    enabled: all((s) => canAddMask(s.doc), notTransforming),
    run: (editor) => addLayerMask(editor, false),
  },
  {
    id: 'layer.addMaskHide',
    label: 'Add Layer Mask (Hide)',
    enabled: all((s) => canAddMask(s.doc), notTransforming),
    run: (editor) => addLayerMask(editor, true),
  },
  {
    id: 'layer.toggleMask',
    label: 'Disable/Enable Layer Mask',
    enabled: all((s) => needsMask(s.doc), notTransforming),
    run: (editor) => toggleLayerMask(editor),
  },
  {
    id: 'layer.invertMask',
    label: 'Invert Layer Mask',
    shortcut: 'Mod+I',
    enabled: all((s) => needsMask(s.doc), notTransforming),
    run: (editor) => invertLayerMask(editor),
  },
  {
    id: 'layer.applyMask',
    label: 'Apply Layer Mask',
    enabled: all((s) => needsMask(s.doc), notTransforming),
    run: (editor) => applyLayerMask(editor),
  },
  {
    id: 'layer.deleteMask',
    label: 'Delete Layer Mask',
    enabled: all((s) => needsMask(s.doc), notTransforming),
    run: (editor) => deleteLayerMask(editor),
  },
  {
    id: 'layer.editContent',
    label: 'Edit Layer Pixels',
    shortcut: 'Mod+2',
    enabled: needsLayer,
    checked: (s) => s.doc?.editTarget === 'content',
    run: (editor) => setEditTarget(editor, 'content'),
  },
  {
    id: 'layer.editMask',
    label: 'Edit Layer Mask',
    shortcut: 'Mod+\\',
    enabled: (s) => needsMask(s.doc),
    checked: (s) => s.doc?.editTarget === 'mask',
    run: (editor) => setEditTarget(editor, 'mask'),
  },
  {
    id: 'layer.bringToFront',
    label: 'Bring to Front',
    shortcut: 'Shift+Mod+]',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => shiftActiveLayer(editor, 'top'),
  },
  {
    id: 'layer.bringForward',
    label: 'Bring Forward',
    shortcut: 'Mod+]',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => shiftActiveLayer(editor, 1),
  },
  {
    id: 'layer.sendBackward',
    label: 'Send Backward',
    shortcut: 'Mod+[',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => shiftActiveLayer(editor, -1),
  },
  {
    id: 'layer.sendToBack',
    label: 'Send to Back',
    shortcut: 'Shift+Mod+[',
    enabled: all(needsLayer, notTransforming),
    run: (editor) => shiftActiveLayer(editor, 'bottom'),
  },
  {
    id: 'layer.selectAbove',
    label: 'Select Layer Above',
    shortcut: 'Alt+]',
    enabled: needsLayer,
    run: (editor) => selectAdjacentLayer(editor, 'up'),
  },
  {
    id: 'layer.selectBelow',
    label: 'Select Layer Below',
    shortcut: 'Alt+[',
    enabled: needsLayer,
    run: (editor) => selectAdjacentLayer(editor, 'down'),
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
    id: 'view.maskGrayscale',
    label: 'Show Layer Mask',
    shortcut: 'Alt+\\',
    enabled: (s) => needsMask(s.doc),
    checked: (s) => s.maskView === 'grayscale',
    run: (editor) => {
      editor.store.set((s) => ({ maskView: s.maskView === 'grayscale' ? 'off' : 'grayscale' }));
      editor.requestRender();
    },
  },
  {
    id: 'view.maskOverlay',
    label: 'Mask Overlay',
    shortcut: '\\',
    enabled: (s) => needsMask(s.doc),
    checked: (s) => s.maskView === 'overlay',
    run: (editor) => {
      editor.store.set((s) => ({ maskView: s.maskView === 'overlay' ? 'off' : 'overlay' }));
      editor.requestRender();
    },
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
  toolCommand('move', 'Move Tool', 'V'),
  ...toolGroupCommands(['marqueeRect', 'marqueeEllipse'], 'M', ['Rectangular Marquee Tool', 'Elliptical Marquee Tool']),
  ...toolGroupCommands(['lasso', 'polygonLasso'], 'L', ['Lasso Tool', 'Polygonal Lasso Tool']),
  toolCommand('magicWand', 'Magic Wand Tool', 'W'),
  toolCommand('crop', 'Crop Tool', 'C'),
  toolCommand('eyedropper', 'Eyedropper Tool', 'I'),
  toolCommand('brush', 'Brush Tool', 'B'),
  toolCommand('eraser', 'Eraser Tool', 'E'),
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
