import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useEditor } from '../editorContext';
import { Modal } from '../controls/Modal';
import { Button, IconButton } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import controls from '../controls/controls.module.css';
import type { BackgroundFill } from '../../engine/Editor';
import styles from './Dialogs.module.css';

interface Preset {
  label: string;
  width: number;
  height: number;
  resolution: number;
}

const PRESETS: Preset[] = [
  { label: 'HD 1920 × 1080', width: 1920, height: 1080, resolution: 72 },
  { label: '4K UHD 3840 × 2160', width: 3840, height: 2160, resolution: 72 },
  { label: 'Square 1080 × 1080', width: 1080, height: 1080, resolution: 72 },
  { label: 'Portrait 4:5 1080 × 1350', width: 1080, height: 1350, resolution: 72 },
  { label: 'Photo 6 × 4 in @ 300 ppi', width: 1800, height: 1200, resolution: 300 },
  { label: 'Photo 10 × 8 in @ 300 ppi', width: 3000, height: 2400, resolution: 300 },
  { label: 'A4 @ 300 ppi', width: 2480, height: 3508, resolution: 300 },
  { label: 'US Letter @ 300 ppi', width: 2550, height: 3300, resolution: 300 },
];

type BackgroundChoice = 'white' | 'black' | 'transparent' | 'backgroundColor';

export function NewDocumentDialog() {
  const editor = useEditor();
  const max = editor.caps.maxDocumentSize;
  const [name, setName] = useState('Untitled');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [resolution, setResolution] = useState(72);
  const [background, setBackground] = useState<BackgroundChoice>('white');
  const preset = PRESETS.findIndex((p) => p.width === width && p.height === height && p.resolution === resolution);
  const megapixels = (width * height) / 1e6;
  const memoryMb = Math.round((width * height * 4) / (1024 * 1024));

  const create = (): void => {
    const fill: BackgroundFill =
      background === 'backgroundColor' ? { color: editor.store.get().background } : background;
    editor.closeDialog();
    editor.newDocument({ name: name.trim() || 'Untitled', width, height, resolution, background: fill });
  };

  return (
    <Modal
      title="New Document"
      width={440}
      onClose={() => editor.closeDialog()}
      onSubmit={create}
      footer={
        <>
          <Button onClick={() => editor.closeDialog()}>Cancel</Button>
          <Button variant="primary" onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.label} htmlFor="nd-name">
          Name
        </label>
        <input
          id="nd-name"
          className={styles.text}
          value={name}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <label className={styles.label} htmlFor="nd-preset">
          Preset
        </label>
        <select
          id="nd-preset"
          className={controls.select}
          value={preset}
          onChange={(e) => {
            const p = PRESETS[Number(e.target.value)];
            if (!p) return;
            setWidth(p.width);
            setHeight(p.height);
            setResolution(p.resolution);
          }}
        >
          {preset === -1 && <option value={-1}>Custom</option>}
          {PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <span className={styles.label}>Size</span>
        <div className={styles.inline}>
          <NumberField label="W" value={width} min={1} max={max} unit="px" onChange={setWidth} width={112} />
          <IconButton
            size="small"
            label="Swap width and height"
            icon={<ArrowLeftRight size={13} />}
            onClick={() => {
              setWidth(height);
              setHeight(width);
            }}
          />
          <NumberField label="H" value={height} min={1} max={max} unit="px" onChange={setHeight} width={112} />
        </div>
        <p className={styles.note}>
          {megapixels.toFixed(1)} MP · about {memoryMb} MB per full layer · max {max} px per side on this GPU
        </p>
        <span className={styles.label}>Resolution</span>
        <div className={styles.inline}>
          <NumberField value={resolution} min={1} max={2400} unit="ppi" onChange={setResolution} width={112} ariaLabel="Resolution" />
        </div>
        <label className={styles.label} htmlFor="nd-bg">
          Background
        </label>
        <select
          id="nd-bg"
          className={controls.select}
          value={background}
          onChange={(e) => setBackground(e.target.value as BackgroundChoice)}
        >
          <option value="white">White</option>
          <option value="black">Black</option>
          <option value="backgroundColor">Background color</option>
          <option value="transparent">Transparent</option>
        </select>
      </div>
    </Modal>
  );
}
