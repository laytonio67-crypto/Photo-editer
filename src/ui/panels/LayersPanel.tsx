import { memo, useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Link2,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Grid2x2,
  Lock,
  Move,
  Paintbrush,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
} from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { IconButton } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import { ContextMenu, type ContextMenuItem } from '../controls/ContextMenu';
import { findLayer, panelOrder } from '../../engine/doc/layerTree';
import type { DocState, Layer, LayerId } from '../../engine/doc/types';
import {
  renameLayerAction,
  reorderLayers,
  selectLayerAction,
  setLayerBlendMode,
  setLayerLocks,
  setLayerVisibility,
} from '../../engine/actions/layerActions';
import { setLayerProps, soloVisibility, toggleGroupExpanded } from '../../engine/ops/layerOps';
import { setEditTarget, toggleLayerMask, toggleMaskLink } from '../../engine/actions/maskActions';
import { loadLayerTransparency } from '../../engine/actions/selectionActions';
import { runCommand } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import { isModKey } from '../../engine/tools/ToolManager';
import { useScrub } from '../useScrub';
import { dropDestination, type DropTarget, type DropZone } from './layerDrop';
import { BlendModeSelect } from './BlendModeSelect';
import { LayerThumbnail } from './LayerThumbnail';
import panel from './Panel.module.css';
import styles from './LayersPanel.module.css';

function LayersHeader({ doc }: { doc: DocState }) {
  const editor = useEditor();
  const scrub = useScrub();
  const layer = findLayer(doc.layers, doc.activeLayerId);
  const disabled = !layer;
  const locks = layer?.locks;
  const setOpacity = (pct: number) => (d: DocState) =>
    layer ? setLayerProps(d, layer.id, { opacity: Math.max(0, Math.min(100, pct)) / 100 }) : d;
  return (
    <div className={styles.header}>
      <div className={styles.headerRow}>
        <BlendModeSelect
          className={styles.blend}
          value={layer?.blendMode ?? 'normal'}
          allowPassThrough={layer?.type === 'group'}
          disabled={disabled}
          onChange={(mode) => layer && setLayerBlendMode(editor, layer.id, mode)}
        />
        <NumberField
          label="Opacity"
          unit="%"
          value={layer ? Math.round(layer.opacity * 100) : 100}
          min={0}
          max={100}
          width={112}
          disabled={disabled}
          onScrubStart={() => scrub.start()}
          onInput={(v) => scrub.update(setOpacity(v))}
          onScrubEnd={() => scrub.end('Layer Opacity')}
          onChange={(v) => scrub.commit('Layer Opacity', setOpacity(v))}
        />
      </div>
      <div className={styles.headerRow}>
        <span className={styles.lockLabel}>Lock</span>
        <IconButton
          size="small"
          label="Lock transparent pixels"
          icon={<Grid2x2 size={13} strokeWidth={1.7} />}
          pressed={locks?.transparency ?? false}
          disabled={disabled || layer?.type !== 'pixel'}
          onClick={() => layer && setLayerLocks(editor, layer.id, { transparency: !layer.locks.transparency })}
        />
        <IconButton
          size="small"
          label="Lock image pixels"
          icon={<Paintbrush size={13} strokeWidth={1.7} />}
          pressed={locks?.pixels ?? false}
          disabled={disabled || layer?.type === 'group' || layer?.type === 'adjustment'}
          onClick={() => layer && setLayerLocks(editor, layer.id, { pixels: !layer.locks.pixels })}
        />
        <IconButton
          size="small"
          label="Lock position"
          icon={<Move size={13} strokeWidth={1.7} />}
          pressed={locks?.position ?? false}
          disabled={disabled}
          onClick={() => layer && setLayerLocks(editor, layer.id, { position: !layer.locks.position })}
        />
        <IconButton
          size="small"
          label="Lock all"
          icon={<Lock size={13} strokeWidth={1.7} />}
          pressed={Boolean(locks && locks.pixels && locks.position && (layer?.type !== 'pixel' || locks.transparency))}
          disabled={disabled}
          onClick={() => {
            if (!layer) return;
            const all = layer.locks.pixels && layer.locks.position;
            setLayerLocks(editor, layer.id, { pixels: !all, position: !all, transparency: layer.type === 'pixel' ? !all : false });
          }}
        />
      </div>
    </div>
  );
}

interface RowProps {
  layer: Layer;
  depth: number;
  selected: boolean;
  active: boolean;
  editTarget: 'content' | 'mask';
  docWidth: number;
  docHeight: number;
  drop: DropZone | null;
  onRowPointerDown: (e: PointerEvent, layer: Layer) => void;
  onContextMenu: (e: MouseEvent, layer: Layer) => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  depth,
  selected,
  active,
  editTarget,
  docWidth,
  docHeight,
  drop,
  onRowPointerDown,
  onContextMenu,
}: RowProps) {
  const editor = useEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const finishRename = (commit: boolean): void => {
    setEditing(false);
    if (commit && draft.trim() && draft !== layer.name) renameLayerAction(editor, layer.id, draft);
  };

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (e.key === 'Enter') finishRename(true);
    else if (e.key === 'Escape') finishRename(false);
  };

  let thumb: React.ReactNode;
  if (layer.type === 'pixel') {
    thumb = <LayerThumbnail layer={layer} docWidth={docWidth} docHeight={docHeight} size={32} className={styles.thumb} />;
  } else {
    const Icon = layer.type === 'group' ? Folder : layer.type === 'text' ? Type : SlidersHorizontal;
    thumb = (
      <span className={styles.iconThumb}>
        <Icon size={16} strokeWidth={1.6} />
      </span>
    );
  }
  const locked = layer.locks.pixels || layer.locks.position || layer.locks.transparency;
  const onContentThumbClick = (e: MouseEvent): void => {
    if (isModKey(e)) {
      e.stopPropagation();
      loadLayerTransparency(editor, layer.id);
      return;
    }
    setEditTarget(editor, 'content');
  };
  const onMaskThumbClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (!active) selectLayerAction(editor, layer.id);
    if (e.shiftKey) {
      toggleLayerMask(editor);
      return;
    }
    if (e.altKey) {
      editor.store.set((s) => ({ maskView: s.maskView === 'grayscale' ? 'off' : 'grayscale' }));
      editor.requestRender();
    }
    setEditTarget(editor, 'mask');
  };

  return (
    <div
      className={styles.row}
      role="option"
      aria-selected={selected}
      data-active={active}
      data-hidden={!layer.visible}
      data-drop={drop ?? undefined}
      data-testid="layer-row"
      data-layer-id={layer.id}
      onPointerDown={(e) => onRowPointerDown(e, layer)}
      onContextMenu={(e) => onContextMenu(e, layer)}
    >
      <button
        type="button"
        className={styles.eye}
        aria-pressed={layer.visible}
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={layer.visible ? 'Hide layer (Alt-click: show only this layer)' : 'Show layer'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (e.altKey) editor.commit('Show/Hide Other Layers', (d) => soloVisibility(d, layer.id));
          else setLayerVisibility(editor, layer.id, !layer.visible);
        }}
      >
        {layer.visible ? <Eye size={15} strokeWidth={1.6} /> : <EyeOff size={15} strokeWidth={1.6} />}
      </button>
      <span className={styles.indent} style={{ width: 4 + depth * 14 }} />
      {layer.type === 'group' ? (
        <button
          type="button"
          className={styles.chevron}
          aria-label={layer.expanded ? 'Collapse group' : 'Expand group'}
          aria-expanded={layer.expanded}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            editor.updateDocSilently((d) => toggleGroupExpanded(d, layer.id));
          }}
        >
          {layer.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span style={{ width: 16, flex: 'none' }} />
      )}
      <span
        className={styles.thumbBox}
        data-target={active && editTarget === 'content' && Boolean(layer.mask)}
        title={layer.type === 'pixel' ? `${layer.name} — ${formatShortcut('Mod+')}click to load transparency as selection` : undefined}
        onClick={onContentThumbClick}
      >
        {thumb}
      </span>
      {layer.mask && (
        <>
          <button
            type="button"
            className={styles.link}
            aria-pressed={layer.mask.linked}
            aria-label={layer.mask.linked ? 'Unlink mask from layer' : 'Link mask to layer'}
            title={layer.mask.linked ? 'Mask moves with the layer (click to unlink)' : 'Mask is unlinked (click to link)'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (!active) selectLayerAction(editor, layer.id);
              toggleMaskLink(editor);
            }}
          >
            <Link2 size={11} />
          </button>
          <span
            className={styles.thumbBox}
            data-target={active && editTarget === 'mask'}
            data-disabled={!layer.mask.enabled}
            data-testid="mask-thumb"
            title="Layer mask — click to edit, Shift-click to disable, Alt-click to view"
            onClick={onMaskThumbClick}
          >
            <LayerThumbnail layer={layer} docWidth={docWidth} docHeight={docHeight} size={32} className={styles.thumb} mask />
          </span>
        </>
      )}
      {editing ? (
        <input
          className={styles.nameInput}
          value={draft}
          autoFocus
          aria-label="Layer name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onNameKey}
          onBlur={() => finishRename(true)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={styles.name}
          title={`${layer.name} — double-click to rename`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(layer.name);
            setEditing(true);
          }}
        >
          {layer.name}
        </span>
      )}
      <span className={styles.badges}>{locked && <Lock size={11} strokeWidth={2} aria-label="Locked" />}</span>
    </div>
  );
});

export function LayersPanel() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: LayerId; startY: number; pointerId: number; dragging: boolean; mode: 'replace' | 'toggle' | 'range' } | null>(null);

  const targetFromPoint = useCallback((clientX: number, clientY: number): DropTarget | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-layer-id]');
    if (!el || !listRef.current?.contains(el)) return null;
    const id = el.dataset.layerId!;
    const r = el.getBoundingClientRect();
    const f = (clientY - r.top) / r.height;
    const layer = editor.doc ? findLayer(editor.doc.layers, id) : null;
    if (layer?.type === 'group' && f > 0.28 && f < 0.72) return { id, zone: 'into' };
    return { id, zone: f < 0.5 ? 'above' : 'below' };
  }, [editor]);

  const onRowPointerDown = useCallback(
    (e: PointerEvent, layer: Layer) => {
      if (e.button !== 0) return;
      const mode = e.shiftKey ? 'range' : isModKey(e) ? 'toggle' : 'replace';
      const doc = editor.doc;
      // Keep a multi-selection when starting a drag on one of its rows.
      if (!(mode === 'replace' && doc?.selectedLayerIds.includes(layer.id) && doc.selectedLayerIds.length > 1)) {
        selectLayerAction(editor, layer.id, mode);
      }
      // Pointer capture starts only once a drag begins, so clicks and double-clicks
      // (rename) still reach the row.
      dragRef.current = { id: layer.id, startY: e.clientY, pointerId: e.pointerId, dragging: false, mode };
    },
    [editor],
  );

  const onListPointerMove = (e: PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.dragging && Math.abs(e.clientY - drag.startY) < 5) return;
    if (!drag.dragging) listRef.current?.setPointerCapture(e.pointerId);
    drag.dragging = true;
    setDropTarget(targetFromPoint(e.clientX, e.clientY));
  };

  const onListPointerUp = (e: PointerEvent): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (listRef.current?.hasPointerCapture(e.pointerId)) listRef.current.releasePointerCapture(e.pointerId);
    const target = drag.dragging ? targetFromPoint(e.clientX, e.clientY) : null;
    setDropTarget(null);
    const doc = editor.doc;
    if (!drag.dragging) {
      // Plain click on a row of a multi-selection selects just that row.
      if (drag.mode === 'replace' && doc && doc.selectedLayerIds.length > 1) selectLayerAction(editor, drag.id);
      return;
    }
    if (!target || !doc) return;
    const ids = doc.selectedLayerIds.includes(drag.id) ? doc.selectedLayerIds : [drag.id];
    if (ids.includes(target.id)) return;
    const dest = dropDestination(doc, target);
    if (dest) reorderLayers(editor, ids, dest.parentId, dest.index);
  };

  const onContextMenu = useCallback(
    (e: MouseEvent, layer: Layer) => {
      e.preventDefault();
      if (!editor.doc?.selectedLayerIds.includes(layer.id)) selectLayerAction(editor, layer.id);
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [editor],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  if (!doc) {
    return (
      <div className={panel.body}>
        <p className={panel.empty}>Layers of the open document appear here.</p>
      </div>
    );
  }

  const rows = panelOrder(doc.layers);
  const selected = new Set(doc.selectedLayerIds);
  const menuItems: ContextMenuItem[] = [
    'layer.duplicate',
    'layer.delete',
    '-',
    'select.loadTransparency',
    'layer.addMask',
    'layer.toggleMask',
    'layer.applyMask',
    'layer.deleteMask',
    '-',
    'layer.group',
    'layer.ungroup',
    '-',
    'edit.freeTransform',
    'edit.flipH',
    'edit.flipV',
    '-',
    'layer.mergeDown',
    'layer.mergeVisible',
    'layer.flatten',
  ];

  return (
    <>
      <LayersHeader doc={doc} />
      <div
        ref={listRef}
        className={styles.list}
        role="listbox"
        aria-label="Layers"
        aria-multiselectable="true"
        onPointerMove={onListPointerMove}
        onPointerUp={onListPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDropTarget(null);
        }}
      >
        {rows.map(({ layer, depth }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            depth={depth}
            selected={selected.has(layer.id)}
            active={doc.activeLayerId === layer.id}
            editTarget={doc.editTarget}
            docWidth={doc.width}
            docHeight={doc.height}
            drop={dropTarget?.id === layer.id ? dropTarget.zone : null}
            onRowPointerDown={onRowPointerDown}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
      <div className={panel.footer}>
        <IconButton
          label="Add layer mask"
          tooltip="Add layer mask (reveals the selection, if any)"
          icon={<CircleDot size={14} strokeWidth={1.7} />}
          size="small"
          disabled={!doc.activeLayerId || Boolean(findLayer(doc.layers, doc.activeLayerId)?.mask)}
          onClick={(e) => runCommand(editor, e.altKey ? 'layer.addMaskHide' : 'layer.addMask')}
        />
        <IconButton
          label="New group"
          icon={<FolderPlus size={14} strokeWidth={1.7} />}
          size="small"
          onClick={() => runCommand(editor, 'layer.newGroup')}
        />
        <IconButton
          label="Duplicate layer"
          shortcut={formatShortcut('Mod+J')}
          icon={<Copy size={13} strokeWidth={1.7} />}
          size="small"
          disabled={!doc.activeLayerId}
          onClick={() => runCommand(editor, 'layer.duplicate')}
        />
        <IconButton
          label="New layer"
          icon={<Plus size={15} strokeWidth={1.7} />}
          size="small"
          onClick={() => runCommand(editor, 'layer.new')}
        />
        <IconButton
          label="Delete layer"
          icon={<Trash2 size={14} strokeWidth={1.7} />}
          size="small"
          disabled={doc.selectedLayerIds.length === 0}
          onClick={() => runCommand(editor, 'layer.delete')}
        />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </>
  );
}
