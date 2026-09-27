import type { Editor } from '../Editor';
import { countLayers } from '../doc/layerTree';
import type { DocState, SurfaceId } from '../doc/types';
import { readPixelsAsync } from '../gl/readback';
import { resampleTexture } from '../render/Resampler';
import { createId } from '../store';
import type { CodecRequest, CodecResponse } from '../workers/project.worker';
import { prepareExportPixels } from './exportImage';
import { encodePng } from './png';
import {
  documentSurfaceIds,
  PROJECT_FORMAT_VERSION,
  ProjectFormatError,
  remapSurfaceIds,
  validateStoredDocument,
  type StoredDocument,
  type StoredSurfaceInfo,
} from './projectFormat';

/** Listing entry for a saved project. */
export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  layerCount: number;
  created: number;
  modified: number;
  /** Stored size of the pixel data in bytes (compressed). */
  bytes: number;
  thumbnail: Blob | null;
}

interface StoredSurface {
  projectId: string;
  surfaceId: SurfaceId;
  width: number;
  height: number;
  format: 'rgba8' | 'r8';
  /** Filtered + deflated pixels (see projectCodec.ts). */
  data: Uint8Array;
}

export interface SaveStats {
  written: number;
  kept: number;
  removed: number;
}

const DB_NAME = 'emulsion';
const DB_VERSION = 1;
const THUMBNAIL_SIZE = 320;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Storage request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was aborted'));
  });
}

function projectRange(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId, ''], [projectId, '￿']);
}

/** Maps storage failures to messages people can act on. */
function storageError(err: unknown): Error {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'QuotaExceededError') {
    return new Error('There is not enough browser storage for this project. Delete old projects or export the image instead.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Saves documents as projects in IndexedDB and opens them again.
 *
 * Stores: `projects` (listing metadata + thumbnail), `documents` (the layer tree and
 * parameters, i.e. the DocState), `surfaces` (compressed pixels, keyed by project and
 * surface id). Saves are incremental: surfaces whose version is unchanged since the
 * last save are not rewritten. Everything for one save is written in a single
 * transaction, so a project is never left half-saved.
 */
export class ProjectStore {
  private db: Promise<IDBDatabase> | null = null;
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: CodecResponse) => void; reject: (e: Error) => void }>();
  /** What is stored for the open project: surface versions and packed sizes. */
  private stored: { projectId: string; versions: Map<SurfaceId, number>; sizes: Map<SurfaceId, number> } | null = null;
  private busy = false;
  /** Statistics of the last save (for diagnostics and tests). */
  lastSaveStats: SaveStats | null = null;

  constructor(private readonly editor: Editor) {}

  get available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private database(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        if (!this.available) {
          reject(new Error('This browser does not provide storage for projects (IndexedDB).'));
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('surfaces')) db.createObjectStore('surfaces', { keyPath: ['projectId', 'surfaceId'] });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab upgrading the schema: let it proceed.
          db.onversionchange = () => {
            db.close();
            this.db = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('Could not open project storage'));
        req.onblocked = () => reject(new Error('Project storage is busy in another tab. Close other Emulsion tabs and try again.'));
      }).catch((err: unknown) => {
        this.db = null;
        throw err;
      });
    }
    return this.db;
  }

  private codec(req: Omit<CodecRequest, 'id'>): Promise<Uint8Array> {
    if (!this.worker) {
      const worker = new Worker(new URL('../workers/project.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<CodecResponse>) => {
        const entry = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        entry?.resolve(e.data);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        for (const entry of this.pending.values()) entry.reject(new Error(`Project worker failed: ${e.message}`));
        this.pending.clear();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      this.worker = worker;
    }
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise<CodecResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id }, [req.data.buffer]);
    }).then((r) => {
      if ('error' in r) throw new Error(r.error);
      return r.data;
    });
  }

  /** Saved projects, most recently modified first. */
  async list(): Promise<ProjectMeta[]> {
    const db = await this.database();
    const all = await request(db.transaction('projects').objectStore('projects').getAll() as IDBRequest<ProjectMeta[]>);
    return all.sort((a, b) => b.modified - a.modified);
  }

  /** Small PNG preview of the current composite. */
  private async thumbnail(doc: DocState): Promise<Blob | null> {
    const editor = this.editor;
    editor.flush();
    const composite = editor.compositor.compositeTarget;
    if (!composite) return null;
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(doc.width, doc.height));
    const w = Math.max(1, Math.round(doc.width * scale));
    const h = Math.max(1, Math.round(doc.height * scale));
    const gl = editor.gpu.gl;
    const scaled = resampleTexture(editor.gpu, composite.texture, doc.width, doc.height, w, h, 'bilinear');
    const pixels = readPixelsAsync(gl, scaled.framebuffer, { x: 0, y: 0, width: w, height: h }, { format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel: 4 });
    editor.gpu.pool.release(scaled);
    const png = await encodePng(w, h, prepareExportPixels(await pixels, true, { r: 255, g: 255, b: 255 }));
    return new Blob([png as BlobPart], { type: 'image/png' });
  }

  /**
   * Saves the open document. Without `saveAs` it updates the project the document
   * belongs to (or creates one); with `saveAs` it always creates a new project.
   */
  async save(options: { saveAs?: boolean; name?: string } = {}): Promise<ProjectMeta> {
    const editor = this.editor;
    const doc = editor.doc;
    if (!doc) throw new Error('There is no document to save.');
    if (editor.hasOpenTransaction) throw new Error('Finish the current edit (text or transform) before saving.');
    if (this.busy) throw new Error('A save or open is already in progress.');
    const current = editor.store.get().project;
    const asNew = options.saveAs || !current;
    const projectId = asNew ? createId('prj') : current!.id;
    const name = (options.name ?? current?.name ?? doc.name).trim() || 'Untitled';
    const editsAtStart = editor.editVersion;
    this.busy = true;
    editor.store.set({ busy: 'Saving project…' });
    try {
      const savedDoc: DocState = { ...doc, name };
      const ids = documentSurfaceIds(savedDoc);
      const known = !asNew && this.stored?.projectId === projectId ? this.stored : null;
      const infos: StoredSurfaceInfo[] = [];
      const versions = new Map<SurfaceId, number>();
      const reads: { info: StoredSurfaceInfo; pixels: Promise<Uint8Array> }[] = [];
      for (const id of ids) {
        const s = editor.surfaces.get(id);
        const info: StoredSurfaceInfo = { id, width: s.width, height: s.height, format: s.format };
        infos.push(info);
        versions.set(id, s.version);
        if (known && known.versions.get(id) === s.version) continue;
        // All reads are queued now, so they capture one consistent state.
        reads.push({ info, pixels: editor.surfaces.read(id) });
      }
      const thumbnail = this.thumbnail(savedDoc);

      const sizes = new Map<SurfaceId, number>();
      if (known) for (const [id, size] of known.sizes) if (ids.has(id)) sizes.set(id, size);
      const records: StoredSurface[] = [];
      for (const { info, pixels } of reads) {
        const data = await this.codec({ op: 'pack', data: await pixels, width: info.width, height: info.height, bpp: info.format === 'rgba8' ? 4 : 1 });
        records.push({ projectId, surfaceId: info.id, width: info.width, height: info.height, format: info.format, data });
        sizes.set(info.id, data.length);
      }

      const db = await this.database();
      const [existing, existingKeys] = await (async () => {
        if (asNew) return [null, [] as IDBValidKey[]] as const;
        const tx = db.transaction(['projects', 'surfaces']);
        const meta = request(tx.objectStore('projects').get(projectId) as IDBRequest<ProjectMeta | undefined>);
        const keys = request(tx.objectStore('surfaces').getAllKeys(projectRange(projectId)));
        return [(await meta) ?? null, await keys] as const;
      })();
      const now = Date.now();
      const meta: ProjectMeta = {
        id: projectId,
        name,
        width: doc.width,
        height: doc.height,
        layerCount: countLayers(doc.layers),
        created: existing?.created ?? now,
        modified: now,
        bytes: [...sizes.values()].reduce((a, b) => a + b, 0),
        thumbnail: await thumbnail,
      };
      const stale = existingKeys.filter((k) => Array.isArray(k) && !ids.has(k[1] as string));
      const stored: StoredDocument = { id: projectId, formatVersion: PROJECT_FORMAT_VERSION, doc: savedDoc, surfaces: infos };

      const tx = db.transaction(['projects', 'documents', 'surfaces'], 'readwrite');
      const done = transactionDone(tx);
      const surfaces = tx.objectStore('surfaces');
      for (const key of stale) surfaces.delete(key);
      for (const r of records) surfaces.put(r);
      tx.objectStore('documents').put(stored);
      tx.objectStore('projects').put(meta);
      await done;

      if (asNew) void navigator.storage?.persist?.().catch(() => false);
      this.stored = { projectId, versions, sizes };
      this.lastSaveStats = { written: records.length, kept: ids.size - records.length, removed: stale.length };
      editor.store.set({ project: { id: projectId, name } });
      if (editor.doc?.name !== name) editor.updateDocSilently((d) => ({ ...d, name }));
      if (editor.editVersion === editsAtStart) editor.store.set({ modified: false });
      return meta;
    } catch (err) {
      throw storageError(err);
    } finally {
      this.busy = false;
      editor.store.set({ busy: null });
    }
  }

  /** Opens a saved project, replacing the current document (the caller confirms). */
  async open(projectId: string): Promise<void> {
    const editor = this.editor;
    if (this.busy) throw new Error('A save or open is already in progress.');
    this.busy = true;
    editor.store.set({ busy: 'Opening project…' });
    const created: SurfaceId[] = [];
    try {
      const db = await this.database();
      const tx = db.transaction(['projects', 'documents', 'surfaces']);
      const metaReq = request(tx.objectStore('projects').get(projectId) as IDBRequest<ProjectMeta | undefined>);
      const docReq = request(tx.objectStore('documents').get(projectId));
      const surfReq = request(tx.objectStore('surfaces').getAll(projectRange(projectId)) as IDBRequest<StoredSurface[]>);
      const meta = await metaReq;
      if (!meta) throw new ProjectFormatError('This project no longer exists.');
      const stored = validateStoredDocument(await docReq);
      const records = new Map((await surfReq).map((r) => [r.surfaceId, r]));

      const idMap = new Map<SurfaceId, SurfaceId>();
      const versions = new Map<SurfaceId, number>();
      const sizes = new Map<SurfaceId, number>();
      for (const info of stored.surfaces) {
        const rec = records.get(info.id);
        if (!rec || rec.width !== info.width || rec.height !== info.height || rec.format !== info.format) {
          throw new ProjectFormatError('The project is missing pixel data.');
        }
        const bpp = info.format === 'rgba8' ? 4 : 1;
        let pixels: Uint8Array;
        try {
          pixels = await this.codec({ op: 'unpack', data: rec.data.slice(), width: info.width, height: info.height, bpp });
        } catch {
          throw new ProjectFormatError('The project’s pixel data is damaged.');
        }
        const surface = editor.surfaces.createFromPixels(info.width, info.height, info.format, pixels, info.id);
        created.push(surface.id);
        if (surface.id !== info.id) idMap.set(info.id, surface.id);
        versions.set(surface.id, surface.version);
        // A remapped id is stored under the old key: leave it out so it is rewritten.
        if (surface.id === info.id) sizes.set(surface.id, rec.data.length);
        else versions.delete(surface.id);
      }
      const doc = { ...remapSurfaceIds(stored.doc, idMap), name: meta.name };
      editor.openProjectDocument(doc, { id: meta.id, name: meta.name });
      this.stored = { projectId: meta.id, versions, sizes };
    } catch (err) {
      for (const id of created) editor.surfaces.delete(id);
      throw storageError(err);
    } finally {
      this.busy = false;
      editor.store.set({ busy: null });
    }
  }

  /** Deletes a project and all of its pixel data. */
  async remove(projectId: string): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(['projects', 'documents', 'surfaces'], 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore('projects').delete(projectId);
    tx.objectStore('documents').delete(projectId);
    tx.objectStore('surfaces').delete(projectRange(projectId));
    await done;
    const editor = this.editor;
    if (editor.store.get().project?.id === projectId) {
      // The open document is no longer saved anywhere.
      this.stored = null;
      editor.store.set({ project: null, modified: editor.doc !== null });
    }
  }

  /** Forgets the association when another document is opened or created. */
  detach(): void {
    this.stored = null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    void this.db?.then((db) => db.close()).catch(() => undefined);
    this.db = null;
  }
}
