import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Plus, SlidersHorizontal, Trash2, Type } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { IconButton } from '../controls/Button';
import { panelOrder } from '../../engine/doc/layerTree';
import type { Layer } from '../../engine/doc/types';
import { renameLayerAction, selectLayerAction, setLayerVisibility } from '../../engine/actions/layerActions';
import { toggleGroupExpanded } from '../../engine/ops/layerOps';
import { runCommand } from '../../app/commands';
import { isModKey } from '../../engine/tools/ToolManager';
import { LayerThumbnail } from './LayerThumbnail';
import panel from './Panel.module.css';
import styles from './LayersPanel.module.css';

interface RowProps {
  layer: Layer;
  depth: number;
  selected: boolean;
  active: boolean;
  docWidth: number;
  docHeight: number;
}

const LayerRow = memo(function LayerRow({ layer, depth, selected, active, docWidth, docHeight }: RowProps) {
  const editor = useEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const onClick = (e: MouseEvent): void => {
    const mode = e.shiftKey ? 'range' : isModKey(e) ? 'toggle' : 'replace';
    selectLayerAction(editor, layer.id, mode);
  };

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

  return (
    <div
      className={styles.row}
      role="option"
      aria-selected={selected}
      data-active={active}
      data-hidden={!layer.visible}
      data-testid="layer-row"
      data-layer-id={layer.id}
      onClick={onClick}
    >
      <button
        type="button"
        className={styles.eye}
        aria-pressed={layer.visible}
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => {
          e.stopPropagation();
          setLayerVisibility(editor, layer.id, !layer.visible);
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
      <span className={styles.thumbBox}>{thumb}</span>
      {editing ? (
        <input
          className={styles.nameInput}
          value={draft}
          autoFocus
          aria-label="Layer name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onNameKey}
          onBlur={() => finishRename(true)}
          onClick={(e) => e.stopPropagation()}
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
    </div>
  );
});

export function LayersPanel() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc);

  if (!doc) {
    return (
      <div className={panel.body}>
        <p className={panel.empty}>Layers of the open document appear here.</p>
      </div>
    );
  }

  const rows = panelOrder(doc.layers);
  const selected = new Set(doc.selectedLayerIds);
  return (
    <>
      <div className={styles.list} role="listbox" aria-label="Layers" aria-multiselectable="true">
        {rows.map(({ layer, depth }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            depth={depth}
            selected={selected.has(layer.id)}
            active={doc.activeLayerId === layer.id}
            docWidth={doc.width}
            docHeight={doc.height}
          />
        ))}
      </div>
      <div className={panel.footer}>
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
    </>
  );
}
