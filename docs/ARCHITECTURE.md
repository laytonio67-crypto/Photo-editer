# Emulsion — Architecture

Emulsion is a browser-based raster photo editor. Everything runs client-side:
a custom WebGL2 compositing engine, a React UI shell, Web Workers for CPU-heavy
work and IndexedDB for project storage.

## 1. Rendering architecture

### Library evaluation

| Option | Verdict |
| --- | --- |
| Konva / Fabric.js | Object-canvas libraries on Canvas 2D. Great for vector objects and transform handles, but raster painting, per-layer masks, isolated groups, adjustment layers that act on "everything below" and the full blend-mode set would be CPU code bolted on top. Too slow on 20+ MP photos and fights the object model. |
| PixiJS v8 | Solid WebGL/WebGPU sprite renderer. Its scene graph targets games; document-exact compositing (pass-through groups, masks with default colours, adjustment layers, clipping) and readback-heavy workflows would bypass most of it while paying for ~500 KB. |
| glfx.js, CamanJS | Unmaintained, filter-only. |
| Canvas 2D only | Portable, but `globalCompositeOperation` blending is premultiplied-8-bit only, non-destructive adjustments must be recomputed on the CPU for every change, and there is no way to keep 60 fps slider feedback on large photos. |
| **Custom WebGL2 engine** | **Chosen.** Full control over precision, blend math and memory; GPU does compositing, adjustments, brush dabs and filters. WebGL2 is available in every current browser (WebGPU is not yet universal and is unavailable in the headless test browser). |

No heavyweight graphics dependency is used. A small typed wrapper around WebGL2
(`src/engine/gl/`) handles programs, textures, framebuffers and a render-target pool.

### Pixel storage

* Every pixel buffer is a **surface** (`SurfaceStore`): a GPU texture with an id,
  size and format. Colour surfaces are `RGBA8` **premultiplied alpha**, masks and
  selections are single-channel `R8`.
* Premultiplied storage makes bilinear filtering, blur and "normal" compositing
  exact; blend-mode shaders un-premultiply where the formulas require it.
* Surfaces not referenced by the live document (only by history) can be evicted to
  CPU memory to bound GPU memory use.
* The document is limited to `MAX_TEXTURE_SIZE` per side (usually 8192–16384). Imports
  that exceed it are offered a downscale — never silently.

### Compositor

`Compositor.renderRegion(rect)` renders the layer tree into a region-sized render
target, bottom to top:

* **Pixel / text layers** — sampled at their integer document offset (or preview
  transform), multiplied by layer mask × opacity, blended with the layer's blend mode.
  Normal mode uses fixed-function premultiplied blending; other modes use ping-pong
  targets because shaders cannot read the framebuffer they write.
* **Groups** — isolated groups render their children into a pooled temporary target
  and blend the result; *pass-through* groups composite children directly onto the
  backdrop (mixed back by opacity × mask when needed).
* **Adjustment layers** — a shader transforms the current backdrop; the result replaces
  the backdrop colour weighted by mask × opacity through the layer's blend mode. Alpha is
  preserved, as in Photoshop. The accumulator is swapped for the adjusted copy, so
  nothing is copied back. Point operations run in one pass; Levels and Curves sample a
  256-entry RGBA16F LUT built on the CPU (cached per parameter object, LRU). The GLSL
  mirrors a CPU reference (`adjustments/math.ts`) that the browser tests compare against.
* **Neighbourhood filters** (Gaussian blur, sharpen, shadows/highlights) first blur the
  accumulator with a separable Gaussian (paired bilinear taps, edges repeat). Each filter
  declares its reach; the stack's total reach expands both the dirty rectangle and the
  region that is rendered, and only the requested part is kept — so results are
  identical across tile borders and after partial updates. A plain Normal-mode blur also
  blurs coverage (cut-out edges soften); other modes keep alpha.
* **Clipping masks** — a run of `clipped` siblings forms a group with the layer below
  (the base): the base is drawn at full strength into an isolated buffer (its mask shapes
  the clip), clipped layers are drawn source-atop (fixed-function
  `DST_ALPHA, ONE_MINUS_SRC_ALPHA` for Normal, a shader variant for other modes), and the
  result is composited with the base's opacity and blend mode. A hidden base hides the
  whole group; adjustment layers cannot be bases.

The document composite texture is updated incrementally: edits invalidate dirty
rectangles and only those regions are recomposited. Blend formulas follow the W3C
Compositing & Blending spec plus Photoshop's extra modes (linear/vivid/pin light,
hard mix, subtract, divide, darker/lighter colour, dissolve).

### View

The screen canvas is sized in **device pixels** (`ResizeObserver` with
`devicePixelContentBoxSize`), so 100 % zoom maps one document pixel to one device
pixel. The view pass draws the checkerboard (screen-space), the composite
(nearest-neighbour when magnified, trilinear mipmaps when minified), animated
marching ants computed on the GPU from the selection mask, and an optional pixel grid.
Interactive overlays (brush cursor, transform box, crop box, lasso path) are drawn on a
2D canvas above; rulers are separate 2D canvases.

## 2. Data model

The document is an **immutable tree of plain objects**; pixels are referenced by
surface id. Structural sharing makes snapshots free, which is what history uses.

```ts
DocState {
  id, width, height, name
  layers: Layer[]               // bottom → top (render order)
  activeLayerId, selectedLayerIds
  editTarget: 'content' | 'mask'
  selection: { surfaceId, bounds } | null   // R8 coverage mask, document-sized
}
Layer = PixelLayer | TextLayer | AdjustmentLayer | GroupLayer
common: id, name, visible, opacity, blendMode, locks, mask: LayerMask | null, clipped
PixelLayer      { surfaceId, x, y }                 // integer placement in document space
TextLayer       { text: TextStyle & content, transform }   // vector; raster is a cache
AdjustmentLayer { adjustment: Adjustment }          // discriminated union of parameter sets
GroupLayer      { children: Layer[], expanded }      // nests arbitrarily; blend may be passThrough
LayerMask       { surfaceId, x, y, defaultValue, enabled }
```

## 3. History

Each entry stores `{ label, before: DocState, after: DocState, patches[] }`.

* **Structural edits** (layer ops, parameters, moves) cost only the snapshot.
* **In-place pixel edits** (strokes, fills, mask painting) record *pixel patches*: the
  dirty rectangle of the surface before the edit, read back asynchronously through
  pixel-buffer objects so the UI never stalls. The "after" pixels are captured lazily on
  the first undo (at that moment the surface is in the after-state), so strokes that are
  never undone cost one readback.
* **Size-changing edits** (transform commit, crop with pixel deletion, resampling) create
  new surfaces; the old ones stay alive while any history state references them.
* A memory budget and entry cap evict the oldest entries; surfaces no longer reachable from
  the document or any history state are freed (mark & sweep over DocStates).

## 4. Interaction

* `Editor` (non-React) owns the GL context, surfaces, compositor, view, history and tool
  controllers. React subscribes to a small external store via `useSyncExternalStore`
  with selectors, so pointer moves and zooming never re-render panels.
* Tools implement a `Tool` interface (pointer down/move/up, key handling, overlay
  drawing, cursor). Temporary tools (Space → Hand, middle-button pan) are handled by the
  tool manager.
* Brush engine (`StrokeTool`): input smoothing → spline interpolation → spacing-based dab
  placement with pressure. Dabs are rendered on the GPU into a stroke coverage buffer
  using flow build-up; the stroke is composited live at `coverage × opacity` into a
  preview that the compositor shows instead of the layer, and merged into the target
  surface on pointer-up as one undo step (Photoshop opacity/flow semantics). Brush,
  eraser, mask painting, clone stamp and healing brush are subclasses that only differ in
  how a stroke is prepared and finished.
* Clone stamp: Alt-click sets the source; strokes sample the untouched layer surface (or
  a snapshot of the composite for "all layers") at a whole-pixel offset, aligned across
  strokes or restarting at the source.
* Healing brush: on release the cloned patch is corrected by a membrane `m` with Δm = 0
  inside the stroke and `m = dst − src` on its border (Poisson/seamless cloning). The
  solve runs on the GPU in half-float targets: boundary values are averaged into a
  pyramid, the coarsest level is relaxed first, and each finer level starts from the
  upsampled solution and is refined with red-black over-relaxation.

### Text

Text layers store only the vector description (content, font, size, weight, italic,
colour, alignment, line height, tracking, position, rotation, scale). `TextRenderer`
lays lines out with CSS line-box metrics (half-leading around the font's ascent and
descent) and rasterises them with Canvas 2D directly at their final transform, so glyphs
stay sharp after scaling or rotation; rasters are caches keyed by every input and
pruned with the document. The Text tool edits in place: a transparent textarea with the
same font metrics is CSS-transformed onto the rendered glyphs, so the browser supplies
caret, selection, IME and keyboard editing while the engine renders the text. An
editing session is one transaction and one history entry. Free Transform folds into
the layer's rotation/scale; Rasterize converts a text layer into pixels.

### Export

The composite is (optionally) resized on the GPU with edge clamping, read back through
a PBO, un-premultiplied or flattened onto a matte, and encoded in a worker. PNG uses our
own encoder (adaptive row filters + zlib via `CompressionStream`, sRGB and pHYs chunks),
so exports are bit-exact and keep the document resolution; JPEG and WebP use the
browser's encoders (the JPEG's JFIF density is patched to the document resolution). The
dialog shows the real encoded size before exporting.

### Histograms

`HistogramService` measures either the composite or an adjustment layer's input (the
tree with that layer and everything above it removed, rendered tile by tile). Tiles are
point-sampled on a grid aligned to the document (at most 2²⁰ samples; averaging would
narrow the distribution), read back asynchronously through a PBO, and binned in a
worker. The Levels and Curves editors recompute only when something below the layer
changes, not when their own parameters do.

## 5. Workers & persistence

* Workers: histogram binning, magic-wand flood fill, export encoding, project
  compression/decompression.
* IndexedDB database `emulsion` with three stores: `projects` (listing metadata and a
  PNG thumbnail), `documents` (the DocState: layer tree, parameters, text, adjustments,
  selection reference) and `surfaces` (pixels keyed by `[projectId, surfaceId]`).
  Surfaces are stored exactly as the GPU holds them (premultiplied RGBA8 or R8), with
  PNG-style adaptive row filters and raw deflate — a bit-exact round trip without
  colour conversion. Everything for one save is written in one transaction.
* Saves are incremental: the store remembers which surface versions it wrote, so a save
  only re-encodes surfaces that changed (a property edit writes no pixels) and deletes
  records no longer referenced. Opening validates the stored document (format version,
  structure, presence of every surface) and keeps surface ids so later saves stay
  incremental.

## 6. Phases

1. Shell, WebGL engine, viewport (zoom/pan/fit/rulers/checkerboard/high-DPI), import
   (dialog, drag & drop, paste), basic layers.
2. Layer operations, groups, thumbnails, transforms (move, free transform, flip, rotate,
   crop, numeric), opacity, blend modes, history.
3. Selections (rect, ellipse, lasso, boolean modes, invert, feather, copy/paste), masks,
   brush, eraser.
4. Adjustment layers, curves & levels with histograms.
5. Text layers, clone stamp & healing, export, project persistence.

Each phase ends with unit tests (Vitest) and browser tests (Playwright) against the real
application, plus a console-error check.
