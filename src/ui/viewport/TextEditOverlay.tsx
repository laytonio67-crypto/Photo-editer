import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { findLayer } from '../../engine/doc/layerTree';
import { multiplyAffine, scaling, translation } from '../../engine/geometry';
import { textMatrix } from '../../engine/text/layout';
import { isModKey } from '../../engine/tools/ToolManager';
import { useEditor, useEditorState } from '../editorContext';
import styles from './Viewport.module.css';

/**
 * Editable text for the Text tool. A textarea with the layer's font, line height and
 * letter spacing is transformed (CSS matrix) onto the rendered text, so the caret and
 * selection line up with the glyphs while the engine draws the text itself (the
 * textarea's own glyphs are transparent). Every change updates the layer live.
 */
export function TextEditOverlay() {
  const editor = useEditor();
  const editing = useEditorState((s) => s.textEditing);
  const doc = useEditorState((s) => s.doc);
  const [, setViewVersion] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => editor.view.events.on('change', () => setViewVersion((v) => v + 1)), [editor]);

  const layerId = editing?.layerId ?? null;
  useEffect(() => {
    const el = ref.current;
    if (!layerId || !el) return;
    el.focus({ preventScroll: true });
    // New text starts empty; existing text is selected so typing replaces it.
    if (el.value) el.select();
  }, [layerId]);

  if (!editing || !doc) return null;
  const layer = findLayer(doc.layers, editing.layerId);
  if (!layer || layer.type !== 'text') return null;

  const layout = editor.text.layout(layer);
  const view = editor.view;
  const t = view.transform;
  const k = t.zoom / view.dpr;
  // Room for the caret after the last character (split around centred text).
  const slack = Math.max(4, layer.style.fontSize * 0.15);
  const align = layer.style.align;
  const left = layout.box.x - (align === 'center' ? slack / 2 : align === 'right' ? slack : 0);
  // Textarea pixel → layer-local → document → stage CSS pixel.
  const m = multiplyAffine(
    translation(t.panX / view.dpr, t.panY / view.dpr),
    multiplyAffine(scaling(k, k), multiplyAffine(textMatrix(layer), translation(left, layout.box.y))),
  );
  const { r, g, b } = layer.style.color;
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
  const style: CSSProperties = {
    transform: `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`,
    width: layout.box.width + slack,
    height: layout.box.height,
    font: layout.font,
    lineHeight: `${layout.lineHeight}px`,
    letterSpacing: `${layer.style.letterSpacing}px`,
    textAlign: align,
    caretColor: light ? '#1c1d20' : '#f4f5f7',
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape' || (e.key === 'Enter' && isModKey(e))) {
      e.preventDefault();
      editor.textTool.commit();
    }
  };

  return (
    <div className={styles.textLayer}>
      <textarea
        ref={ref}
        className={styles.textInput}
        style={style}
        value={layer.content}
        aria-label="Text"
        data-testid="text-input"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        onChange={(e) => editor.textTool.setContent(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
