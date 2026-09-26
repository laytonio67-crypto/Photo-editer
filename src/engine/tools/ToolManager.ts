import type { Editor } from '../Editor';
import type { Tool, ToolId, ToolKeyEvent, ToolPointerEvent } from './types';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function isModKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

export function toToolKeyEvent(e: KeyboardEvent): ToolKeyEvent {
  return { key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, mod: isModKey(e), repeat: e.repeat };
}

/**
 * Routes viewport input to the active tool. Handles pointer capture, temporary tools
 * (Space → Hand, middle-button pan) and wheel zoom/pan.
 */
export class ToolManager {
  private readonly tools = new Map<ToolId, Tool>();
  private element: HTMLElement | null = null;
  private spaceHeld = false;
  /** Tool that owns the current press (kept until release even if tools change). */
  private gestureTool: Tool | null = null;
  private pointerId: number | null = null;
  private lastEvent: ToolPointerEvent | null = null;
  private hovering = false;
  /** Modal interaction (e.g. Free Transform) that receives input instead of the tool. */
  private mode: Tool | null = null;

  constructor(private readonly editor: Editor) {}

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  get(id: ToolId): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: ToolId): boolean {
    return this.tools.has(id);
  }

  /** The tool currently receiving input (a temporary tool takes precedence). */
  get active(): Tool {
    if (this.gestureTool) return this.gestureTool;
    if (this.spaceHeld) return this.tools.get('hand')!;
    if (this.mode) return this.mode;
    return this.current;
  }

  /** The selected toolbar tool (ignoring modes and temporary tools). */
  get current(): Tool {
    const id = this.editor.store.get().tool;
    return this.tools.get(id) ?? this.tools.get('hand')!;
  }

  get activeMode(): Tool | null {
    return this.mode;
  }

  /** Enters/leaves a modal interaction. */
  setMode(mode: Tool | null): void {
    if (this.mode === mode) return;
    if (this.gestureTool) this.cancelGesture();
    this.mode?.deactivate?.();
    this.mode = mode;
    mode?.activate?.();
    this.refreshCursor();
    this.editor.requestOverlay();
  }

  get isPressed(): boolean {
    return this.pointerId !== null;
  }

  /** Pointer position of the latest event over the viewport (for overlays like brush cursors). */
  get pointer(): ToolPointerEvent | null {
    return this.hovering || this.pointerId !== null ? this.lastEvent : null;
  }

  setTool(id: ToolId): void {
    if (!this.tools.has(id)) return;
    // Leaving a modal interaction commits it (like pro editors' "apply" default).
    if (this.mode) this.mode.onCommitRequest?.();
    const prev = this.editor.store.get().tool;
    if (prev === id) return;
    if (this.gestureTool) this.cancelGesture();
    this.tools.get(prev)?.deactivate?.();
    this.editor.store.set({ tool: id });
    this.tools.get(id)?.activate?.();
    this.refreshCursor();
    this.editor.requestOverlay();
  }

  refreshCursor(): void {
    if (this.element) this.element.style.cursor = this.active.cursor();
  }

  private toToolEvent(e: PointerEvent): ToolPointerEvent {
    const el = this.element!;
    const rect = el.getBoundingClientRect();
    const dpr = this.editor.view.dpr;
    const view = this.editor.view;
    const convert = (ev: PointerEvent) => {
      const screen = { x: (ev.clientX - rect.left) * dpr, y: (ev.clientY - rect.top) * dpr };
      return {
        screen,
        doc: view.screenToDoc(screen),
        pressure: ev.pointerType === 'pen' ? ev.pressure : 1,
      };
    };
    const main = convert(e);
    const coalesced =
      typeof e.getCoalescedEvents === 'function'
        ? e.getCoalescedEvents().map((c) => {
            const p = convert(c);
            return { doc: p.doc, pressure: p.pressure };
          })
        : [];
    return {
      doc: main.doc,
      screen: main.screen,
      pressure: main.pressure,
      pointerType: e.pointerType,
      button: e.button,
      buttons: e.buttons,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: isModKey(e),
      timeStamp: e.timeStamp,
      coalesced,
    };
  }

  /** Wires input listeners to the viewport element. Returns a detach function. */
  attach(element: HTMLElement): () => void {
    this.element = element;
    const onDown = (e: PointerEvent): void => {
      if (this.pointerId !== null) return;
      if (e.button !== 0 && e.button !== 1) return;
      if (!this.editor.store.get().doc) return;
      e.preventDefault();
      element.focus({ preventScroll: true });
      element.setPointerCapture(e.pointerId);
      this.pointerId = e.pointerId;
      this.gestureTool = e.button === 1 ? this.tools.get('hand')! : this.active;
      const te = this.toToolEvent(e);
      this.lastEvent = te;
      this.gestureTool.onPointerDown?.(te);
      this.refreshCursor();
      this.editor.requestOverlay();
    };
    const onMove = (e: PointerEvent): void => {
      const te = this.toToolEvent(e);
      this.lastEvent = te;
      if (this.pointerId !== null) {
        if (e.pointerId !== this.pointerId) return;
        this.gestureTool?.onPointerMove?.(te, true);
      } else if (this.editor.store.get().doc) {
        this.active.onPointerMove?.(te, false);
      }
      this.editor.setCursorPosition(te.doc);
      this.editor.requestOverlay();
    };
    const finish = (e: PointerEvent, cancelled: boolean): void => {
      if (this.pointerId === null || e.pointerId !== this.pointerId) return;
      const tool = this.gestureTool;
      this.pointerId = null;
      this.gestureTool = null;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      if (cancelled) tool?.onCancel?.();
      else tool?.onPointerUp?.(this.toToolEvent(e));
      this.refreshCursor();
      this.editor.requestOverlay();
    };
    const onUp = (e: PointerEvent): void => finish(e, false);
    const onCancel = (e: PointerEvent): void => finish(e, true);
    const onEnter = (): void => {
      this.hovering = true;
      this.editor.requestOverlay();
    };
    const onLeave = (): void => {
      this.hovering = false;
      this.editor.setCursorPosition(null);
      this.editor.requestOverlay();
    };
    const onWheel = (e: WheelEvent): void => {
      if (!this.editor.store.get().doc) return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const dpr = this.editor.view.dpr;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const anchor = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Pinch gestures arrive as ctrl+wheel with small fractional deltas.
        const factor = Math.exp((-e.deltaY * unit) / 300);
        this.editor.view.zoomTo(this.editor.view.zoom * factor, anchor);
      } else {
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        this.editor.view.panBy(-dx * dpr, -dy * dpr);
      }
    };
    const onContextMenu = (e: Event): void => e.preventDefault();

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContextMenu);
    this.refreshCursor();
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('pointerenter', onEnter);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      if (this.element === element) this.element = null;
    };
  }

  /** Aborts an in-progress press (tool change, window blur, Escape). */
  cancelGesture(): void {
    if (this.pointerId === null) return;
    const tool = this.gestureTool;
    if (this.element?.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    this.pointerId = null;
    this.gestureTool = null;
    tool?.onCancel?.();
    this.refreshCursor();
    this.editor.requestOverlay();
  }

  /** Global key handling for tools. Returns true if consumed. */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'Space' && !e.repeat && !isModKey(e)) {
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.refreshCursor();
      }
      return true;
    }
    if (e.code === 'Space') return true;
    return this.active.onKeyDown?.(toToolKeyEvent(e)) ?? false;
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      this.refreshCursor();
      return true;
    }
    return this.active.onKeyUp?.(toToolKeyEvent(e)) ?? false;
  }

  /** Window lost focus: release temporary modifiers. */
  handleBlur(): void {
    this.spaceHeld = false;
    this.refreshCursor();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    this.active.drawOverlay?.(ctx);
  }
}
