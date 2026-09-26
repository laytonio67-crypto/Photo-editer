import { useCallback, useState } from 'react';
import type { RGB } from '../../engine/doc/types';
import { rgbCss, rgbToHex } from '../../engine/color/color';
import { ColorPicker } from './ColorPicker';

interface ColorSwatchProps {
  color: RGB;
  label: string;
  onChange: (color: RGB) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** A colour well that opens the colour picker popover. */
export function ColorSwatch({ color, label, onChange, className, style }: ColorSwatchProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        type="button"
        className={className}
        style={{ ...style, background: rgbCss(color) }}
        aria-label={`${label}: #${rgbToHex(color)}`}
        title={`${label} (#${rgbToHex(color)})`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      />
      {anchor && <ColorPicker title={label} color={color} anchor={anchor} onChange={onChange} onClose={close} />}
    </>
  );
}
