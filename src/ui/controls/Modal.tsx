import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './controls.module.css';

interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  onClose: () => void;
  /** Enter key (outside of text areas/buttons) triggers this. */
  onSubmit?: () => void;
}

/** Accessible modal dialog: traps focus, closes on Escape, submits on Enter. */
export function Modal({ title, children, footer, width = 420, onClose, onSubmit }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus], input, select, button');
    first?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && onSubmit) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
      e.preventDefault();
      // Let fields commit their value on blur before submitting.
      (document.activeElement as HTMLElement | null)?.blur();
      setTimeout(onSubmit, 0);
    } else if (e.key === 'Tab') {
      const focusables = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ??
          [],
      ).filter((x) => !x.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className={styles.backdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        onKeyDown={onKeyDown}
      >
        <div className={styles.modalHeader} id={titleId}>
          {title}
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  );
}
