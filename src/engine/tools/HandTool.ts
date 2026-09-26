import type { Editor } from '../Editor';
import type { Point } from '../geometry';
import type { Tool, ToolPointerEvent } from './types';

/** Pans the view by dragging. Also used temporarily while Space is held. */
export class HandTool implements Tool {
  readonly id = 'hand' as const;
  private last: Point | null = null;

  constructor(private readonly editor: Editor) {}

  cursor(): string {
    return this.last ? 'grabbing' : 'grab';
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e.screen;
    this.editor.tools.refreshCursor();
  }

  onPointerMove(e: ToolPointerEvent, pressed: boolean): void {
    if (!pressed || !this.last) return;
    this.editor.view.panBy(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = e.screen;
  }

  onPointerUp(): void {
    this.last = null;
    this.editor.tools.refreshCursor();
  }

  onCancel(): void {
    this.last = null;
  }

  hasActiveGesture(): boolean {
    return this.last !== null;
  }
}
