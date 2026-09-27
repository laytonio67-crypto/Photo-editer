import type { Editor } from '../Editor';
import type { PaintTarget } from '../paint/PaintTarget';
import { maskGrey } from '../paint/PixelOps';
import type { BrushOptions } from './options';
import { sampleColor } from './sampleColor';
import { StrokeTool, type StrokePaint } from './StrokeTool';
import type { Tool, ToolPointerEvent } from './types';

export { nextBrushSize } from './StrokeTool';

/** Brush and Eraser (see StrokeTool for the stroke pipeline). */
export class BrushTool extends StrokeTool {
  constructor(
    editor: Editor,
    readonly id: 'brush' | 'eraser',
  ) {
    super(editor);
  }

  protected options(): BrushOptions {
    return this.editor.store.get().toolOptions[this.id];
  }

  protected setOptions(patch: Partial<BrushOptions>): void {
    this.editor.setToolOptions(this.id, patch);
  }

  protected label(): string {
    return this.id === 'brush' ? 'Brush Tool' : 'Eraser';
  }

  protected prepare(target: PaintTarget): StrokePaint {
    const { foreground, background } = this.editor.store.get();
    if (target.part === 'mask') {
      // Masks: brush paints the foreground grey, eraser the background grey.
      return { op: 'mask', color: maskGrey(this.id === 'brush' ? foreground : background), preserveAlpha: false };
    }
    if (this.id === 'eraser') {
      // With locked transparency the eraser paints the background colour instead.
      return target.preserveAlpha
        ? { op: 'paint', color: background, preserveAlpha: true }
        : { op: 'erase', color: background, preserveAlpha: false };
    }
    return { op: 'paint', color: foreground, preserveAlpha: target.preserveAlpha };
  }

  /** Alt-click with the brush samples a colour, like the Eyedropper. */
  protected override onAltPress(e: ToolPointerEvent): boolean {
    if (this.id !== 'brush') return false;
    const opts = this.editor.store.get().toolOptions.eyedropper;
    const c = sampleColor(this.editor, e.doc, opts.sampleSize, opts.sample);
    if (c) this.editor.setColors({ foreground: c });
    return true;
  }
}

/** Eyedropper: click or drag to pick the foreground colour (Alt: background). */
export class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return 'crosshair';
  }

  private pick(e: ToolPointerEvent): void {
    const opts = this.editor.store.get().toolOptions.eyedropper;
    const c = sampleColor(this.editor, e.doc, opts.sampleSize, opts.sample);
    if (!c) return;
    this.editor.setColors(e.alt ? { background: c } : { foreground: c });
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.pick(e);
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (pressed) this.pick(e);
  }
}
