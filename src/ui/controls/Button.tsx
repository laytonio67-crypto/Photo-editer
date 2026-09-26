import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './controls.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger';
}

export function Button({ variant = 'default', className, type = 'button', ...rest }: ButtonProps) {
  const cls = [styles.button, variant === 'primary' && styles.primary, variant === 'danger' && styles.danger, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Accessible name; also shown as tooltip together with the shortcut. */
  label: string;
  shortcut?: string;
  icon: ReactNode;
  pressed?: boolean;
  size?: 'normal' | 'small';
  /** Tooltip override, e.g. explaining why the control is disabled. */
  tooltip?: string;
}

export function IconButton({
  label,
  shortcut,
  icon,
  pressed,
  size = 'normal',
  tooltip,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = [styles.iconButton, size === 'small' && styles.small, className].filter(Boolean).join(' ');
  return (
    <button
      type={type}
      className={cls}
      aria-label={label}
      aria-pressed={pressed}
      title={tooltip ?? (shortcut ? `${label} (${shortcut})` : label)}
      {...rest}
    >
      {icon}
    </button>
  );
}
