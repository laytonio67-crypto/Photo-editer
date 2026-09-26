import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { useEditor, useEditorState } from '../editorContext';
import { commandEnabled, commandLabel, getCommand, runCommand } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import { MENUS, type MenuDef } from './menus';
import styles from './MenuBar.module.css';

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <path d="M16 4a12 12 0 0 1 0 24z" fill="currentColor" />
    </svg>
  );
}

function Dropdown({ menu, left, onClose }: { menu: MenuDef; left: number; onClose: (refocus: boolean) => void }) {
  const editor = useEditor();
  const state = useEditorState((s) => s);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const items = menu.items;

  useEffect(() => {
    ref.current?.focus();
  }, [menu]);

  const selectable = items
    .map((id, i) => ({ id, i }))
    .filter(({ id }) => id !== '-' && commandEnabled(getCommand(id), state, editor) === true)
    .map(({ i }) => i);

  const activate = (id: string): void => {
    onClose(false);
    runCommand(editor, id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectable.length === 0) return;
      const pos = selectable.indexOf(active);
      const next =
        e.key === 'ArrowDown'
          ? selectable[(pos + 1) % selectable.length]!
          : selectable[(pos - 1 + selectable.length) % selectable.length]!;
      setActive(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = items[active];
      if (id && id !== '-' && commandEnabled(getCommand(id), state, editor) === true) activate(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose(true);
    }
  };

  return (
    <div
      ref={ref}
      className={styles.dropdown}
      style={{ left }}
      role="menu"
      aria-label={menu.label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map((id, i) => {
        if (id === '-') return <div key={`sep${i}`} className={styles.separator} role="separator" />;
        const command = getCommand(id);
        const enabled = commandEnabled(command, state, editor);
        const checked = command.checked?.(state);
        return (
          <button
            key={id}
            type="button"
            role={command.checked ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={command.checked ? checked : undefined}
            aria-disabled={enabled !== true}
            title={enabled === true ? undefined : enabled}
            className={styles.item}
            data-active={active === i}
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => enabled === true && activate(id)}
          >
            <span className={styles.check}>{checked && <Check size={13} strokeWidth={2.2} />}</span>
            <span>{commandLabel(command, state)}</span>
            {command.shortcut && <span className={styles.shortcut}>{formatShortcut(command.shortcut)}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar({ className }: { className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const docName = useEditorState((s) => s.doc?.name ?? null);
  const docSize = useEditorState((s) => (s.doc ? `${s.doc.width} × ${s.doc.height}` : null));
  const modified = useEditorState((s) => s.modified);

  const openMenu = (i: number): void => {
    const btn = buttonRefs.current[i];
    const bar = barRef.current;
    if (btn && bar) setLeft(btn.getBoundingClientRect().left - bar.getBoundingClientRect().left);
    setOpen(i);
  };

  const close = (refocus: boolean): void => {
    if (refocus && open !== null) buttonRefs.current[open]?.focus();
    setOpen(null);
  };

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent): void => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onBarKeyDown = (e: KeyboardEvent): void => {
    if (open === null) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = MENUS.length;
      openMenu(e.key === 'ArrowRight' ? (open + 1) % n : (open - 1 + n) % n);
    }
  };

  return (
    <div ref={barRef} className={`${styles.bar} ${className ?? ''}`} onKeyDown={onBarKeyDown}>
      <div className={styles.brand}>
        <BrandMark />
        Emulsion
      </div>
      <nav className={styles.menus} role="menubar" aria-label="Main menu">
        {MENUS.map((menu, i) => (
          <button
            key={menu.label}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className={styles.menuButton}
            onPointerDown={(e) => {
              e.preventDefault();
              if (open === i) setOpen(null);
              else openMenu(i);
            }}
            onPointerEnter={() => open !== null && open !== i && openMenu(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                openMenu(i);
              }
            }}
          >
            {menu.label}
          </button>
        ))}
      </nav>
      <div className={styles.title} aria-live="polite">
        {docName ? (
          <span>
            <strong>{docName}</strong>
            {modified ? ' •' : ''} — {docSize} px
          </span>
        ) : null}
      </div>
      {open !== null && <Dropdown menu={MENUS[open]!} left={left} onClose={close} />}
    </div>
  );
}
