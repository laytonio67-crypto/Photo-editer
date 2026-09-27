import { useState } from 'react';
import { combinedRgb, histogramStats } from '../../engine/histogram/histogram';
import controls from '../controls/controls.module.css';
import { useEditorState } from '../editorContext';
import { HistogramView, type HistogramChannel } from './adjustments/HistogramView';
import styles from './adjustments/Adjustments.module.css';
import { useHistogram } from './adjustments/useHistogram';
import panel from './Panel.module.css';

const CHANNELS: { value: HistogramChannel; label: string }[] = [
  { value: 'colors', label: 'Colors' },
  { value: 'rgb', label: 'RGB' },
  { value: 'luma', label: 'Luminosity' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];

/** Histogram of the whole composite with basic statistics. */
export function HistogramPanel() {
  const doc = useEditorState((s) => s.doc);
  const [channel, setChannel] = useState<HistogramChannel>('colors');
  const histogram = useHistogram(null, doc !== null);
  if (!doc) return <p className={panel.empty}>Open or create a document to see its histogram.</p>;

  const bins = !histogram
    ? null
    : channel === 'rgb'
      ? combinedRgb(histogram)
      : channel === 'luma' || channel === 'colors'
        ? histogram.luma
        : histogram[channel];
  const stats = bins ? histogramStats(bins) : null;
  const sampled = doc.width * doc.height > (1 << 20);
  return (
    <section className={panel.section}>
      <div className={styles.row}>
        <select
          className={`${controls.select} ${styles.grow}`}
          aria-label="Histogram channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as HistogramChannel)}
        >
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.graphBox} style={{ height: 120 }} data-testid="histogram-panel-graph">
        <HistogramView histogram={histogram} channel={channel} width={256} height={120} />
      </div>
      <dl className={panel.kv} style={{ marginTop: 10 }}>
        <dt>Mean</dt>
        <dd>{stats ? stats.mean.toFixed(2) : '…'}</dd>
        <dt>Std dev</dt>
        <dd>{stats ? stats.stdDev.toFixed(2) : '…'}</dd>
        <dt>Median</dt>
        <dd>{stats ? stats.median : '…'}</dd>
        <dt>Pixels</dt>
        <dd>
          {histogram ? histogram.total.toLocaleString() : '…'}
          {sampled ? ' (sampled)' : ''}
        </dd>
      </dl>
      {channel === 'colors' && <p className={styles.hint}>Statistics are for luminosity.</p>}
    </section>
  );
}
