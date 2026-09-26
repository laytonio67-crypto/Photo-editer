import { useEffect, useRef } from 'react';
import type { Point } from '../../engine/geometry';
import { useEditor } from '../editorContext';
import { rulerSteps } from './rulerMath';

/** Horizontal or vertical ruler in document pixel units, redrawn on view changes. */
export function Ruler({ orientation, className }: { orientation: 'horizontal' | 'vertical'; className?: string }) {
  const editor = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const horizontal = orientation === 'horizontal';
    let cursor: Point | null = null;
    let frame = 0;
    const styles = getComputedStyle(document.documentElement);
    const tickColor = styles.getPropertyValue('--text-3').trim() || '#5b5e66';
    const labelColor = styles.getPropertyValue('--text-2').trim() || '#858891';
    const markerColor = styles.getPropertyValue('--text-0').trim() || '#e4e5e8';

    const draw = (): void => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const doc = editor.doc;
      if (!doc) return;
      const { zoom, panX, panY } = editor.view.transform;
      // The stage and the ruler share one axis; convert stage device px to ruler px.
      const scale = dpr / editor.view.dpr;
      const pan = (horizontal ? panX : panY) * scale;
      const z = zoom * scale;
      const length = horizontal ? w : h;
      const thickness = horizontal ? h : w;
      const { major, minor } = rulerSteps(z / dpr);
      const start = Math.floor(-pan / z / minor) * minor;
      const end = (length - pan) / z;
      ctx.lineWidth = 1;
      ctx.strokeStyle = tickColor;
      ctx.fillStyle = labelColor;
      ctx.font = `${Math.round(9 * dpr)}px ${styles.getPropertyValue('--font-ui')}`;
      ctx.textBaseline = 'top';
      ctx.beginPath();
      const labels: [number, string][] = [];
      for (let v = start; v <= end; v += minor) {
        const pos = Math.round(v * z + pan) + 0.5;
        const isMajor = Math.abs(v % major) < 1e-6;
        const isHalf = !isMajor && Math.abs(v % (major / 2)) < 1e-6;
        const len = isMajor ? thickness : isHalf ? thickness * 0.45 : thickness * 0.25;
        if (horizontal) {
          ctx.moveTo(pos, thickness);
          ctx.lineTo(pos, thickness - len);
        } else {
          ctx.moveTo(thickness, pos);
          ctx.lineTo(thickness - len, pos);
        }
        if (isMajor) labels.push([pos, String(Math.round(v))]);
      }
      ctx.stroke();
      for (const [pos, text] of labels) {
        if (horizontal) {
          ctx.fillText(text, pos + 3 * dpr, 2 * dpr);
        } else {
          ctx.save();
          ctx.translate(2 * dpr, pos - 3 * dpr);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
      if (cursor) {
        const pos = Math.round((horizontal ? cursor.x : cursor.y) * z + pan) + 0.5;
        ctx.strokeStyle = markerColor;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(pos, 0);
          ctx.lineTo(pos, thickness);
        } else {
          ctx.moveTo(0, pos);
          ctx.lineTo(thickness, pos);
        }
        ctx.stroke();
      }
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const offView = editor.view.events.on('change', schedule);
    const offResize = editor.view.events.on('resize', schedule);
    const offCursor = editor.events.on('cursor', (p) => {
      cursor = p;
      schedule();
    });
    const offDoc = editor.store.subscribe(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    schedule();
    return () => {
      offView();
      offResize();
      offCursor();
      offDoc();
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [editor, orientation]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
