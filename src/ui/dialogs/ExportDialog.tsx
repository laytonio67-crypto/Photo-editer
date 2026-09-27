import { useEffect, useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { exportFileName, type ExportFormat, type ExportResult, type ExportSettings } from '../../engine/io/exportImage';
import type { ResampleMode } from '../../engine/render/Resampler';
import { ColorSwatch } from '../color/ColorSwatch';
import { Button, IconButton } from '../controls/Button';
import { Modal } from '../controls/Modal';
import { NumberField } from '../controls/NumberField';
import controls from '../controls/controls.module.css';
import { useEditor, useEditorState } from '../editorContext';
import optionStyles from '../optionsbar/OptionsBar.module.css';
import { formatBytes } from '../format';
import styles from './Dialogs.module.css';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

type Estimate = { key: string; state: 'working' } | { key: string; state: 'done'; result: ExportResult } | { key: string; state: 'error'; message: string };

/** File ▸ Export As: format, quality, size and transparency, with the real file size. */
export function ExportDialog() {
  const editor = useEditor();
  const doc = useEditorState((s) => s.doc)!;
  const max = editor.caps.maxDocumentSize;
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(90);
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [linked, setLinked] = useState(true);
  const [resample, setResample] = useState<ResampleMode>('bicubic');
  const [transparency, setTransparency] = useState(true);
  const [matte, setMatte] = useState({ r: 255, g: 255, b: 255 });
  const [unsupported, setUnsupported] = useState<Partial<Record<ExportFormat, boolean>>>({});
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [exporting, setExporting] = useState(false);
  const aspect = doc.width / doc.height;

  useEffect(() => {
    let cancelled = false;
    for (const f of ['jpeg', 'webp'] as const) {
      void editor.exporter.supports(f).then((ok) => {
        if (!cancelled && !ok) setUnsupported((u) => ({ ...u, [f]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [editor]);

  const settings: ExportSettings = { format, quality, width, height, resample, transparency, matte };
  const key = JSON.stringify(settings);
  const lossy = format !== 'png';
  const keepsAlpha = format !== 'jpeg' && transparency;

  // Encode in the background to show the real file size; the result is reused on Export.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setEstimate({ key, state: 'working' });
      editor.exporter
        .render(JSON.parse(key) as ExportSettings)
        .then((result) => current && setEstimate({ key, state: 'done', result }))
        .catch((err: unknown) => current && setEstimate({ key, state: 'error', message: err instanceof Error ? err.message : String(err) }));
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [editor, key]);

  const changeWidth = (w: number): void => {
    setWidth(w);
    if (linked) setHeight(Math.max(1, Math.min(max, Math.round(w / aspect))));
  };
  const changeHeight = (h: number): void => {
    setHeight(h);
    if (linked) setWidth(Math.max(1, Math.min(max, Math.round(h * aspect))));
  };
  const setScale = (pct: number): void => {
    setWidth(Math.max(1, Math.min(max, Math.round((doc.width * pct) / 100))));
    setHeight(Math.max(1, Math.min(max, Math.round((doc.height * pct) / 100))));
  };

  const run = async (): Promise<void> => {
    if (exporting || unsupported[format]) return;
    setExporting(true);
    try {
      const result = estimate?.key === key && estimate.state === 'done' ? estimate.result : await editor.exporter.render(settings);
      const name = exportFileName(doc.name, format);
      editor.exporter.download(result, name);
      editor.closeDialog();
      editor.notify('success', `Exported “${name}” (${formatBytes(result.bytes.length)}).`);
    } catch (err) {
      setExporting(false);
      editor.notify('error', 'Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  const sizeText =
    estimate?.key !== key || estimate.state === 'working'
      ? 'Calculating…'
      : estimate.state === 'done'
        ? formatBytes(estimate.result.bytes.length)
        : estimate.message;
  const scaled = width !== doc.width || height !== doc.height;

  return (
    <Modal
      title="Export As"
      width={460}
      onClose={() => editor.closeDialog()}
      onSubmit={() => void run()}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" disabled={exporting || Boolean(unsupported[format])} onClick={() => void run()}>
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <span className={styles.label}>Format</span>
        <div className={optionStyles.segmented} role="radiogroup" aria-label="Format" style={{ justifySelf: 'start' }}>
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              aria-pressed={format === f.value}
              disabled={unsupported[f.value]}
              title={unsupported[f.value] ? `This browser cannot encode ${f.label}` : undefined}
              onClick={() => setFormat(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {lossy && (
          <>
            <span className={styles.label}>Quality</span>
            <div className={styles.inline}>
              <input
                type="range"
                className={controls.range}
                aria-label="Quality slider"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <NumberField value={quality} min={1} max={100} width={64} ariaLabel="Quality" onChange={setQuality} />
            </div>
          </>
        )}
        <span className={styles.label}>Size</span>
        <div className={styles.inline}>
          <NumberField label="W" unit="px" value={width} min={1} max={max} width={110} onChange={changeWidth} ariaLabel="Export width" />
          <IconButton
            size="small"
            label={linked ? 'Unlink width and height' : 'Link width and height'}
            icon={linked ? <Link size={13} /> : <Unlink size={13} />}
            pressed={linked}
            onClick={() => setLinked(!linked)}
          />
          <NumberField label="H" unit="px" value={height} min={1} max={max} width={110} onChange={changeHeight} ariaLabel="Export height" />
        </div>
        <span className={styles.label}>Scale</span>
        <div className={styles.inline}>
          <NumberField
            unit="%"
            value={Math.round((width / doc.width) * 1000) / 10}
            min={1}
            max={1000}
            precision={1}
            width={90}
            ariaLabel="Export scale"
            onChange={setScale}
          />
          {scaled && (
            <select className={controls.select} aria-label="Resampling" value={resample} onChange={(e) => setResample(e.target.value as ResampleMode)}>
              <option value="bicubic">Bicubic (smooth)</option>
              <option value="bilinear">Bilinear</option>
              <option value="nearest">Nearest neighbour (hard edges)</option>
            </select>
          )}
        </div>
        <span className={styles.label}>Background</span>
        <div className={styles.inline}>
          <label className={controls.checkbox} title={format === 'jpeg' ? 'JPEG has no transparency' : undefined}>
            <input type="checkbox" checked={keepsAlpha} disabled={format === 'jpeg'} onChange={(e) => setTransparency(e.target.checked)} />
            Transparency
          </label>
          {!keepsAlpha && (
            <>
              <span className={styles.label}>Matte</span>
              <ColorSwatch className={styles.swatch} color={matte} label="Matte color" onChange={setMatte} />
            </>
          )}
        </div>
        {format === 'jpeg' && <p className={styles.note}>JPEG has no transparency: transparent areas are filled with the matte colour.</p>}
        <span className={styles.label}>File size</span>
        <span className={styles.value} data-testid="export-size">
          {sizeText}
        </span>
        <span className={styles.label}>File</span>
        <span className={styles.value}>
          {exportFileName(doc.name, format)} · {width} × {height} px · {doc.resolution} ppi
        </span>
      </div>
    </Modal>
  );
}
