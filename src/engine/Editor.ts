import { Emitter, Store } from './store';
import { createGL, type GLCaps } from './gl/context';
import { GPU } from './gl/gpu';
import { SurfaceStore } from './surfaces/SurfaceStore';
import { Compositor } from './render/Compositor';
import { ViewRenderer, type PlacedCoverage } from './render/ViewRenderer';
import { ThumbnailRenderer } from './render/Thumbnails';
import { ViewController } from './view/ViewController';
import { ToolManager } from './tools/ToolManager';
import { HandTool } from './tools/HandTool';
import { ZoomTool } from './tools/ZoomTool';
import { MoveTool } from './tools/MoveTool';
import { CropTool } from './tools/CropTool';
import { TransformTool } from './tools/TransformTool';
import { BrushTool, EyedropperTool } from './tools/BrushTool';
import { LassoTool, MagicWandTool, MarqueeTool, PolygonLassoTool } from './tools/SelectionTools';
import type { ToolId } from './tools/types';
import { History, type HistorySnapshot, type PixelPatch } from './history/History';
import { diffDocs } from './doc/diff';
import { collectDocSurfaces, findLayer, walkLayers } from './doc/layerTree';
import { createDocState, createPixelLayer } from './doc/factory';
import type { DocState, Layer, RGB, Selection, SurfaceId, TextLayer } from './doc/types';
import type { ClipboardContent } from './actions/clipboardActions';
import { DEFAULT_TOOL_OPTIONS, type Interaction, type ToolOptions } from './tools/options';
import { translateRect, type Point, type Rect } from './geometry';
import { addLayer } from './ops/layerOps';
import { baseName, decodeImage, downscaleBitmap, ImageDecodeError } from './io/decode';
import { PASTEBOARD_RGB, CHECKER_A_RGB, CHECKER_B_RGB } from '../ui/themeColors';

export type DialogState =
  | { kind: 'newDocument' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel?: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | { kind: 'about' }
  | { kind: 'shortcuts' }
  | { kind: 'imageSize' }
  | { kind: 'canvasSize' }
  | { kind: 'feather' };

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  detail?: string;
}

export interface EditorState {
  doc: DocState | null;
  tool: ToolId;
  zoom: number;
  showRulers: boolean;
  showPixelGrid: boolean;
  dialog: DialogState | null;
  notices: Notice[];
  /** Non-null while a long operation runs (shown in the status bar). */
  busy: string | null;
  history: HistorySnapshot;
  /** Unsaved changes since the last save/open. */
  modified: boolean;
  /** Set when the editor can no longer operate (e.g. GPU context lost). */
  fatalError: string | null;
  foreground: RGB;
  background: RGB;
  toolOptions: ToolOptions;
  /** Numeric state of a modal interaction (Free Transform, Crop) for the options bar. */
  interaction: Interaction;
  /** How the active layer's mask is visualised in the viewport. */
  maskView: 'off' | 'grayscale' | 'overlay';
}

export interface EditorEvents extends Record<string, unknown> {
  cursor: Point | null;
  surfaceChanged: SurfaceId;
  frame: undefined;
}

export type BackgroundFill = 'white' | 'black' | 'transparent' | { color: RGB };

export interface NewDocumentOptions {
  name: string;
  width: number;
  height: number;
  resolution: number;
  background: BackgroundFill;
}

/** Continuous edit (drag, stroke, slider scrub) recorded as one history entry. */
export class Transaction {
  private readonly patches: PixelPatch[] = [];
  private finished = false;

  constructor(
    private readonly editor: Editor,
    readonly base: DocState,
  ) {}

  get isOpen(): boolean {
    return !this.finished;
  }

  /** Applies a document change without recording history (yet). */
  update(fn: (doc: DocState) => DocState): void {
    if (this.finished) return;
    const doc = this.editor.doc;
    if (!doc) return;
    const next = fn(doc);
    if (next !== doc) this.editor.replaceDoc(next);
  }

  addPatch(patch: PixelPatch): void {
    this.patches.push(patch);
  }

  commit(label: string, mergeKey?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.editor.endTransaction(this);
    const after = this.editor.doc;
    if (!after || (after === this.base && this.patches.length === 0)) return;
    this.editor.history.push({ label, before: this.base, after, patches: this.patches, mergeKey });
    this.editor.markModified();
  }

  /** Reverts document changes made through this transaction. */
  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    this.editor.endTransaction(this);
    this.editor.replaceDoc(this.base);
  }
}

let noticeId = 0;

/** GPU memory allowed for layer/mask surfaces before history-only ones are evicted. */
const GPU_SURFACE_BUDGET = 1024 * 1024 * 1024;

/**
 * Composition root of the editing engine. Owns the WebGL context and every engine
 * subsystem; React talks to it through `store` (state) and methods (commands).
 */
export class Editor {
  readonly store: Store<EditorState>;
  readonly events = new Emitter<EditorEvents>();
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly caps: GLCaps;
  readonly gpu: GPU;
  readonly surfaces: SurfaceStore;
  readonly compositor: Compositor;
  readonly viewRenderer: ViewRenderer;
  readonly thumbnails: ThumbnailRenderer;
  readonly view = new ViewController();
  readonly tools: ToolManager;
  readonly history: History;
  readonly transformTool: TransformTool;

  private frameHandle = 0;
  private overlayDirty = true;
  private antsTimer = 0;
  private antsPhase = 0;
  private lastDoc: DocState | null = null;
  private transaction: Transaction | null = null;
  private readonly pinnedSurfaces = new Set<SurfaceId>();
  /** Pixels copied with Copy/Cut (kept alive while referenced). */
  clipboard: ClipboardContent | null = null;
  /** Selection before the last Deselect, for Reselect. */
  lastSelection: Selection | null = null;
  /** Bounds of a text layer's rendered raster (provided by the text engine). */
  textBounds: ((layer: TextLayer) => Rect | null) | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-gl';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'viewport-overlay';
    const { gl, caps } = createGL(this.canvas);
    this.caps = caps;
    this.gpu = new GPU(gl, caps);
    this.surfaces = new SurfaceStore(gl, caps.maxDocumentSize);
    this.compositor = new Compositor(this.gpu, this.surfaces);
    this.viewRenderer = new ViewRenderer(this.gpu);
    this.thumbnails = new ThumbnailRenderer(this.gpu);

    this.history = new History({
      read: (id, rect) => this.surfaces.read(id, rect),
      write: (id, rect, data) => this.surfaces.write(id, rect, data),
      has: (id) => this.surfaces.has(id),
      bytesPerPixel: (id) => (this.surfaces.tryGet(id)?.format === 'r8' ? 1 : 4),
    });

    this.store = new Store<EditorState>({
      doc: null,
      tool: 'move',
      zoom: 1,
      showRulers: true,
      showPixelGrid: true,
      dialog: null,
      notices: [],
      busy: null,
      history: this.history.snapshot(),
      modified: false,
      fatalError: null,
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
      toolOptions: DEFAULT_TOOL_OPTIONS,
      interaction: null,
      maskView: 'off',
    });
    this.history.onChange = () => {
      this.store.set({ history: this.history.snapshot() });
      this.collectGarbage();
    };

    this.tools = new ToolManager(this);
    this.tools.register(new MoveTool(this));
    this.tools.register(new MarqueeTool(this, 'marqueeRect'));
    this.tools.register(new MarqueeTool(this, 'marqueeEllipse'));
    this.tools.register(new LassoTool(this));
    this.tools.register(new PolygonLassoTool(this));
    this.tools.register(new MagicWandTool(this));
    this.tools.register(new CropTool(this));
    this.tools.register(new EyedropperTool(this));
    this.tools.register(new BrushTool(this, 'brush'));
    this.tools.register(new BrushTool(this, 'eraser'));
    this.tools.register(new HandTool(this));
    this.tools.register(new ZoomTool(this));
    this.transformTool = new TransformTool(this);

    this.store.subscribe(() => this.onStateChange());
    this.view.events.on('change', (t) => {
      if (this.store.get().zoom !== t.zoom) this.store.set({ zoom: t.zoom });
      this.overlayDirty = true;
      this.requestRender();
    });
    this.view.events.on('resize', ({ width, height }) => {
      this.canvas.width = width;
      this.canvas.height = height;
      this.overlay.width = width;
      this.overlay.height = height;
      this.overlayDirty = true;
      this.requestRender();
    });
    this.surfaces.onChange((id, rect) => this.onSurfaceChanged(id, rect));

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.frameHandle);
      this.store.set({
        fatalError:
          'The graphics (WebGL) context was lost, usually because of a GPU driver reset or memory ' +
          'pressure. Pixel data held on the GPU cannot be recovered. Reload the page to continue; ' +
          'projects saved to the browser are unaffected.',
      });
    });
  }

  get doc(): DocState | null {
    return this.store.get().doc;
  }

  // ---------------------------------------------------------------- rendering

  requestRender(): void {
    if (this.frameHandle || this.store.get().fatalError) return;
    this.frameHandle = requestAnimationFrame(() => this.renderFrame());
  }

  requestOverlay(): void {
    this.overlayDirty = true;
    this.requestRender();
  }

  /** Renders synchronously (tests and export paths that need an up-to-date composite). */
  flush(): void {
    const doc = this.doc;
    this.compositor.update(doc);
  }

  private renderFrame(): void {
    this.frameHandle = 0;
    const gl = this.gpu.gl;
    if (gl.isContextLost()) return;
    const doc = this.doc;
    this.compositor.update(doc);
    const composite = this.compositor.compositeTarget;
    this.viewRenderer.render(
      this.view.width,
      this.view.height,
      this.view.transform,
      doc && composite ? { texture: composite.texture, width: doc.width, height: doc.height } : null,
      {
        pasteboard: PASTEBOARD_RGB,
        checkA: CHECKER_A_RGB,
        checkB: CHECKER_B_RGB,
        checkSize: Math.round(8 * this.view.dpr),
        pixelGrid: this.store.get().showPixelGrid,
        selection: this.selectionCoverageForView(),
        maskView: this.maskViewForView(),
        antsPhase: this.antsPhase,
        dpr: this.view.dpr,
      },
    );
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.drawOverlay();
    }
    this.events.emit('frame', undefined);
    if (this.tools.active.hasActiveGesture?.()) this.overlayDirty = true;
  }

  private selectionCoverageForView(): PlacedCoverage | null {
    const sel = this.doc?.selection;
    const s = sel ? this.surfaces.tryGet(sel.surfaceId) : undefined;
    if (!sel || !s) return null;
    return {
      texture: this.surfaces.texture(sel.surfaceId),
      x: sel.x,
      y: sel.y,
      width: s.width,
      height: s.height,
      defaultValue: sel.defaultValue / 255,
    };
  }

  private maskViewForView(): { mode: 'grayscale' | 'overlay'; mask: PlacedCoverage } | null {
    const mode = this.store.get().maskView;
    const doc = this.doc;
    if (mode === 'off' || !doc) return null;
    const layer = findLayer(doc.layers, doc.activeLayerId);
    const mask = layer?.mask;
    const s = mask ? this.surfaces.tryGet(mask.surfaceId) : undefined;
    if (!mask || !s) return null;
    return {
      mode,
      mask: {
        texture: this.surfaces.texture(mask.surfaceId),
        x: mask.x,
        y: mask.y,
        width: s.width,
        height: s.height,
        defaultValue: mask.defaultValue / 255,
      },
    };
  }

  /** Animates marching ants while a selection exists. */
  private updateAntsTimer(): void {
    const has = Boolean(this.doc?.selection);
    if (has && !this.antsTimer) {
      this.antsTimer = window.setInterval(() => {
        this.antsPhase = (this.antsPhase + 1) % 2;
        this.requestRender();
      }, 180);
    } else if (!has && this.antsTimer) {
      clearInterval(this.antsTimer);
      this.antsTimer = 0;
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const doc = this.doc;
    if (!doc) return;
    // Hairline document border so the canvas edge is visible on any content.
    const { zoom, panX, panY } = this.view.transform;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(panX) - 0.5, Math.round(panY) - 0.5, Math.round(doc.width * zoom) + 1, Math.round(doc.height * zoom) + 1);
    this.tools.drawOverlay(ctx);
  }

  // ---------------------------------------------------------- document state

  private boundsOf = (layer: Layer): Rect | 'full' => {
    if (layer.type === 'pixel') {
      const s = this.surfaces.tryGet(layer.surfaceId);
      return s ? { x: layer.x, y: layer.y, width: s.width, height: s.height } : { x: 0, y: 0, width: 0, height: 0 };
    }
    return 'full';
  };

  private onStateChange(): void {
    const doc = this.store.get().doc;
    if (doc === this.lastDoc) return;
    const prev = this.lastDoc;
    this.lastDoc = doc;
    const region = diffDocs(prev, doc, this.boundsOf);
    if (region === 'full') this.compositor.invalidate();
    else if (region) this.compositor.invalidate(region);
    if (!doc) {
      this.view.setDocumentSize(0, 0);
    } else if (!prev || prev.width !== doc.width || prev.height !== doc.height) {
      this.view.setDocumentSize(doc.width, doc.height);
    }
    this.overlayDirty = true;
    this.updateAntsTimer();
    this.requestRender();
  }

  private onSurfaceChanged(id: SurfaceId, rect: Rect | null): void {
    const doc = this.doc;
    this.events.emit('surfaceChanged', id);
    if (!doc) return;
    walkLayers(doc.layers, (layer) => {
      if (layer.type === 'pixel' && layer.surfaceId === id) {
        const s = this.surfaces.get(id);
        this.compositor.invalidate(
          rect ? translateRect(rect, layer.x, layer.y) : { x: layer.x, y: layer.y, width: s.width, height: s.height },
        );
      }
      if (layer.mask?.surfaceId === id) {
        const s = this.surfaces.get(id);
        this.compositor.invalidate(
          rect
            ? translateRect(rect, layer.mask.x, layer.mask.y)
            : { x: layer.mask.x, y: layer.mask.y, width: s.width, height: s.height },
        );
      }
    });
    this.requestRender();
  }

  /** Sets the document without recording history (used by transactions and undo). */
  replaceDoc(doc: DocState | null): void {
    this.store.set({ doc });
  }

  /** Records a single-step edit. Returns false if the document did not change. */
  commit(label: string, fn: (doc: DocState) => DocState, mergeKey?: string): boolean {
    const doc = this.doc;
    if (!doc || this.transaction) return false;
    const next = fn(doc);
    if (next === doc) return false;
    this.replaceDoc(next);
    this.history.push({ label, before: doc, after: next, patches: [], mergeKey });
    this.markModified();
    return true;
  }

  /** Changes that should not create history entries (layer selection, panel state). */
  updateDocSilently(fn: (doc: DocState) => DocState): void {
    const doc = this.doc;
    if (!doc) return;
    const next = fn(doc);
    if (next !== doc) this.replaceDoc(next);
  }

  beginTransaction(): Transaction | null {
    const doc = this.doc;
    if (!doc) return null;
    if (this.transaction) this.transaction.cancel();
    this.transaction = new Transaction(this, doc);
    return this.transaction;
  }

  /** @internal called by Transaction */
  endTransaction(tx: Transaction): void {
    if (this.transaction === tx) this.transaction = null;
  }

  get hasOpenTransaction(): boolean {
    return this.transaction !== null;
  }

  markModified(): void {
    if (!this.store.get().modified) this.store.set({ modified: true });
  }

  /** Aborts a modal interaction (Free Transform) without applying it. */
  cancelMode(): void {
    this.tools.activeMode?.onCancelRequest?.();
  }

  async undo(): Promise<void> {
    this.tools.cancelGesture();
    if (this.tools.activeMode) {
      this.cancelMode();
      return;
    }
    if (this.transaction) return;
    await this.history.undo((doc) => this.replaceDoc(doc));
    this.markModified();
  }

  async redo(): Promise<void> {
    this.tools.cancelGesture();
    this.cancelMode();
    if (this.transaction) return;
    await this.history.redo((doc) => this.replaceDoc(doc));
    this.markModified();
  }

  async goToHistory(position: number): Promise<void> {
    this.tools.cancelGesture();
    this.cancelMode();
    if (this.transaction) return;
    await this.history.goTo(position, (doc) => this.replaceDoc(doc));
    this.markModified();
  }

  /** Keeps a surface alive even when no document/history state references it. */
  pinSurface(id: SurfaceId): void {
    this.pinnedSurfaces.add(id);
  }

  unpinSurface(id: SurfaceId): void {
    this.pinnedSurfaces.delete(id);
  }

  /** Frees surfaces no longer reachable from the document, history or pins. */
  collectGarbage(): void {
    if (this.transaction) return;
    const live = new Set<SurfaceId>(this.pinnedSurfaces);
    const doc = this.doc;
    if (doc) collectDocSurfaces(doc, live);
    if (this.lastSelection) live.add(this.lastSelection.surfaceId);
    this.history.referencedSurfaces(live);
    this.surfaces.collectGarbage(live);
    void this.evictHistorySurfaces();
  }

  private evicting = false;

  /**
   * Moves surfaces referenced only by history (not by the current document) from the
   * GPU to CPU memory, least recently used first, while GPU usage exceeds the budget.
   * Undo re-uploads them on demand.
   */
  private async evictHistorySurfaces(): Promise<void> {
    if (this.evicting) return;
    const budget = GPU_SURFACE_BUDGET;
    if (this.surfaces.gpuBytes() <= budget) return;
    this.evicting = true;
    try {
      for (const s of this.surfaces.lruOrder()) {
        if (this.surfaces.gpuBytes() <= budget) break;
        const doc = this.doc;
        const inUse = new Set<SurfaceId>(this.pinnedSurfaces);
        if (doc) collectDocSurfaces(doc, inUse);
        if (!s.target || inUse.has(s.id)) continue;
        await this.surfaces.evict(s.id);
      }
    } catch (err) {
      console.warn('Surface eviction failed', err);
    } finally {
      this.evicting = false;
    }
  }

  // ------------------------------------------------------ document lifecycle

  /** Installs a brand-new document, resetting history and fitting the view. */
  private installDocument(doc: DocState, baseLabel: string): void {
    this.tools.cancelGesture();
    this.cancelMode();
    this.transaction?.cancel();
    this.replaceDoc(doc);
    this.history.reset(baseLabel);
    this.store.set({ modified: false });
    this.view.setDocumentSize(doc.width, doc.height);
    this.view.fitNoUpscale();
    this.collectGarbage();
    this.requestRender();
  }

  /** Asks before discarding unsaved work. Resolves true if it is OK to proceed. */
  async confirmDiscard(action: string): Promise<boolean> {
    const state = this.store.get();
    if (!state.doc || !state.modified) return true;
    return this.confirm({
      title: 'Discard unsaved changes?',
      message: `“${state.doc.name}” has unsaved changes that will be lost if you ${action}.`,
      confirmLabel: 'Discard changes',
      danger: true,
    });
  }

  newDocument(opts: NewDocumentOptions): void {
    const max = this.caps.maxDocumentSize;
    if (opts.width > max || opts.height > max) {
      this.notify('error', `Documents are limited to ${max} × ${max} pixels on this GPU.`);
      return;
    }
    const fill =
      opts.background === 'white'
        ? [1, 1, 1, 1]
        : opts.background === 'black'
          ? [0, 0, 0, 1]
          : opts.background === 'transparent'
            ? [0, 0, 0, 0]
            : [opts.background.color.r / 255, opts.background.color.g / 255, opts.background.color.b / 255, 1];
    const surface = this.surfaces.createBlank(opts.width, opts.height, 'rgba8', fill);
    const layer = createPixelLayer({
      name: opts.background === 'transparent' ? 'Layer 1' : 'Background',
      surfaceId: surface.id,
    });
    const doc = createDocState({
      name: opts.name || 'Untitled',
      width: opts.width,
      height: opts.height,
      resolution: opts.resolution,
      layers: [layer],
    });
    this.installDocument(doc, 'New Document');
  }

  /** Opens a decoded image as a new document with a single layer. */
  openImage(bitmap: ImageBitmap | ImageData | HTMLCanvasElement, name: string): void {
    const surface = this.surfaces.createFromImage(bitmap);
    const layer = createPixelLayer({ name: 'Background', surfaceId: surface.id });
    const doc = createDocState({ name, width: surface.width, height: surface.height, layers: [layer] });
    this.installDocument(doc, 'Open');
  }

  /** Adds a decoded image as a new layer centred on the canvas. */
  placeImage(bitmap: ImageBitmap | ImageData | HTMLCanvasElement, name: string): void {
    const doc = this.doc;
    if (!doc) {
      this.openImage(bitmap, name);
      return;
    }
    const surface = this.surfaces.createFromImage(bitmap);
    const layer = createPixelLayer({
      name,
      surfaceId: surface.id,
      x: Math.round((doc.width - surface.width) / 2),
      y: Math.round((doc.height - surface.height) / 2),
    });
    this.commit(`Place “${name}”`, (d) => addLayer(d, layer));
  }

  /** Decodes and imports files. 'auto' opens the first file if no document is open. */
  async importFiles(files: readonly File[], mode: 'auto' | 'open' | 'place' = 'auto'): Promise<void> {
    if (files.length === 0) return;
    if (mode === 'open' && !(await this.confirmDiscard('open another image'))) return;
    this.store.set({ busy: files.length > 1 ? `Importing ${files.length} images…` : 'Importing image…' });
    let placeNext = mode === 'place' || (mode === 'auto' && this.doc !== null);
    try {
      for (const file of files) {
        try {
          let bitmap = await decodeImage(file);
          const max = this.caps.maxDocumentSize;
          if (bitmap.width > max || bitmap.height > max) {
            const s = Math.min(max / bitmap.width, max / bitmap.height);
            const ok = await this.confirm({
              title: 'Image too large for this GPU',
              message:
                `“${file.name}” is ${bitmap.width} × ${bitmap.height} px. This graphics device supports ` +
                `at most ${max} px per side. Downscale it to ${Math.floor(bitmap.width * s)} × ` +
                `${Math.floor(bitmap.height * s)} px to continue?`,
              confirmLabel: 'Downscale',
            });
            if (!ok) {
              bitmap.close();
              continue;
            }
            bitmap = await downscaleBitmap(bitmap, max);
          }
          const name = baseName(file.name);
          if (placeNext) this.placeImage(bitmap, name);
          else this.openImage(bitmap, name);
          bitmap.close();
          placeNext = true;
        } catch (err) {
          const message = err instanceof ImageDecodeError ? err.message : `Could not import “${file.name}”.`;
          this.notify('error', message, err instanceof ImageDecodeError ? undefined : String(err));
        }
      }
    } finally {
      this.store.set({ busy: null });
    }
  }

  async closeDocument(): Promise<void> {
    if (!(await this.confirmDiscard('close the document'))) return;
    this.tools.cancelGesture();
    this.cancelMode();
    this.transaction?.cancel();
    this.replaceDoc(null);
    this.history.reset('Open');
    this.store.set({ modified: false });
    this.collectGarbage();
  }

  // ------------------------------------------------------------ inspection

  /**
   * Reads premultiplied RGBA pixels of the current document composite (flushes pending
   * compositing first). Used by automated tests and scripting.
   */
  readComposite(rect: Rect): Uint8Array {
    this.flush();
    const target = this.compositor.compositeTarget;
    if (!target) return new Uint8Array(0);
    const gl = this.gpu.gl;
    const out = new Uint8Array(rect.width * rect.height * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.readPixels(rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  }

  // ---------------------------------------------------------------- UI hooks

  setTool(id: ToolId): void {
    this.tools.setTool(id);
  }

  setCursorPosition(p: Point | null): void {
    this.events.emit('cursor', p);
  }

  notify(kind: Notice['kind'], message: string, detail?: string): void {
    const notice: Notice = { id: ++noticeId, kind, message, detail };
    this.store.set((s) => ({ notices: [...s.notices.slice(-4), notice] }));
    if (kind !== 'error') setTimeout(() => this.dismissNotice(notice.id), 4000);
  }

  dismissNotice(id: number): void {
    this.store.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  }

  openDialog(dialog: DialogState): void {
    this.store.set({ dialog });
  }

  closeDialog(): void {
    this.store.set({ dialog: null });
  }

  confirm(opts: { title: string; message: string; confirmLabel: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      const prev = this.store.get().dialog;
      if (prev?.kind === 'confirm') prev.resolve(false);
      this.store.set({
        dialog: {
          kind: 'confirm',
          ...opts,
          resolve: (ok) => {
            this.store.set({ dialog: null });
            resolve(ok);
          },
        },
      });
    });
  }

  /** Updates options of one tool, e.g. setToolOptions('crop', { ratio: '1:1' }). */
  setToolOptions<K extends keyof ToolOptions>(tool: K, patch: Partial<ToolOptions[K]>): void {
    this.store.set((s) => ({ toolOptions: { ...s.toolOptions, [tool]: { ...s.toolOptions[tool], ...patch } } }));
  }

  setColors(colors: { foreground?: RGB; background?: RGB }): void {
    this.store.set(colors);
  }

  swapColors(): void {
    const { foreground, background } = this.store.get();
    this.store.set({ foreground: background, background: foreground });
  }

  resetColors(): void {
    this.store.set({ foreground: { r: 0, g: 0, b: 0 }, background: { r: 255, g: 255, b: 255 } });
  }
}
