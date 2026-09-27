import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import styles from './Adjustments.module.css';

export interface BarHandle {
  id: string;
  label: string;
  /** Position along the bar in 0..255 units. */
  position: number;
  /** Triangle colour. */
  fill: string;
  /** Called with the pointer position (0..255, unrounded) while dragging. */
  onDrag: (position: number) => void;
  /** Arrow keys: step −1/+1 (×10 with Shift). */
  onStep: (delta: number) => void;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  valueText?: string;
}

interface HandleBarProps {
  handles: BarHandle[];
  width: number;
  onBegin: () => void;
  onEnd: () => void;
}

/** Row of draggable triangle handles under a histogram or gradient (Levels). */
export function HandleBar({ handles, width, onBegin, onEnd }: HandleBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number } | null>(null);

  const positionAt = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 255;
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, h: BarHandle): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: h.id, pointerId: e.pointerId };
    onBegin();
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>, h: BarHandle): void => {
    if (drag.current?.id !== h.id || drag.current.pointerId !== e.pointerId) return;
    h.onDrag(positionAt(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    onEnd();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, h: BarHandle): void => {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    h.onStep(dir * (e.shiftKey ? 10 : 1));
  };

  return (
    <div ref={ref} className={styles.handles} style={{ width }}>
      {handles.map((h) => (
        <button
          key={h.id}
          type="button"
          role="slider"
          className={styles.handle}
          style={{ left: `${(Math.max(0, Math.min(255, h.position)) / 255) * 100}%`, '--handle-fill': h.fill } as CSSProperties}
          aria-label={h.label}
          aria-valuenow={h.valueNow}
          aria-valuemin={h.valueMin}
          aria-valuemax={h.valueMax}
          aria-valuetext={h.valueText}
          title={h.label}
          onPointerDown={(e) => onPointerDown(e, h)}
          onPointerMove={(e) => onPointerMove(e, h)}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => onKeyDown(e, h)}
        />
      ))}
    </div>
  );
}
