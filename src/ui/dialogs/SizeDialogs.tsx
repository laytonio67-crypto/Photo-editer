import { useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { Modal } from '../controls/Modal';
import { Button, IconButton } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import controls from '../controls/controls.module.css';
import { resizeCanvas, resizeImage } from '../../engine/actions/transformActions';
import type { ResampleMode } from '../../engine/render/Resampler';
import styles from './Dialogs.module.css';

function formatMb(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function ImageSizeDialog() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc)!;
  const max = editor.caps.maxDocumentSize;
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [linked, setLinked] = useState(true);
  const [resolution, setResolution] = useState(doc.resolution);
  const [mode, setMode] = useState<ResampleMode>('bicubic');
  const aspect = doc.width / doc.height;

  const changeWidth = (w: number): void => {
    setWidth(w);
    if (linked) setHeight(Math.max(1, Math.min(max, Math.round(w / aspect))));
  };
  const changeHeight = (h: number): void => {
    setHeight(h);
    if (linked) setWidth(Math.max(1, Math.min(max, Math.round(h * aspect))));
  };
  const apply = (): void => {
    editor.closeDialog();
    resizeImage(editor, width, height, mode, resolution);
  };

  return (
    <Modal
      title="Image Size"
      width={420}
      onClose={() => editor.closeDialog()}
      onSubmit={apply}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Resize
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <span className={styles.label}>Current</span>
        <span className={styles.label}>
          {doc.width} × {doc.height} px · {formatMb(doc.width * doc.height * 4)} per layer
        </span>
        <span className={styles.label}>Width</span>
        <div className={styles.inline}>
          <NumberField value={width} min={1} max={max} unit="px" onChange={changeWidth} width={120} ariaLabel="Width" />
          <NumberField
            value={Math.round((width / doc.width) * 1000) / 10}
            min={0.1}
            max={10000}
            precision={1}
            unit="%"
            width={96}
            ariaLabel="Width percent"
            onChange={(p) => changeWidth(Math.max(1, Math.min(max, Math.round((doc.width * p) / 100))))}
          />
        </div>
        <span className={styles.label}>Height</span>
        <div className={styles.inline}>
          <NumberField value={height} min={1} max={max} unit="px" onChange={changeHeight} width={120} ariaLabel="Height" />
          <NumberField
            value={Math.round((height / doc.height) * 1000) / 10}
            min={0.1}
            max={10000}
            precision={1}
            unit="%"
            width={96}
            ariaLabel="Height percent"
            onChange={(p) => changeHeight(Math.max(1, Math.min(max, Math.round((doc.height * p) / 100))))}
          />
          <IconButton
            size="small"
            label={linked ? 'Unlink width and height' : 'Link width and height'}
            icon={linked ? <Link size={13} /> : <Unlink size={13} />}
            pressed={linked}
            onClick={() => setLinked(!linked)}
          />
        </div>
        <p className={styles.note}>
          New size {formatMb(width * height * 4)} per layer · print {(width / resolution).toFixed(2)} ×{' '}
          {(height / resolution).toFixed(2)} in
        </p>
        <span className={styles.label}>Resolution</span>
        <div className={styles.inline}>
          <NumberField value={resolution} min={1} max={2400} unit="ppi" onChange={setResolution} width={120} ariaLabel="Resolution" />
        </div>
        <label className={styles.label} htmlFor="is-mode">
          Resample
        </label>
        <select id="is-mode" className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as ResampleMode)}>
          <option value="bicubic">Bicubic (smooth gradients)</option>
          <option value="bilinear">Bilinear</option>
          <option value="nearest">Nearest Neighbor (hard edges)</option>
        </select>
      </div>
    </Modal>
  );
}

const ANCHORS: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [0.5, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

export function CanvasSizeDialog() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc)!;
  const max = editor.caps.maxDocumentSize;
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [anchor, setAnchor] = useState(4);
  const apply = (): void => {
    const [ax, ay] = ANCHORS[anchor]!;
    editor.closeDialog();
    if (width !== doc.width || height !== doc.height) resizeCanvas(editor, width, height, ax, ay);
  };
  return (
    <Modal
      title="Canvas Size"
      width={400}
      onClose={() => editor.closeDialog()}
      onSubmit={apply}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <span className={styles.label}>Current</span>
        <span className={styles.label}>
          {doc.width} × {doc.height} px
        </span>
        <span className={styles.label}>Width</span>
        <div className={styles.inline}>
          <NumberField value={width} min={1} max={max} unit="px" onChange={setWidth} width={120} ariaLabel="Canvas width" />
        </div>
        <span className={styles.label}>Height</span>
        <div className={styles.inline}>
          <NumberField value={height} min={1} max={max} unit="px" onChange={setHeight} width={120} ariaLabel="Canvas height" />
        </div>
        <span className={styles.label}>Anchor</span>
        <div
          role="radiogroup"
          aria-label="Anchor"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 22px)', gap: 3 }}
        >
          {ANCHORS.map((_, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={anchor === i}
              aria-label={`Anchor ${['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'][i]}`}
              onClick={() => setAnchor(i)}
              style={{
                width: 22,
                height: 22,
                border: '1px solid var(--border-control)',
                borderRadius: 3,
                background: anchor === i ? 'var(--accent)' : 'var(--bg-input)',
              }}
            />
          ))}
        </div>
        <p className={styles.note}>
          Layers keep pixels outside the canvas, so shrinking the canvas is reversible. New areas are transparent.
        </p>
      </div>
    </Modal>
  );
}
