import type { DocState, SurfaceId } from '../doc/types';
import { collectDocSurfaces } from '../doc/layerTree';
import type { Rect } from '../geometry';

/**
 * Pixels of one surface region before an in-place edit. `after` is captured lazily
 * the first time the entry is undone (at that point the surface holds the after-state),
 * so strokes that are never undone cost a single readback.
 */
export interface PixelPatch {
  surfaceId: SurfaceId;
  rect: Rect;
  before: Promise<Uint8Array> | Uint8Array;
  after: Uint8Array | null;
}

export interface HistoryEntry {
  id: number;
  label: string;
  before: DocState;
  after: DocState;
  patches: PixelPatch[];
  timestamp: number;
  /** Consecutive entries with the same merge key (within a short window) collapse. */
  mergeKey?: string;
  /** Estimated retained bytes for patch data. */
  bytes: number;
}

/** What History needs from the pixel store (lets tests use a fake). */
export interface PatchTarget {
  read(id: SurfaceId, rect: Rect): Promise<Uint8Array>;
  write(id: SurfaceId, rect: Rect, data: Uint8Array): void;
  has(id: SurfaceId): boolean;
  bytesPerPixel(id: SurfaceId): number;
}

export interface HistoryOptions {
  maxEntries: number;
  maxBytes: number;
  mergeWindowMs: number;
}

export interface HistorySnapshot {
  labels: string[];
  /** Label of the base state (the document as opened / oldest retained state). */
  baseLabel: string;
  /** Number of entries currently applied (0 = base state). */
  index: number;
}

const DEFAULT_OPTIONS: HistoryOptions = {
  maxEntries: 500,
  maxBytes: 1024 * 1024 * 1024,
  mergeWindowMs: 1000,
};

/**
 * Linear undo/redo history of document states plus pixel patches. All undo/redo
 * operations are serialised through a promise queue because restoring pixels may need
 * asynchronous GPU readbacks.
 */
export class History {
  private entries: HistoryEntry[] = [];
  private index = 0;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private baseLabel = 'Open';
  private readonly options: HistoryOptions;
  private busy = 0;
  onChange: () => void = () => {};

  constructor(
    private readonly target: PatchTarget,
    options: Partial<HistoryOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  reset(baseLabel: string): void {
    this.entries = [];
    this.index = 0;
    this.baseLabel = baseLabel;
    this.onChange();
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length;
  }

  get isBusy(): boolean {
    return this.busy > 0;
  }

  snapshot(): HistorySnapshot {
    return { labels: this.entries.map((e) => e.label), baseLabel: this.baseLabel, index: this.index };
  }

  /** Records a completed edit. Discards any redo branch. */
  push(entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'bytes'>): void {
    this.entries.length = this.index;
    const now = Date.now();
    const last = this.entries[this.entries.length - 1];
    if (
      entry.mergeKey &&
      last &&
      last.mergeKey === entry.mergeKey &&
      last.patches.length === 0 &&
      entry.patches.length === 0 &&
      now - last.timestamp < this.options.mergeWindowMs
    ) {
      last.after = entry.after;
      last.timestamp = now;
      this.onChange();
      return;
    }
    const bytes = entry.patches.reduce(
      (sum, p) => sum + p.rect.width * p.rect.height * this.target.bytesPerPixel(p.surfaceId),
      0,
    );
    this.entries.push({ ...entry, id: this.nextId++, timestamp: now, bytes });
    this.index = this.entries.length;
    this.trim();
    this.onChange();
  }

  private totalBytes(): number {
    return this.entries.reduce((sum, e) => sum + e.bytes, 0);
  }

  /** Drops the oldest entries beyond the count/memory budget (never the newest). */
  private trim(): void {
    while (
      this.entries.length > 1 &&
      this.index > 1 &&
      (this.entries.length > this.options.maxEntries || this.totalBytes() > this.options.maxBytes)
    ) {
      const dropped = this.entries.shift()!;
      this.baseLabel = dropped.label;
      this.index--;
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Undoes the latest applied entry. `apply` installs the restored document state. */
  undo(apply: (doc: DocState) => void): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.index === 0) return false;
      const entry = this.entries[this.index - 1]!;
      this.busy++;
      try {
        // Capture every after-state first: patches may overlap.
        for (const patch of entry.patches) {
          if (!patch.after && this.target.has(patch.surfaceId)) {
            patch.after = await this.target.read(patch.surfaceId, patch.rect);
            entry.bytes += patch.after.byteLength;
          }
        }
        for (let i = entry.patches.length - 1; i >= 0; i--) {
          const patch = entry.patches[i]!;
          if (!this.target.has(patch.surfaceId)) continue;
          this.target.write(patch.surfaceId, patch.rect, await patch.before);
        }
        this.index--;
        apply(entry.before);
      } finally {
        this.busy--;
      }
      this.onChange();
      return true;
    });
  }

  redo(apply: (doc: DocState) => void): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.index >= this.entries.length) return false;
      const entry = this.entries[this.index]!;
      this.busy++;
      try {
        for (const patch of entry.patches) {
          if (!patch.after || !this.target.has(patch.surfaceId)) continue;
          this.target.write(patch.surfaceId, patch.rect, patch.after);
        }
        this.index++;
        apply(entry.after);
      } finally {
        this.busy--;
      }
      this.onChange();
      return true;
    });
  }

  /** Steps to an absolute position (0 = base state). */
  async goTo(position: number, apply: (doc: DocState) => void): Promise<void> {
    const target = Math.max(0, Math.min(position, this.entries.length));
    while (this.index > target) if (!(await this.undo(apply))) break;
    while (this.index < target) if (!(await this.redo(apply))) break;
  }

  /** Waits for queued undo/redo operations to finish. */
  idle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /** Surfaces referenced by any retained state (for garbage collection). */
  referencedSurfaces(into: Set<SurfaceId> = new Set()): Set<SurfaceId> {
    for (const e of this.entries) {
      collectDocSurfaces(e.before, into);
      collectDocSurfaces(e.after, into);
      for (const p of e.patches) into.add(p.surfaceId);
    }
    return into;
  }

  get memoryBytes(): number {
    return this.totalBytes();
  }

  get length(): number {
    return this.entries.length;
  }

  get position(): number {
    return this.index;
  }
}
