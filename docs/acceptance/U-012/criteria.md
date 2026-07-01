# Held-out acceptance — U-012 App shell: layout, menus, shortcuts, command palette

> Authoritative. Builder must NOT edit.

## Machine-checkable (Playwright)
- Command palette (Ctrl/Cmd+K) opens, fuzzy-searches, and running a command (e.g.
  "Export PNG") triggers the same action as the menu item.
- A representative shortcut set fires the right command: B/E/G/L/U/I/M/V tool
  selects; Ctrl+Z / Ctrl+Shift+Z undo/redo; Ctrl+S save; +/- zoom; Space pan.
- Menus File/Edit/View/Canvas/Help each open and every item invokes a wired command
  (no dead menu items).
- First run shows the Welcome / New Canvas onboarding; Help, Settings, and Gallery
  overlays open and close.

## Manual / review (QA)
- Full workbench layout present: menu bar, left tool rack, center anvil (canvas
  well), right dockable panels (Color/Palette, Layers, Frames), bottom status bar
  (coords/color/zoom/size/tool).
- Responsive/touch: pinch-zoom, two-finger pan, and panels-as-bottom-sheets on small
  screens (scope per intake Q2).
- Everything reachable by keyboard; focus order sane; visible Spark focus ring.
