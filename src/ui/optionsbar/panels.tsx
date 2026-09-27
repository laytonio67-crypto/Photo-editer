import { useState } from 'react';
import { ArrowLeftRight, Check, FlipHorizontal2, FlipVertical2, Link, RotateCcw, RotateCw, Scan, Unlink, X } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { Button, IconButton } from '../controls/Button';
import { NumberField } from '../controls/NumberField';
import controls from '../controls/controls.module.css';
import { runCommand } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import type { CropRatio } from '../../engine/tools/options';
import type { ResampleMode } from '../../engine/render/Resampler';
import type { CropTool } from '../../engine/tools/CropTool';
import styles from './OptionsBar.module.css';

export function ViewButtons() {
  const editor = useEditor();
  const hasDoc = useEditorState((s) => s.doc !== null);
  return (
    <div className={styles.group}>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.actualPixels()}>
        100%
      </Button>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.fit()}>
        Fit Screen
      </Button>
      <Button className={styles.small} disabled={!hasDoc} onClick={() => editor.view.fill()}>
        Fill Screen
      </Button>
    </div>
  );
}

export function MoveOptions() {
  const editor = useEditor();
  const autoSelect = useEditorState((s) => s.toolOptions.move.autoSelect);
  const hasLayer = useEditorState((s) => Boolean(s.doc?.activeLayerId));
  return (
    <>
      <label className={controls.checkbox} title={`Click selects the layer under the cursor (hold ${formatShortcut('Mod+')} to toggle)`}>
        <input type="checkbox" checked={autoSelect} onChange={(e) => editor.setToolOptions('move', { autoSelect: e.target.checked })} />
        Auto-select layer
      </label>
      <span className={styles.divider} />
      <div className={styles.group}>
        <IconButton
          size="small"
          label="Free Transform"
          shortcut={formatShortcut('Alt+Mod+T')}
          icon={<Scan size={14} />}
          disabled={!hasLayer}
          onClick={() => runCommand(editor, 'edit.freeTransform')}
        />
        <IconButton size="small" label="Flip horizontal" icon={<FlipHorizontal2 size={14} />} disabled={!hasLayer} onClick={() => runCommand(editor, 'edit.flipH')} />
        <IconButton size="small" label="Flip vertical" icon={<FlipVertical2 size={14} />} disabled={!hasLayer} onClick={() => runCommand(editor, 'edit.flipV')} />
        <IconButton size="small" label="Rotate 90° counter-clockwise" icon={<RotateCcw size={14} />} disabled={!hasLayer} onClick={() => runCommand(editor, 'edit.rotateCCW')} />
        <IconButton size="small" label="Rotate 90° clockwise" icon={<RotateCw size={14} />} disabled={!hasLayer} onClick={() => runCommand(editor, 'edit.rotateCW')} />
      </div>
      <span className={styles.hint}>Drag to move · Arrow keys nudge (Shift ×10)</span>
    </>
  );
}

export function TransformOptions() {
  const editor = useEditor();
  const t = useEditorState((s) => (s.interaction?.kind === 'transform' ? s.interaction : null));
  const interpolation = useEditorState((s) => s.toolOptions.transform.interpolation);
  const [linked, setLinked] = useState(true);
  if (!t) return null;
  const tool = editor.transformTool;
  const setScale = (axis: 'x' | 'y', v: number): void => {
    if (linked) {
      const ratio = axis === 'x' ? v / t.scaleX : v / t.scaleY;
      tool.setNumeric({ scaleX: t.scaleX * ratio, scaleY: t.scaleY * ratio });
    } else {
      tool.setNumeric(axis === 'x' ? { scaleX: v } : { scaleY: v });
    }
  };
  return (
    <>
      <div className={styles.group}>
        <NumberField label="X" unit="px" precision={1} value={t.cx} width={96} onChange={(cx) => tool.setNumeric({ cx })} />
        <NumberField label="Y" unit="px" precision={1} value={t.cy} width={96} onChange={(cy) => tool.setNumeric({ cy })} />
      </div>
      <span className={styles.divider} />
      <div className={styles.group}>
        <NumberField label="W" unit="%" precision={2} value={t.scaleX} width={96} onChange={(v) => setScale('x', v)} />
        <IconButton
          size="small"
          label={linked ? 'Unlink width and height' : 'Link width and height'}
          icon={linked ? <Link size={13} /> : <Unlink size={13} />}
          pressed={linked}
          onClick={() => setLinked(!linked)}
        />
        <NumberField label="H" unit="%" precision={2} value={t.scaleY} width={96} onChange={(v) => setScale('y', v)} />
        <span className={styles.hint}>
          {Math.round(Math.abs(t.width * t.scaleX) / 100)} × {Math.round(Math.abs(t.height * t.scaleY) / 100)} px
        </span>
      </div>
      <span className={styles.divider} />
      <NumberField label="∠" unit="°" precision={2} value={t.angle} width={84} ariaLabel="Angle" onChange={(angle) => tool.setNumeric({ angle })} />
      <IconButton size="small" label="Flip horizontal" icon={<FlipHorizontal2 size={14} />} onClick={() => tool.flip('horizontal')} />
      <IconButton size="small" label="Flip vertical" icon={<FlipVertical2 size={14} />} onClick={() => tool.flip('vertical')} />
      <span className={styles.divider} />
      <label className={styles.group}>
        <span className={styles.label}>Interpolation</span>
        <select
          className={controls.select}
          value={interpolation}
          onChange={(e) => editor.setToolOptions('transform', { interpolation: e.target.value as ResampleMode })}
        >
          <option value="bicubic">Bicubic</option>
          <option value="bilinear">Bilinear</option>
          <option value="nearest">Nearest Neighbor</option>
        </select>
      </label>
      <span className={styles.divider} />
      <IconButton size="small" label="Cancel transform" shortcut="Esc" icon={<X size={15} />} onClick={() => tool.cancel()} />
      <IconButton size="small" label="Commit transform" shortcut="Enter" icon={<Check size={15} />} onClick={() => tool.commit()} />
    </>
  );
}

const RATIOS: { value: CropRatio; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original Ratio' },
  { value: '1:1', label: '1 : 1 (Square)' },
  { value: '4:5', label: '4 : 5 (8 × 10)' },
  { value: '5:4', label: '5 : 4' },
  { value: '2:3', label: '2 : 3 (4 × 6)' },
  { value: '3:2', label: '3 : 2' },
  { value: '16:9', label: '16 : 9' },
  { value: '9:16', label: '9 : 16' },
];

const FLIPPED: Partial<Record<CropRatio, CropRatio>> = { '4:5': '5:4', '5:4': '4:5', '2:3': '3:2', '3:2': '2:3', '16:9': '9:16', '9:16': '16:9' };

export function CropOptions() {
  const editor = useEditor();
  const opts = useEditorState((s) => s.toolOptions.crop);
  const crop = useEditorState((s) => (s.interaction?.kind === 'crop' ? s.interaction : null));
  const tool = editor.tools.get('crop') as CropTool | undefined;
  if (!tool) return null;
  const setRatio = (ratio: CropRatio): void => {
    editor.setToolOptions('crop', { ratio });
    tool.applyRatio();
  };
  return (
    <>
      <select className={controls.select} value={opts.ratio} aria-label="Aspect ratio" onChange={(e) => setRatio(e.target.value as CropRatio)}>
        {RATIOS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <IconButton
        size="small"
        label="Swap orientation"
        icon={<ArrowLeftRight size={13} />}
        disabled={!FLIPPED[opts.ratio]}
        tooltip={FLIPPED[opts.ratio] ? 'Swap orientation' : 'Choose a fixed ratio to swap orientation'}
        onClick={() => {
          const f = FLIPPED[opts.ratio];
          if (f) setRatio(f);
        }}
      />
      {crop && (
        <div className={styles.group}>
          <NumberField
            label="W"
            unit="px"
            value={crop.width}
            min={1}
            max={editor.caps.maxDocumentSize}
            width={96}
            disabled={opts.ratio !== 'free'}
            title={opts.ratio !== 'free' ? 'Set the ratio to Free to type exact sizes' : undefined}
            onChange={(w) => tool.setRect({ x: crop.x, y: crop.y, width: w, height: crop.height })}
          />
          <NumberField
            label="H"
            unit="px"
            value={crop.height}
            min={1}
            max={editor.caps.maxDocumentSize}
            width={96}
            disabled={opts.ratio !== 'free'}
            title={opts.ratio !== 'free' ? 'Set the ratio to Free to type exact sizes' : undefined}
            onChange={(h) => tool.setRect({ x: crop.x, y: crop.y, width: crop.width, height: h })}
          />
        </div>
      )}
      <span className={styles.divider} />
      <label className={styles.group}>
        <span className={styles.label}>Overlay</span>
        <select
          className={controls.select}
          value={opts.overlay}
          onChange={(e) => {
            editor.setToolOptions('crop', { overlay: e.target.value as 'thirds' | 'grid' | 'none' });
            editor.requestOverlay();
          }}
        >
          <option value="thirds">Rule of Thirds</option>
          <option value="grid">Grid</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className={controls.checkbox} title="Discard pixels outside the crop instead of keeping them off-canvas">
        <input type="checkbox" checked={opts.deletePixels} onChange={(e) => editor.setToolOptions('crop', { deletePixels: e.target.checked })} />
        Delete cropped pixels
      </label>
      <span className={styles.divider} />
      <IconButton size="small" label="Reset crop" shortcut="Esc" icon={<X size={15} />} onClick={() => tool.reset()} />
      <IconButton size="small" label="Commit crop" shortcut="Enter" icon={<Check size={15} />} onClick={() => tool.commit()} />
    </>
  );
}
