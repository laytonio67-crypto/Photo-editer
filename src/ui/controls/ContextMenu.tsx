import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, useEditorState } from '../editorContext';
import { commandEnabled, commandLabel, getCommand, runCommand } from '../../app/commands';
import { formatShortcut } from '../../app/shortcuts';
import styles from '../menubar/MenuBar.module.css';

export type ContextMenuItem = string | { label: string; run: () => void; disabled?: string | false };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** 'above' opens the menu upwards from `y` (for buttons at the bottom of a panel). */
  placement?: 'below' | 'above';
  /** Accessible name of the menu. */
  label?: string;
}

/** Right-click menu. Items are command ids, custom actions, or '-' separators. */
export function ContextMenu({ x, y, items, onClose, placement = 'below', label }: ContextMenuProps) {
  const editor = useEditor();
  const state = useEditorState((s) => s);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 4),
      top: placement === 'above' ? Math.max(4, y - r.height) : Math.min(y, window.innerHeight - r.height - 4),
    });
    el.focus();
  }, [x, y, placement]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const resolved = items.map((item) => {
    if (item === '-') return null;
    if (typeof item === 'string') {
      const c = getCommand(item);
      const enabled = commandEnabled(c, state, editor);
      return {
        label: commandLabel(c, state),
        shortcut: c.shortcut ? formatShortcut(c.shortcut) : undefined,
        disabled: enabled === true ? false : enabled,
        run: () => runCommand(editor, item),
      };
    }
    return { label: item.label, shortcut: undefined, disabled: item.disabled ?? false, run: item.run };
  });

  const selectable = resolved.map((r, i) => (r && !r.disabled ? i : -1)).filter((i) => i >= 0);

  const onKeyDown = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!selectable.length) return;
      const p = selectable.indexOf(active);
      setActive(
        e.key === 'ArrowDown'
          ? selectable[(p + 1) % selectable.length]!
          : selectable[(p - 1 + selectable.length) % selectable.length]!,
      );
    } else if (e.key === 'Enter') {
      const r = resolved[active];
      if (r && !r.disabled) {
        onClose();
        r.run();
      }
    }
  };

  return createPortal(
    <div
      ref={ref}
      className={styles.dropdown}
      style={{ ...pos, position: 'fixed', borderRadius: 'var(--radius-md)', zIndex: 95 }}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {resolved.map((r, i) =>
        r ? (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={styles.item}
            aria-disabled={Boolean(r.disabled)}
            title={typeof r.disabled === 'string' ? r.disabled : undefined}
            data-active={active === i}
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              if (r.disabled) return;
              onClose();
              r.run();
            }}
          >
            <span />
            <span>{r.label}</span>
            {r.shortcut && <span className={styles.shortcut}>{r.shortcut}</span>}
          </button>
        ) : (
          <div key={i} className={styles.separator} role="separator" />
        ),
      )}
    </div>,
    document.body,
  );
}
