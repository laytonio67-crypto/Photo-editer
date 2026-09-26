import type { Point } from '../geometry';

export type ToolId =
  | 'move'
  | 'marqueeRect'
  | 'marqueeEllipse'
  | 'lasso'
  | 'polygonLasso'
  | 'magicWand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'eraser'
  | 'cloneStamp'
  | 'healingBrush'
  | 'text'
  | 'hand'
  | 'zoom'
  /** Free Transform mode (not a toolbar tool). */
  | 'transform';

export interface ToolPointerEvent {
  /** Document coordinates (fractional). */
  doc: Point;
  /** Canvas coordinates in device pixels. */
  screen: Point;
  /** 0..1; 1 for devices without pressure. */
  pressure: number;
  pointerType: string;
  button: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean;
  timeStamp: number;
  /** Higher-rate samples between this and the previous event (pen/mouse coalesced events). */
  coalesced: { doc: Point; pressure: number }[];
}

export interface ToolKeyEvent {
  key: string;
  code: string;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  repeat: boolean;
}

/**
 * A tool receives pointer input in document space and may draw an overlay on the
 * 2D overlay canvas (in device pixels).
 */
export interface Tool {
  readonly id: ToolId;
  /** CSS cursor for the viewport. */
  cursor(): string;
  activate?(): void;
  deactivate?(): void;
  onPointerDown?(e: ToolPointerEvent): void;
  onPointerMove?(e: ToolPointerEvent, pressed: boolean): void;
  onPointerUp?(e: ToolPointerEvent): void;
  /** Pointer capture was lost unexpectedly (e.g. window blur); abort the gesture. */
  onCancel?(): void;
  /** Return true if the key was consumed. */
  onKeyDown?(e: ToolKeyEvent): boolean;
  /** Return true to receive this key before menu shortcuts (e.g. Backspace while drawing a polygon). */
  capturesKey?(e: ToolKeyEvent): boolean;
  onKeyUp?(e: ToolKeyEvent): boolean;
  /** Draws interactive overlays; `ctx` is in device pixels, already cleared. */
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** True if the overlay changes over time (animated). */
  hasActiveGesture?(): boolean;
  /** Modes: asked to finish (commit) because the user switched tools. */
  onCommitRequest?(): void;
  /** Modes: asked to abort (undo, document replaced). */
  onCancelRequest?(): void;
}
