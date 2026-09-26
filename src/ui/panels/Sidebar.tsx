import { useState } from 'react';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import styles from './Panel.module.css';

type UpperTab = 'properties';

export function Sidebar({ className }: { className?: string }) {
  const [tab, setTab] = useState<UpperTab>('properties');
  return (
    <aside className={`${styles.sidebar} ${className ?? ''}`} aria-label="Panels">
      <section className={styles.panel} style={{ flex: '0 1 auto', maxHeight: '48%' }}>
        <div className={styles.header} role="tablist" aria-label="Inspector">
          <button type="button" role="tab" className={styles.tab} aria-selected={tab === 'properties'} onClick={() => setTab('properties')}>
            Properties
          </button>
        </div>
        <div className={styles.body} role="tabpanel">
          {tab === 'properties' && <PropertiesPanel />}
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
