import type { Editor } from '../Editor';
import type { Point } from '../geometry';
import type { Tool, ToolPointerEvent } from './types';

const DRAG_THRESHOLD = 4;

/**
 * Click to zoom in, Alt-click to zoom out. Dragging horizontally zooms continuously
 * around the press point ("scrubby zoom").
 */
export class ZoomTool implements Tool {
  readonly id = 'zoom' as const;
  private start: { screen: Point; zoom: number; alt: boolean } | null = null;
  private dragging = false;
  private altHeld = false;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return this.altHeld ? 'zoom-out' : 'zoom-in';
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.start = { screen: e.screen, zoom: this.editor.view.zoom, alt: e.alt };
    this.dragging = false;
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (this.altHeld !== e.alt) {
      this.altHeld = e.alt;
      this.editor.tools.refreshCursor();
    }
    if (!pressed || !this.start) return;
    const dx = e.screen.x - this.start.screen.x;
    if (!this.dragging && Math.abs(dx) < DRAG_THRESHOLD * this.editor.view.dpr) return;
    this.dragging = true;
    // Exponential mapping: 200 device px doubles/halves the zoom.
    const factor = Math.pow(2, dx / (200 * this.editor.view.dpr));
    this.editor.view.zoomTo(this.start.zoom * factor, this.start.screen);
  }

  onPointerUp(e: ToolPointerEvent): void {
    if (this.start && !this.dragging) {
      if (e.alt) this.editor.view.zoomOut(e.screen);
      else this.editor.view.zoomIn(e.screen);
    }
    this.start = null;
    this.dragging = false;
  }

  onCancel(): void {
    this.start = null;
    this.dragging = false;
  }

  onKeyDown(e: { key: string }): boolean {
    if (e.key === 'Alt') {
      this.altHeld = true;
      this.editor.tools.refreshCursor();
    }
    return false;
  }

  onKeyUp(e: { key: string }): boolean {
    if (e.key === 'Alt') {
      this.altHeld = false;
      this.editor.tools.refreshCursor();
    }
    return false;
  }
}
