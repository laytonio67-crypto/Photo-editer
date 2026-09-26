import { useEditor, useEditorState } from '../editorContext';
import { findLayer } from '../../engine/doc/layerTree';
import panel from './Panel.module.css';

const TYPE_LABELS = { pixel: 'Pixel layer', text: 'Text layer', adjustment: 'Adjustment layer', group: 'Group' } as const;

export function PropertiesPanel() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc);
  if (!doc) return <p className={panel.empty}>Open or create a document to see its properties.</p>;
  const layer = findLayer(doc.layers, doc.activeLayerId);
  const surface = layer?.type === 'pixel' ? editor.surfaces.tryGet(layer.surfaceId) : undefined;
  return (
    <>
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
      {layer && (
        <section className={panel.section}>
          <h2 className={panel.sectionTitle}>{TYPE_LABELS[layer.type]}</h2>
          <dl className={panel.kv}>
            <dt>Name</dt>
            <dd title={layer.name}>{layer.name}</dd>
            {layer.type === 'pixel' && surface && (
              <>
                <dt>Position</dt>
                <dd>
                  {layer.x}, {layer.y} px
                </dd>
                <dt>Pixel bounds</dt>
                <dd>
                  {surface.width} × {surface.height} px
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </>
  );
}
