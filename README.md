# PixelForge

**Hammer pixels into sprites.**

A fast, fully client-side retro pixel-art editor for the browser. Draw in pixels,
work in layers and animation frames, and export to PNG, SVG, GIF, and spritesheet —
under a bespoke Arcade-CRT aesthetic. No accounts, no server, works offline.

### ▶ [Try it live](https://batajini.github.io/pixel-forge/)

## Features

- **Tools** — pencil, eraser, fill, line, rectangle, ellipse, eyedropper, select, move,
  pan; adjustable brush size, X/Y mirror, pixel-perfect strokes, dithering.
- **Layers** — opacity, reorder, lock, merge-down, flatten, over a live composite.
- **Animation** — frame timeline with per-frame duration, FPS, onion-skin, and playback.
- **Color & palettes** — HSV picker, fg/bg swap, classic hardware palettes (NES,
  Game Boy, PICO-8…), `.hex` / `.gpl` import, and an indexed palette-lock mode.
- **Undo / redo** — memory-efficient dirty-rectangle history.
- **Export & save** — PNG (integer scale), SVG, animated GIF, spritesheet + JSON atlas,
  and a lossless `.forge` project file; in-browser gallery.
- **Command palette** (`Ctrl/⌘+K`), full keyboard shortcuts, and a Focus/fullscreen mode.
- **PWA** — installable and works offline after first load.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173/pixel-forge/
```

Build a production bundle:

```bash
npm run build
npm run preview
```

## Tech stack

Vite · React 19 · TypeScript · Zustand · Canvas 2D · vite-plugin-pwa

## License

[MIT](LICENSE)
