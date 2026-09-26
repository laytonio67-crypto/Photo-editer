import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { RGB } from '../../engine/doc/types';
import { hexToRgb, hsvToRgb, rgbCss, rgbEqual, rgbToHex, rgbToHsv, type HSV } from '../../engine/color/color';
import { NumberField } from '../controls/NumberField';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
  title: string;
  color: RGB;
  anchor: DOMRect;
  onChange: (color: RGB) => void;
  onClose: () => void;
}

/** HSB colour picker popover with RGB/HSB/hex inputs. Changes apply live. */
export function ColorPicker({ title, color, anchor, onChange, onClose }: ColorPickerProps) {
  const [original] = useState(color);
  // Keep HSV as the source of truth while editing so hue survives at s=0/v=0.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color));
  const [hexText, setHexText] = useState(rgbToHex(color));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top });

  useEffect(() => {
    // External changes (e.g. eyedropper) update the picker.
    if (!rgbEqual(hsvToRgb(hsv), color)) {
      setHsv(rgbToHsv(color));
      setHexText(rgbToHex(color));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.right + 8;
    let top = anchor.top;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, anchor.left - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: globalThis.PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const applyHsv = (next: HSV): void => {
    setHsv(next);
    const rgb = hsvToRgb(next);
    setHexText(rgbToHex(rgb));
    onChange(rgb);
  };

  const applyRgb = (rgb: RGB): void => {
    const next = rgbToHsv(rgb);
    setHsv((prev) => ({ h: next.s === 0 ? prev.h : next.h, s: next.s, v: next.v }));
    setHexText(rgbToHex(rgb));
    onChange(rgb);
  };

  const dragSV = (e: PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    applyHsv({ h: hsv.h, s, v });
  };

  const dragHue = (e: PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    applyHsv({ ...hsv, h: t * 360 });
  };

  const rgb = hsvToRgb(hsv);
  const hueColor = rgbCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={pos}
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <p className={styles.title}>{title}</p>
      <div className={styles.pickers}>
        <div
          className={styles.sv}
          style={{ backgroundColor: hueColor }}
          role="slider"
          aria-label="Saturation and brightness"
          aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragSV(e);
          }}
          onPointerMove={(e) => e.buttons & 1 && dragSV(e)}
          onKeyDown={(e) => {
            const d = e.shiftKey ? 0.1 : 0.01;
            if (e.key === 'ArrowLeft') applyHsv({ ...hsv, s: Math.max(0, hsv.s - d) });
            else if (e.key === 'ArrowRight') applyHsv({ ...hsv, s: Math.min(1, hsv.s + d) });
            else if (e.key === 'ArrowDown') applyHsv({ ...hsv, v: Math.max(0, hsv.v - d) });
            else if (e.key === 'ArrowUp') applyHsv({ ...hsv, v: Math.min(1, hsv.v + d) });
            else return;
            e.preventDefault();
          }}
        >
          <div className={styles.svHandle} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div
          className={styles.hue}
          role="slider"
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragHue(e);
          }}
          onPointerMove={(e) => e.buttons & 1 && dragHue(e)}
          onKeyDown={(e) => {
            const d = e.shiftKey ? 10 : 1;
            if (e.key === 'ArrowUp') applyHsv({ ...hsv, h: Math.max(0, hsv.h - d) });
            else if (e.key === 'ArrowDown') applyHsv({ ...hsv, h: Math.min(360, hsv.h + d) });
            else return;
            e.preventDefault();
          }}
        >
          <div className={styles.hueHandle} style={{ top: `${(hsv.h / 360) * 100}%` }} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.compare} title="New / original">
          <span style={{ background: rgbCss(rgb) }} />
          <button
            type="button"
            style={{ background: rgbCss(original) }}
            aria-label="Revert to original color"
            title="Revert to original color"
            onClick={() => applyRgb(original)}
          />
        </div>
        <label className={styles.hex}>
          <span className="sr-only">Hex</span>
          <input
            value={`#${hexText}`}
            spellCheck={false}
            aria-label="Hex color"
            style={{
              width: '100%',
              height: 22,
              padding: '0 6px',
              border: '1px solid var(--border-control)',
              borderRadius: 3,
              background: 'var(--bg-input)',
              fontFamily: 'var(--font-mono)',
            }}
            onChange={(e) => {
              setHexText(e.target.value.replace(/^#/, ''));
              const parsed = hexToRgb(e.target.value);
              if (parsed && e.target.value.replace(/^#/, '').length === 6) applyRgb(parsed);
            }}
            onBlur={() => {
              const parsed = hexToRgb(hexText);
              if (parsed) applyRgb(parsed);
              else setHexText(rgbToHex(rgb));
            }}
          />
        </label>
      </div>
      <div className={styles.grid}>
        <NumberField label="R" value={rgb.r} min={0} max={255} onChange={(r) => applyRgb({ ...rgb, r })} />
        <NumberField label="G" value={rgb.g} min={0} max={255} onChange={(g) => applyRgb({ ...rgb, g })} />
        <NumberField label="B" value={rgb.b} min={0} max={255} onChange={(b) => applyRgb({ ...rgb, b })} />
        <NumberField
          label="H"
          unit="°"
          value={Math.round(hsv.h)}
          min={0}
          max={360}
          onChange={(h) => applyHsv({ ...hsv, h })}
        />
        <NumberField
          label="S"
          unit="%"
          value={Math.round(hsv.s * 100)}
          min={0}
          max={100}
          onChange={(s) => applyHsv({ ...hsv, s: s / 100 })}
        />
        <NumberField
          label="B"
          unit="%"
          ariaLabel="Brightness"
          value={Math.round(hsv.v * 100)}
          min={0}
          max={100}
          onChange={(v) => applyHsv({ ...hsv, v: v / 100 })}
        />
      </div>
    </div>,
    document.body,
  );
}
