import { RotateCcw } from 'lucide-react';
import { setAdjustment } from '../../../engine/actions/adjustmentActions';
import { ADJUSTMENTS, defaultAdjustment } from '../../../engine/adjustments/registry';
import type { AdjustmentLayer } from '../../../engine/doc/types';
import { IconButton } from '../../controls/Button';
import { useEditor } from '../../editorContext';
import panel from '../Panel.module.css';
import { ADJUSTMENT_ICONS } from '../adjustmentIcons';
import { CurvesEditor } from './CurvesEditor';
import { LevelsEditor } from './LevelsEditor';
import { SliderEditor } from './SliderEditors';
import { isSliderKind } from './sliderSpecs';
import styles from './Adjustments.module.css';
import { useHistogram } from './useHistogram';

const HINTS: Partial<Record<AdjustmentLayer['adjustment']['kind'], string>> = {
  gaussianBlur: 'Live filter: blurs everything below this layer. Paint on the mask to limit it.',
  sharpen: 'Unsharp mask of everything below. Threshold protects smooth areas such as skin.',
  shadowsHighlights: 'Tonal radius sets how large an area decides whether a pixel is shadow or highlight.',
  blackWhite: 'Each slider sets how light that range of hues becomes in grey.',
};

/** Properties of an adjustment layer: its parameter editor. */
export function AdjustmentSection({ layer }: { layer: AdjustmentLayer }) {
  const editor = useEditor();
  const kind = layer.adjustment.kind;
  const info = ADJUSTMENTS[kind];
  const Icon = ADJUSTMENT_ICONS[kind];
  const needsHistogram = kind === 'levels' || kind === 'curves';
  const histogram = useHistogram(layer.id, needsHistogram);
  return (
    <section className={panel.section} aria-label={`${info.label} settings`}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <Icon size={15} strokeWidth={1.7} />
        </span>
        <h2 className={styles.headerTitle}>{info.label}</h2>
        <IconButton
          size="small"
          label={`Reset ${info.label}`}
          icon={<RotateCcw size={13} />}
          disabled={info.isIdentity(layer.adjustment) || JSON.stringify(layer.adjustment) === JSON.stringify(defaultAdjustment(kind))}
          onClick={() => setAdjustment(editor, layer.id, defaultAdjustment(kind))}
        />
      </div>
      {kind === 'levels' && <LevelsEditor key={layer.id} layer={layer} histogram={histogram} />}
      {kind === 'curves' && <CurvesEditor key={layer.id} layer={layer} histogram={histogram} />}
      {isSliderKind(kind) && <SliderEditor key={layer.id} layer={layer} kind={kind} />}
      {HINTS[kind] && <p className={styles.hint}>{HINTS[kind]}</p>}
    </section>
  );
}
