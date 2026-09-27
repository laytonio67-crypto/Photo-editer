# Emulsion

A layer-based photo editor that runs entirely in the browser. Compositing, adjustments
and painting run on the GPU through a custom WebGL 2 engine; nothing is uploaded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the rendering architecture, data
model and history design.

## Features so far

* Documents: new/open/place (PNG, JPEG, WebP; dialog, drag & drop, paste), zoom, pan,
  fit, rulers, pixel grid, high-DPI rendering.
* Layers: pixel layers, nested groups (pass-through or isolated), 27 blend modes,
  opacity, locks, masks, clipping masks, thumbnails, drag-to-reorder, merge/flatten.
* Transforms: move, free transform (scale/rotate with numeric entry), flip, rotate,
  crop, image and canvas size.
* Selections: rectangle, ellipse, lasso, polygonal lasso, magic wand; add/subtract/
  intersect, invert, feather; cut/copy/paste.
* Painting: brush and eraser with size, hardness, opacity, flow, smoothing and pressure.
* Non-destructive adjustment layers (Adjust menu, layers panel): Brightness/Contrast,
  Levels, Curves, Exposure, Shadows/Highlights, Vibrance, Hue/Saturation, White Balance,
  Black & White; live Gaussian Blur and Sharpen filters (Filter menu). Levels and Curves
  show the histogram of the image below; a Histogram panel shows composite statistics.
* Deep undo/redo (bounded by a memory budget) with a History panel.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright, real WebGL)
npm run typecheck
npm run lint
npm run build
```

Requirements: a browser with WebGL 2 (current Chrome, Edge, Firefox, Safari).
