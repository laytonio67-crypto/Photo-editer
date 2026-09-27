import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { curveFunction, IDENTITY_CURVE } from '../../../engine/adjustments/curves';
import type { CurvePoint } from '../../../engine/adjustments/types';
import type { AdjustmentLayer } from '../../../engine/doc/types';
import type { HistogramData } from '../../../engine/histogram/histogram';
import { Button } from '../../controls/Button';
import { NumberField } from '../../controls/NumberField';
import controls from '../../controls/controls.module.css';
import optionStyles from '../../optionsbar/OptionsBar.module.css';
import { HistogramView } from './HistogramView';
import { CHANNEL_OPTIONS, type ToneChannel } from './toneChannels';
import styles from './Adjustments.module.css';
import { useAdjustmentEdit, type AdjustmentOf } from './useAdjustmentEdit';

const SIZE = 256;
/** Dragging a point this far (px) outside the graph removes it. */
const REMOVE_DISTANCE = 24;
/** Points closer than this (px) to the pointer are picked instead of adding a new one. */
const PICK_RADIUS = 7;

const CURVE_COLORS: Record<ToneChannel, string> = { rgb: '#e4e5e8', r: '#e0584f', g: '#4fbf5f', b: '#4f86e0' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** SVG path of a curve sampled at every input level (y axis points up). */
function curvePath(points: readonly CurvePoint[]): string {
  const f = curveFunction(points);
  let d = '';
  for (let x = 0; x <= 255; x++) d += `${x === 0 ? 'M' : 'L'}${x + 0.5},${(255 - f(x) + 0.5).toFixed(2)}`;
  return d;
}

/**
 * Curves: a monotone spline through editable points per channel, drawn over the
 * histogram of the image below. Click to add a point, drag to move, drag it off the
 * graph (or press Delete) to remove it; arrow keys nudge the selected point.
 */
export function CurvesEditor({ layer, histogram }: { layer: AdjustmentLayer; histogram: HistogramData | null }) {
  const edit = useAdjustmentEdit(layer.id, 'curves');
  const [channel, setChannel] = useState<ToneChannel>('rgb');
  const [selected, setSelected] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; index: number } | null>(null);
  const adj = layer.adjustment as AdjustmentOf<'curves'>;
  const points = adj[channel];
  const index = Math.min(selected, points.length - 1);
  const point = points[index];
  const path = useMemo(() => curvePath(points), [points]);

  const setPoints = (fn: (pts: CurvePoint[]) => CurvePoint[], mergeKey?: string) =>
    edit.change((a) => ({ ...a, [channel]: fn(a[channel]) }), mergeKey);

  /** Moves point `i` to (x, y), keeping it strictly between its neighbours. */
  const movePoint = (i: number, x: number, y: number, mergeKey?: string) =>
    setPoints((pts) => {
      if (!pts[i]) return pts;
      const lo = i > 0 ? pts[i - 1]!.x + 1 : 0;
      const hi = i < pts.length - 1 ? pts[i + 1]!.x - 1 : 255;
      const next = [...pts];
      next[i] = { x: clamp(Math.round(x), lo, hi), y: clamp(Math.round(y), 0, 255) };
      return next;
    }, mergeKey);

  const removePoint = (i: number) => {
    if (points.length <= 2) return;
    setPoints((pts) => (pts.length > 2 ? pts.filter((_, k) => k !== i) : pts));
    setSelected(Math.max(0, i - 1));
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * SIZE;
    const sy = ((e.clientY - r.top) / r.height) * SIZE;
    return { sx, sy, x: sx - 0.5, y: 255 - (sy - 0.5) };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    svgRef.current?.focus();
    const p = local(e);
    let i = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= PICK_RADIUS);
    edit.begin();
    if (i < 0) {
      // New point at the pointer, inserted in x order (not on an existing x).
      const x = clamp(Math.round(p.x), 0, 255);
      if (points.some((q) => q.x === x)) {
        i = points.findIndex((q) => q.x === x);
      } else {
        i = points.findIndex((q) => q.x > x);
        if (i < 0) i = points.length;
        const at = i;
        setPoints((pts) => [...pts.slice(0, at), { x, y: clamp(Math.round(p.y), 0, 255) }, ...pts.slice(at)]);
      }
    }
    setSelected(i);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, index: i };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = local(e);
    const outside = p.sx < -REMOVE_DISTANCE || p.sy < -REMOVE_DISTANCE || p.sx > SIZE + REMOVE_DISTANCE || p.sy > SIZE + REMOVE_DISTANCE;
    if (outside && points.length > 2) {
      removePoint(d.index);
      drag.current = null;
      edit.end();
      return;
    }
    movePoint(d.index, p.x, p.y);
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    edit.end();
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!point) return;
    const step = e.shiftKey ? 10 : 1;
    const key = `${layer.id}:curves:${channel}:${index}`;
    if (e.key === 'ArrowLeft') movePoint(index, point.x - step, point.y, key);
    else if (e.key === 'ArrowRight') movePoint(index, point.x + step, point.y, key);
    else if (e.key === 'ArrowUp') movePoint(index, point.x, point.y + step, key);
    else if (e.key === 'ArrowDown') movePoint(index, point.x, point.y - step, key);
    else if (e.key === 'Delete' || e.key === 'Backspace') removePoint(index);
    else if (e.key === 'Tab' && points.length > 1) {
      // Tab cycles through points while the graph has focus (Shift+Tab backwards).
      const next = index + (e.shiftKey ? -1 : 1);
      if (next < 0 || next >= points.length) return;
      setSelected(next);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const color = CURVE_COLORS[channel];
  return (
    <>
      <div className={styles.row}>
        <select
          className={`${controls.select} ${styles.grow}`}
          aria-label="Channel"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as ToneChannel);
            setSelected(0);
          }}
        >
          {CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button
          className={optionStyles.small}
          onClick={() => {
            setPoints(() => IDENTITY_CURVE.map((p) => ({ ...p })));
            setSelected(0);
          }}
          title="Reset this channel"
        >
          Reset
        </Button>
      </div>
      <div className={styles.graphBox} style={{ height: SIZE }}>
        <HistogramView histogram={histogram} channel={channel} width={SIZE} height={SIZE} faint />
        <svg
          ref={svgRef}
          className={styles.curveSvg}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          tabIndex={0}
          role="application"
          aria-label={`${CHANNEL_OPTIONS.find((o) => o.value === channel)!.label} curve. Click to add a point, drag to move, arrow keys nudge, Delete removes.`}
          data-testid="curve-graph"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {[64, 128, 192].map((v) => (
            <g key={v} stroke="rgba(255,255,255,0.09)" strokeWidth={1}>
              <line x1={v + 0.5} y1={0} x2={v + 0.5} y2={SIZE} />
              <line x1={0} y1={v + 0.5} x2={SIZE} y2={v + 0.5} />
            </g>
          ))}
          <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
          {points.map((p, i) => (
            <rect
              key={i}
              x={p.x + 0.5 - 3.5}
              y={255 - p.y + 0.5 - 3.5}
              width={7}
              height={7}
              fill={i === index ? color : '#1a1b1e'}
              stroke={color}
              strokeWidth={1.2}
            />
          ))}
        </svg>
      </div>
      {point && (
        <div className={styles.fields} style={{ marginTop: 8 }}>
          <NumberField
            label="Input"
            value={point.x}
            min={0}
            max={255}
            width={96}
            onChange={(v) => movePoint(index, v, point.y)}
          />
          <NumberField
            label="Output"
            value={point.y}
            min={0}
            max={255}
            width={104}
            onChange={(v) => movePoint(index, point.x, v)}
          />
        </div>
      )}
    </>
  );
}
