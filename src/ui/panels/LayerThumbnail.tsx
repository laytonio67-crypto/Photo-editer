import { useEffect, useRef, useState } from 'react';
import type { Layer } from '../../engine/doc/types';
import { fitSize } from '../../engine/render/Thumbnails';
import { useEditor } from '../editorContext';

interface LayerThumbnailProps {
  layer: Layer;
  docWidth: number;
  docHeight: number;
  /** Box size in CSS px. */
  size: number;
  className?: string;
  /** Render the layer's mask instead of its content. */
  mask?: boolean;
}

/**
 * GPU-rendered thumbnail of a layer (or its mask) in the context of the whole canvas.
 * Redraws when the layer object changes or its surface pixels change (debounced).
 */
export function LayerThumbnail({ layer, docWidth, docHeight, size, className, mask = false }: LayerThumbnailProps) {
  const editor = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const [pixelVersion, setPixelVersion] = useState(0);
  const surfaceId = mask ? (layer.mask?.surfaceId ?? null) : layer.type === 'pixel' ? layer.surfaceId : null;

  useEffect(() => {
    if (!surfaceId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = editor.events.on('surfaceChanged', (id) => {
      if (id !== surfaceId) return;
      clearTimeout(timer);
      timer = setTimeout(() => setPixelVersion((v) => v + 1), 160);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [editor, surfaceId]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !surfaceId || !editor.surfaces.has(surfaceId)) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = fitSize(docWidth, docHeight, Math.round(size * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = `${width / dpr}px`;
    canvas.style.height = `${height / dpr}px`;
    const surface = editor.surfaces.get(surfaceId);
    const placement =
      mask && layer.mask ? { x: layer.mask.x, y: layer.mask.y } : layer.type === 'pixel' ? { x: layer.x, y: layer.y } : { x: 0, y: 0 };
    let cancelled = false;
    editor.thumbnails
      .render(
        {
          texture: editor.surfaces.texture(surfaceId),
          width: surface.width,
          height: surface.height,
          x: placement.x,
          y: placement.y,
          grayscale: mask,
          outsideValue: mask && layer.mask ? layer.mask.defaultValue / 255 : 0,
        },
        { x: 0, y: 0, width: docWidth, height: docHeight },
        width,
        height,
      )
      .then((image) => {
        if (!cancelled) canvas.getContext('2d')?.putImageData(image, 0, 0);
      })
      .catch((err: unknown) => console.warn('Thumbnail render failed', err));
    return () => {
      cancelled = true;
    };
  }, [editor, layer, surfaceId, mask, docWidth, docHeight, size, pixelVersion]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
