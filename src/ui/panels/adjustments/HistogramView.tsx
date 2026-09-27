import { useEffect, useRef } from 'react';
import { combinedRgb, type HistogramData } from '../../../engine/histogram/histogram';

export type HistogramChannel = 'rgb' | 'r' | 'g' | 'b' | 'luma' | 'colors';

const CHANNEL_COLORS = { r: '#e0584f', g: '#4fbf5f', b: '#4f86e0' } as const;

/**
 * Bar height scale: the largest bins are often spikes (pure black or white areas) that
 * would flatten everything else, so the scale ignores the few tallest bins.
 */
function scaleFor(bins: ArrayLike<number>): number {
  const sorted = Array.from(bins).sort((a, b) => b - a);
  return Math.max(1, (sorted[4] ?? 0) * 1.15, (sorted[0] ?? 0) * 0.08);
}

function drawBins(g: CanvasRenderingContext2D, bins: ArrayLike<number>, scale: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(0, h);
  for (let i = 0; i < 256; i++) {
    const y = h - Math.min(1, (bins[i] ?? 0) / scale) * h;
    g.lineTo((i / 256) * w, y);
    g.lineTo(((i + 1) / 256) * w, y);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
}

interface HistogramViewProps {
  histogram: HistogramData | null;
  channel: HistogramChannel;
  width: number;
  height: number;
  className?: string;
  /** Draw fainter (as a background behind other content). */
  faint?: boolean;
}

/** Canvas rendering of a 256-bin histogram at device resolution. */
export function HistogramView({ histogram, channel, width, height, className, faint }: HistogramViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (!histogram || histogram.total === 0) return;
    const alpha = faint ? 0.35 : 1;
    if (channel === 'colors') {
      // Overlapping channels with additive blending, like a camera's RGB histogram.
      const scale = Math.max(scaleFor(histogram.r), scaleFor(histogram.g), scaleFor(histogram.b));
      g.globalCompositeOperation = 'lighter';
      for (const c of ['r', 'g', 'b'] as const) {
        g.fillStyle = CHANNEL_COLORS[c];
        g.globalAlpha = 0.75 * alpha;
        drawBins(g, histogram[c], scale, width, height);
      }
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      return;
    }
    const bins = channel === 'rgb' ? combinedRgb(histogram) : channel === 'luma' ? histogram.luma : histogram[channel];
    g.fillStyle = channel === 'rgb' || channel === 'luma' ? '#9a9da6' : CHANNEL_COLORS[channel];
    g.globalAlpha = alpha;
    drawBins(g, bins, scaleFor(bins), width, height);
    g.globalAlpha = 1;
  }, [histogram, channel, width, height, faint]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width, height, display: 'block' }}
      role="img"
      aria-label={histogram ? `Histogram (${histogram.total} pixels sampled)` : 'Histogram (computing)'}
    />
  );
}
