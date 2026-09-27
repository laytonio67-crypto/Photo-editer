import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor } from '../editorContext';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { HistogramPanel } from './HistogramPanel';
import { HistoryPanel } from './HistoryPanel';
import styles from './Panel.module.css';

type UpperTab = 'properties' | 'histogram' | 'history';

const TABS: { id: UpperTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'history', label: 'History' },
];

const SPLIT_KEY = 'emulsion.inspectorHeight';
const MIN_UPPER = 120;
const MIN_LOWER = 150;

function loadSplit(): number | null {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveSplit(height: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(height)));
  } catch {
    // Storage unavailable (private mode): the split just isn't remembered.
  }
}

export function Sidebar({ className }: { className?: string }) {
  const editor = useEditor();
  const [tab, setTab] = useState<UpperTab>('properties');
  // Height of the inspector (upper) panel in CSS px; null = default proportion.
  const [upper, setUpper] = useState<number | null>(loadSplit);
  const asideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  useEffect(() => editor.events.on('revealPanel', (panel) => setTab(panel)), [editor]);

  const clampHeight = (h: number): number => {
    const total = asideRef.current?.clientHeight ?? 800;
    return Math.max(MIN_UPPER, Math.min(total - MIN_LOWER, h));
  };
  const currentHeight = (): number => {
    const section = asideRef.current?.firstElementChild as HTMLElement | null;
    return section?.getBoundingClientRect().height ?? 300;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: currentHeight() };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setUpper(clampHeight(d.startHeight + e.clientY - d.startY));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    saveSplit(currentHeight());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const d = e.key === 'ArrowUp' ? -16 : e.key === 'ArrowDown' ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    const next = clampHeight(currentHeight() + d);
    setUpper(next);
    saveSplit(next);
  };

  return (
    <aside ref={asideRef} className={`${styles.sidebar} ${className ?? ''}`} aria-label="Panels">
      <section className={styles.panel} style={{ flex: 'none', height: upper ?? '46%', minHeight: MIN_UPPER }}>
        <div className={styles.header} role="tablist" aria-label="Inspector">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              className={styles.tab}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.body} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'properties' && <PropertiesPanel />}
          {tab === 'histogram' && <HistogramPanel />}
          {tab === 'history' && <HistoryPanel />}
        </div>
      </section>
      <div
        className={styles.splitter}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize inspector and layers panels"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          setUpper(null);
          try {
            localStorage.removeItem(SPLIT_KEY);
          } catch {
            // ignore
          }
        }}
      />
      <section className={styles.panel} style={{ flex: 1 }}>
        <div className={styles.header}>
          <span className={styles.tab} aria-selected="true" role="heading" aria-level={2}>
            Layers
          </span>
        </div>
        <LayersPanel />
      </section>
    </aside>
  );
}
