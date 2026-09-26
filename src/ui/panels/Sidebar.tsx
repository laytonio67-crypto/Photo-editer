import { useState } from 'react';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { HistoryPanel } from './HistoryPanel';
import styles from './Panel.module.css';

type UpperTab = 'properties' | 'history';

const TABS: { id: UpperTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'history', label: 'History' },
];

export function Sidebar({ className }: { className?: string }) {
  const [tab, setTab] = useState<UpperTab>('properties');
  return (
    <aside className={`${styles.sidebar} ${className ?? ''}`} aria-label="Panels">
      <section className={styles.panel} style={{ flex: '0 1 auto', height: '46%', minHeight: 160 }}>
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
          {tab === 'history' && <HistoryPanel />}
        </div>
      </section>
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
