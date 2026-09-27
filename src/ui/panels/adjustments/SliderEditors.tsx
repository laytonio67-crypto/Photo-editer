import { defaultAdjustment } from '../../../engine/adjustments/registry';
import type { AdjustmentLayer } from '../../../engine/doc/types';
import controls from '../../controls/controls.module.css';
import { AdjustmentSlider } from './AdjustmentSlider';
import styles from './Adjustments.module.css';
import { SLIDER_SPECS, type SliderKind } from './sliderSpecs';
import { useAdjustmentEdit, type AdjustmentOf } from './useAdjustmentEdit';

/** Editor for adjustments whose parameters are all plain numbers (plus Colorize). */
export function SliderEditor<K extends SliderKind>({ layer, kind }: { layer: AdjustmentLayer; kind: K }) {
  const edit = useAdjustmentEdit(layer.id, kind);
  const adj = layer.adjustment as AdjustmentOf<K>;
  const values = adj as unknown as Record<string, number>;
  const defaults = defaultAdjustment(kind) as unknown as Record<string, number>;
  const colorize = layer.adjustment.kind === 'hueSaturation' && layer.adjustment.colorize;
  return (
    <>
      {SLIDER_SPECS[kind].map((spec) => {
        // Colorize sets an absolute hue and saturation instead of shifting them.
        const range = colorize && spec.key === 'saturation' ? { min: 0, max: 100 } : spec;
        return (
          <AdjustmentSlider
            key={spec.key}
            label={spec.label}
            value={values[spec.key] ?? 0}
            min={range.min}
            max={range.max}
            step={spec.step}
            precision={spec.precision}
            unit={spec.unit}
            track={colorize && spec.key === 'saturation' ? 'linear-gradient(90deg, #808080, #e0302a)' : spec.track}
            defaultValue={defaults[spec.key] ?? 0}
            onBegin={edit.begin}
            onEnd={edit.end}
            onValue={(v, gesture) =>
              edit.change((a) => ({ ...a, [spec.key]: v }), gesture ? undefined : `${layer.id}:${spec.key}`)
            }
          />
        );
      })}
      {layer.adjustment.kind === 'hueSaturation' && (
        <div className={styles.row}>
          <label className={controls.checkbox}>
            <input
              type="checkbox"
              checked={layer.adjustment.colorize}
              onChange={(e) => {
                const on = e.target.checked;
                edit.change((a) => {
                  const hs = a as AdjustmentOf<'hueSaturation'>;
                  // Like Photoshop: colorizing starts from a visible tint.
                  return { ...hs, colorize: on, saturation: on ? (hs.saturation > 0 ? hs.saturation : 25) : 0 } as AdjustmentOf<K>;
                });
              }}
            />
            Colorize
          </label>
        </div>
      )}
    </>
  );
}
