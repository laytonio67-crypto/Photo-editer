import { useState } from 'react';
import { autoLevels, IDENTITY_LEVELS } from '../../../engine/adjustments/curves';
import type { LevelsChannel } from '../../../engine/adjustments/types';
import type { AdjustmentLayer } from '../../../engine/doc/types';
import { combinedRgb, type HistogramData } from '../../../engine/histogram/histogram';
import { Button } from '../../controls/Button';
import { NumberField } from '../../controls/NumberField';
import controls from '../../controls/controls.module.css';
import optionStyles from '../../optionsbar/OptionsBar.module.css';
import { HandleBar } from './HandleBar';
import { HistogramView } from './HistogramView';
import styles from './Adjustments.module.css';
import { CHANNEL_OPTIONS, type ToneChannel } from './toneChannels';
import { useAdjustmentEdit, type AdjustmentOf } from './useAdjustmentEdit';

const WIDTH = 256;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Midtone handle position for a gamma: the input level that maps to 50% output. */
function gammaPosition(l: LevelsChannel): number {
  return l.inBlack + (l.inWhite - l.inBlack) * Math.pow(0.5, l.gamma);
}

function gammaFromPosition(l: LevelsChannel, position: number): number {
  const t = clamp((position - l.inBlack) / Math.max(1, l.inWhite - l.inBlack), 0.001, 0.999);
  return clamp(round2(Math.log(t) / Math.log(0.5)), 0.1, 9.99);
}

/**
 * Levels: input black/midtone/white points over the histogram of the image below the
 * layer, and output black/white. Per-channel settings apply before the RGB (master) ones.
 */
export function LevelsEditor({ layer, histogram }: { layer: AdjustmentLayer; histogram: HistogramData | null }) {
  const edit = useAdjustmentEdit(layer.id, 'levels');
  const [channel, setChannel] = useState<ToneChannel>('rgb');
  const adj = layer.adjustment as AdjustmentOf<'levels'>;
  const l = adj[channel];

  /** Patch of the selected channel, applied to the document's current values. */
  const patch = (fn: (c: LevelsChannel) => Partial<LevelsChannel>, gesture: boolean, key: string) =>
    edit.change((a) => ({ ...a, [channel]: { ...a[channel], ...fn(a[channel]) } }), gesture ? undefined : `${layer.id}:levels:${channel}:${key}`);

  const setInBlack = (v: number, gesture: boolean) => patch((c) => ({ inBlack: clamp(Math.round(v), 0, c.inWhite - 2) }), gesture, 'inBlack');
  const setInWhite = (v: number, gesture: boolean) => patch((c) => ({ inWhite: clamp(Math.round(v), c.inBlack + 2, 255) }), gesture, 'inWhite');
  const setGamma = (v: number, gesture: boolean) => patch(() => ({ gamma: clamp(round2(v), 0.1, 9.99) }), gesture, 'gamma');
  const setOutBlack = (v: number, gesture: boolean) => patch(() => ({ outBlack: clamp(Math.round(v), 0, 255) }), gesture, 'outBlack');
  const setOutWhite = (v: number, gesture: boolean) => patch(() => ({ outWhite: clamp(Math.round(v), 0, 255) }), gesture, 'outWhite');

  const auto = (): void => {
    if (!histogram) return;
    const { inBlack, inWhite } = autoLevels(combinedRgb(histogram));
    edit.change((a) => ({ ...a, rgb: { ...a.rgb, inBlack, inWhite } }));
  };

  const channelColor = channel === 'r' ? '#e0584f' : channel === 'g' ? '#4fbf5f' : channel === 'b' ? '#4f86e0' : '#fff';
  return (
    <>
      <div className={styles.row}>
        <select
          className={`${controls.select} ${styles.grow}`}
          aria-label="Channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ToneChannel)}
        >
          {CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button className={optionStyles.small} disabled={!histogram} onClick={auto} title="Stretch the tonal range to the darkest and lightest pixels">
          Auto
        </Button>
        <Button
          className={optionStyles.small}
          onClick={() => edit.change((a) => ({ ...a, [channel]: { ...IDENTITY_LEVELS } }))}
          title="Reset this channel"
        >
          Reset
        </Button>
      </div>
      <div className={styles.graphBox} style={{ height: 100 }}>
        <HistogramView histogram={histogram} channel={channel} width={WIDTH} height={100} />
      </div>
      <HandleBar
        width={WIDTH}
        onBegin={edit.begin}
        onEnd={edit.end}
        handles={[
          {
            id: 'inBlack',
            label: 'Input black point',
            position: l.inBlack,
            fill: '#111',
            valueNow: l.inBlack,
            valueMin: 0,
            valueMax: l.inWhite - 2,
            onDrag: (p) => setInBlack(p, true),
            onStep: (d) => setInBlack(l.inBlack + d, false),
          },
          {
            id: 'gamma',
            label: 'Midtones (gamma)',
            position: gammaPosition(l),
            fill: '#888',
            valueNow: l.gamma,
            valueMin: 0.1,
            valueMax: 9.99,
            valueText: l.gamma.toFixed(2),
            onDrag: (p) => setGamma(gammaFromPosition(l, p), true),
            onStep: (d) => setGamma(l.gamma * Math.pow(1.02, -d), false),
          },
          {
            id: 'inWhite',
            label: 'Input white point',
            position: l.inWhite,
            fill: '#f4f4f4',
            valueNow: l.inWhite,
            valueMin: l.inBlack + 2,
            valueMax: 255,
            onDrag: (p) => setInWhite(p, true),
            onStep: (d) => setInWhite(l.inWhite + d, false),
          },
        ]}
      />
      <div className={styles.fields}>
        <NumberField ariaLabel="Input black" value={l.inBlack} min={0} max={l.inWhite - 2} width={52} onChange={(v) => setInBlack(v, false)} />
        <NumberField ariaLabel="Gamma" value={l.gamma} min={0.1} max={9.99} step={0.01} precision={2} width={56} onChange={(v) => setGamma(v, false)} />
        <NumberField ariaLabel="Input white" value={l.inWhite} min={l.inBlack + 2} max={255} width={52} onChange={(v) => setInWhite(v, false)} />
      </div>
      <p className={styles.subTitle}>Output levels</p>
      <div className={styles.gradientBar} style={{ background: `linear-gradient(90deg, #000, ${channelColor})` }} />
      <HandleBar
        width={WIDTH}
        onBegin={edit.begin}
        onEnd={edit.end}
        handles={[
          {
            id: 'outBlack',
            label: 'Output black',
            position: l.outBlack,
            fill: '#111',
            valueNow: l.outBlack,
            valueMin: 0,
            valueMax: 255,
            onDrag: (p) => setOutBlack(p, true),
            onStep: (d) => setOutBlack(l.outBlack + d, false),
          },
          {
            id: 'outWhite',
            label: 'Output white',
            position: l.outWhite,
            fill: '#f4f4f4',
            valueNow: l.outWhite,
            valueMin: 0,
            valueMax: 255,
            onDrag: (p) => setOutWhite(p, true),
            onStep: (d) => setOutWhite(l.outWhite + d, false),
          },
        ]}
      />
      <div className={styles.fields}>
        <NumberField ariaLabel="Output black" value={l.outBlack} min={0} max={255} width={52} onChange={(v) => setOutBlack(v, false)} />
        <NumberField ariaLabel="Output white" value={l.outWhite} min={0} max={255} width={52} onChange={(v) => setOutWhite(v, false)} />
      </div>
    </>
  );
}
