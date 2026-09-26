import { useEffect, useState } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Scan } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { findLayer } from '../../engine/doc/layerTree';
import type { Layer } from '../../engine/doc/types';
import type { Rect } from '../../engine/geometry';
import { layerContentBounds, resizeLayersTo } from '../../engine/actions/transformActions';
import { moveLayers } from '../../engine/ops/transformOps';
import { setLayerProps } from '../../engine/ops/layerOps';
import { runCommand } from '../../app/commands';
import { NumberField } from '../controls/NumberField';
import { Button, IconButton } from '../controls/Button';
import controls from '../controls/controls.module.css';
import optionStyles from '../optionsbar/OptionsBar.module.css';
import { setEditTarget, toggleMaskLink } from '../../engine/actions/maskActions';
import { useScrub } from '../useScrub';
import { BlendModeSelect } from './BlendModeSelect';
import panel from './Panel.module.css';

const TYPE_LABELS = { pixel: 'Pixel Layer', text: 'Text Layer', adjustment: 'Adjustment Layer', group: 'Group' } as const;

/** Tight content bounds of a layer, recomputed when it changes. */
function useContentBounds(layer: Layer | null): Rect | null {
  const editor = useEditor();
  const [bounds, setBounds] = useState<Rect | null>(null);
  const [version, setVersion] = useState(0);
  const surfaceId = layer?.type === 'pixel' ? layer.surfaceId : null;
  useEffect(() => {
    if (!surfaceId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = editor.events.on('surfaceChanged', (id) => {
      if (id !== surfaceId) return;
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 200);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [editor, surfaceId]);
  useEffect(() => {
    let cancelled = false;
    if (!layer || layer.type === 'adjustment') {
      Promise.resolve(null).then((b) => !cancelled && setBounds(b));
    } else {
      layerContentBounds(editor, layer)
        .then((b) => !cancelled && setBounds(b))
        .catch(() => !cancelled && setBounds(null));
    }
    return () => {
      cancelled = true;
    };
  }, [editor, layer, version]);
  return bounds;
}

function TransformSection({ layer }: { layer: Layer }) {
  const editor = useEditor();
  const bounds = useContentBounds(layer);
  const locked = layer.locks.position;
  const moveTo = (axis: 'x' | 'y', value: number): void => {
    if (!bounds) return;
    const dx = axis === 'x' ? value - bounds.x : 0;
    const dy = axis === 'y' ? value - bounds.y : 0;
    editor.commit('Move', (d) => moveLayers(d, [layer.id], dx, dy));
  };
  return (
    <section className={panel.section}>
      <h2 className={panel.sectionTitle}>Transform</h2>
      {bounds ? (
        <div className={panel.fieldGrid}>
          <NumberField label="X" unit="px" value={bounds.x} disabled={locked} onChange={(v) => moveTo('x', v)} />
          <NumberField label="Y" unit="px" value={bounds.y} disabled={locked} onChange={(v) => moveTo('y', v)} />
          <NumberField
            label="W"
            unit="px"
            value={bounds.width}
            min={1}
            max={editor.caps.maxDocumentSize}
            disabled={locked}
            onChange={(w) => void resizeLayersTo(editor, w, bounds.height)}
          />
          <NumberField
            label="H"
            unit="px"
            value={bounds.height}
            min={1}
            max={editor.caps.maxDocumentSize}
            disabled={locked}
            onChange={(h) => void resizeLayersTo(editor, bounds.width, h)}
          />
        </div>
      ) : (
        <p className={panel.empty} style={{ padding: 0 }}>
          {layer.type === 'pixel' ? 'The layer is empty.' : 'No pixel content.'}
        </p>
      )}
      <div className={panel.controlRow} style={{ marginTop: 8 }}>
        <IconButton size="small" label="Free Transform" icon={<Scan size={14} />} disabled={locked || !bounds} onClick={() => runCommand(editor, 'edit.freeTransform')} />
        <IconButton size="small" label="Flip horizontal" icon={<FlipHorizontal2 size={14} />} disabled={locked || !bounds} onClick={() => runCommand(editor, 'edit.flipH')} />
        <IconButton size="small" label="Flip vertical" icon={<FlipVertical2 size={14} />} disabled={locked || !bounds} onClick={() => runCommand(editor, 'edit.flipV')} />
        <IconButton size="small" label="Rotate 90° counter-clockwise" icon={<RotateCcw size={14} />} disabled={locked || !bounds} onClick={() => runCommand(editor, 'edit.rotateCCW')} />
        <IconButton size="small" label="Rotate 90° clockwise" icon={<RotateCw size={14} />} disabled={locked || !bounds} onClick={() => runCommand(editor, 'edit.rotateCW')} />
      </div>
    </section>
  );
}

function MaskSection({ layer }: { layer: Layer }) {
  const editor = useEditor();
  const editTarget = useEditorState((s) => s.doc?.editTarget ?? 'content');
  const maskView = useEditorState((s) => s.maskView);
  const mask = layer.mask;
  if (!mask) {
    return (
      <section className={panel.section}>
        <h2 className={panel.sectionTitle}>Mask</h2>
        <div className={panel.controlRow}>
          <Button className={optionStyles.small} onClick={() => runCommand(editor, 'layer.addMask')}>
            Add Mask
          </Button>
          <Button className={optionStyles.small} onClick={() => runCommand(editor, 'layer.addMaskHide')}>
            Add Hiding Mask
          </Button>
        </div>
      </section>
    );
  }
  const setView = (v: 'off' | 'grayscale' | 'overlay') => {
    editor.store.set({ maskView: v });
    editor.requestRender();
  };
  return (
    <section className={panel.section}>
      <h2 className={panel.sectionTitle}>Mask</h2>
      <div className={panel.controlRow}>
        <span className={panel.controlLabel}>Edit</span>
        <div className={optionStyles.segmented} role="radiogroup" aria-label="Edit target">
          <button type="button" role="radio" aria-checked={editTarget === 'content'} aria-pressed={editTarget === 'content'} onClick={() => setEditTarget(editor, 'content')}>
            Pixels
          </button>
          <button type="button" role="radio" aria-checked={editTarget === 'mask'} aria-pressed={editTarget === 'mask'} onClick={() => setEditTarget(editor, 'mask')}>
            Mask
          </button>
        </div>
      </div>
      <div className={panel.controlRow}>
        <span className={panel.controlLabel}>View</span>
        <div className={optionStyles.segmented} role="radiogroup" aria-label="Mask view">
          {(['off', 'grayscale', 'overlay'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={maskView === v} aria-pressed={maskView === v} onClick={() => setView(v)}>
              {v === 'off' ? 'Image' : v === 'grayscale' ? 'Mask' : 'Overlay'}
            </button>
          ))}
        </div>
      </div>
      <div className={panel.controlRow}>
        <label className={controls.checkbox}>
          <input type="checkbox" checked={mask.enabled} onChange={() => runCommand(editor, 'layer.toggleMask')} />
          Enabled
        </label>
        <label className={controls.checkbox}>
          <input type="checkbox" checked={mask.linked} onChange={() => toggleMaskLink(editor)} />
          Linked
        </label>
      </div>
      <div className={panel.controlRow}>
        <Button className={optionStyles.small} onClick={() => runCommand(editor, 'layer.invertMask')}>
          Invert
        </Button>
        <Button className={optionStyles.small} disabled={layer.type !== 'pixel'} onClick={() => runCommand(editor, 'layer.applyMask')}>
          Apply
        </Button>
        <Button className={optionStyles.small} onClick={() => runCommand(editor, 'layer.deleteMask')}>
          Delete
        </Button>
      </div>
    </section>
  );
}

function LayerSection({ layer }: { layer: Layer }) {
  const editor = useEditor();
  const scrub = useScrub();
  const setOpacity = (pct: number) => (d: Parameters<typeof setLayerProps>[0]) =>
    setLayerProps(d, layer.id, { opacity: Math.max(0, Math.min(100, pct)) / 100 });
  return (
    <section className={panel.section}>
      <h2 className={panel.sectionTitle}>{TYPE_LABELS[layer.type]}</h2>
      <div className={panel.controlRow}>
        <span className={panel.controlLabel}>Blend</span>
        <BlendModeSelect
          value={layer.blendMode}
          allowPassThrough={layer.type === 'group'}
          className=""
          onChange={(blendMode) => editor.commit('Blend Mode', (d) => setLayerProps(d, layer.id, { blendMode }))}
        />
      </div>
      <div className={panel.controlRow}>
        <span className={panel.controlLabel}>Opacity</span>
        <NumberField
          unit="%"
          ariaLabel="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          width={80}
          onScrubStart={() => scrub.start()}
          onInput={(v) => scrub.update(setOpacity(v))}
          onScrubEnd={() => scrub.end('Layer Opacity')}
          onChange={(v) => scrub.commit('Layer Opacity', setOpacity(v))}
        />
      </div>
      {layer.type === 'group' && (
        <p className={panel.empty} style={{ padding: 0 }}>
          {layer.children.length} {layer.children.length === 1 ? 'layer' : 'layers'} ·{' '}
          {layer.blendMode === 'passThrough' ? 'children blend with layers below' : 'composited in isolation'}
        </p>
      )}
    </section>
  );
}

export function PropertiesPanel() {
  const doc = useEditorState((s) => s.doc);
  if (!doc) return <p className={panel.empty}>Open or create a document to see its properties.</p>;
  const layer = findLayer(doc.layers, doc.activeLayerId);
  return (
    <>
      {layer && <LayerSection layer={layer} />}
      {layer && <MaskSection layer={layer} />}
      {layer && layer.type !== 'adjustment' && <TransformSection layer={layer} />}
      <section className={panel.section}>
        <h2 className={panel.sectionTitle}>Document</h2>
        <dl className={panel.kv}>
          <dt>Size</dt>
          <dd>
            {doc.width} × {doc.height} px
          </dd>
          <dt>Resolution</dt>
          <dd>{doc.resolution} ppi</dd>
          <dt>Color</dt>
          <dd>sRGB, 8 bits/channel</dd>
        </dl>
      </section>
    </>
  );
}
