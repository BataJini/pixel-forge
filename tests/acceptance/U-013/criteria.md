# Held-out acceptance — U-013 A11y + performance + PWA/offline + final polish

> Authoritative. Builder must NOT edit. Also runs the global acceptance (§8).

## Machine-checkable
- Axe (or equivalent) reports no serious/critical violations on the editor and each
  overlay (Gallery/Help/Settings/Export dialogs).
- Keyboard-only E2E (Playwright): draw a pixel, switch tools, add a layer, and open
  an export dialog without using the mouse.
- Production build passes performance budgets: initial JS < 250KB gz (excl. fonts);
  Lighthouse (or measured) LCP < 2.5s, CLS < 0.1; a scripted draw interaction stays
  within INP < 200ms.
- Offline: after first load, going offline (or a fresh SW-cached load) still boots
  and lets the user draw and export (no failed network requests to third parties).
- PWA manifest + service worker present; app is installable.

## Global acceptance (master-spec §8) — all must be green
1. Fresh load → draw within 5s, no post-load network.
2. Every tool pixel-correct with working undo/redo.
3. Layers + frames + onion skin + playback function without data loss.
4. Palettes: exact built-ins, import, fg/bg, indexed palette-swap.
5. Exports correct: PNG (dims/nearest-neighbor), SVG (crisp/rebuilds), GIF (valid
   animated, right frame count), spritesheet PNG+JSON, `.forge` lossless round-trip.
6. Save→reload restores exactly; gallery CRUD works.
7. WCAG 2.2 AA keyboard-only flows; focus visible; reduced-motion honored; contrast
   passes.
8. Performance budgets met; visual output matches design-direction.md (Forge, not
   generic) — Reviewer confirms no templated/reused look.
