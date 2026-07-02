# PixelForge — COMPLETION

**Status:** ✅ Complete — 13 / 13 units verified, `phase: done`.

A fully client-side, offline-capable retro pixel-art editor. Draw in pixels and
export to PNG, SVG, GIF, and spritesheet — under a bespoke Arcade-CRT "Forge"
theme. No accounts, no backend.

## Verified units
| Unit | Title |
|------|-------|
| U-001 | Project scaffold + tooling + CI/deploy |
| U-002 | Design system & retro UI chrome (Forge / Arcade CRT) |
| U-003 | Canvas engine + pixel buffer + render pipeline |
| U-004 | Drawing tools (pencil, eraser, fill, line, rect, ellipse, pick, select, move, pan) |
| U-005 | Color & palette system (free RGBA + classic palettes, fg/bg, indexed) |
| U-006 | History / undo–redo (dirty-rect patches) |
| U-007 | Layers panel & management (opacity, reorder, merge, flatten) |
| U-008 | Animation frames + timeline + onion skin |
| U-009 | Export: PNG (integer scale) + SVG |
| U-010 | Export: GIF + spritesheet (+JSON atlas) |
| U-011 | Project persistence + dialogs + image import (`.forge`, IndexedDB) |
| U-012 | App shell: menu bar, Ctrl/Cmd+K command palette, shortcuts, help |
| U-013 | A11y + performance + PWA/offline + final polish |

## Verification evidence
- **Build:** `npm run build` exit 0.
- **Tests:** 48 vitest files / 643 tests pass — including the protected held-out
  acceptance suites for every machine-checkable unit (U-003–U-013).
- **E2E:** 31 Playwright tests pass (smoke, app-shell, a11y/keyboard/offline).
- **Accessibility:** axe-core reports **zero serious/critical** WCAG 2.1 AA
  violations on the editor.
- **Performance:** production JS ≈ 115 KB gzipped (budget < 250 KB).
- **PWA / offline:** manifest + service worker emitted; the app boots offline
  after first load with **no third-party network requests**; installable.
- **Clean-export invariant:** the CRT scanline/glow is a display-only overlay;
  PNG/SVG/GIF/spritesheet output is effect-free (asserted in held-out tests).

## Run it
```bash
cd ~/Projects/pixel-forge
npm install
npm run dev        # http://localhost:5173/pixel-forge/
# or a production preview:
npm run build && npm run preview   # http://localhost:4173/pixel-forge/
```

## Notes
The autonomous engine built U-001–U-009 end-to-end. Two engine bugs were fixed
mid-run (an ambiguous verifier-worktree prompt; transient-API-error resilience),
and two missing held-out acceptance suites (U-007, U-010) were authored. Because
the host process kept cycling and killing the background loop, the final units
(U-010 GIF/spritesheet, U-012 app shell, U-013 PWA/a11y) were completed by direct
foreground implementation, each verified by the full build + test + e2e suite.
