# Emulsion

A layer-based photo editor that runs entirely in the browser. Compositing, adjustments
and painting run on the GPU through a custom WebGL 2 engine; nothing is uploaded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the rendering architecture, data
model and history design.

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
