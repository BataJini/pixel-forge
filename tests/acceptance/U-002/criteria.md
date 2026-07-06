# Held-out acceptance — U-002 Design system & retro UI chrome (Forge)

> Authoritative. Builder must NOT edit.

## Machine-checkable
1. A theme-token source defines the 13 named tokens for BOTH themes with the EXACT
   hexes from design-direction.md.
   - **Forge ramp:** `--c-anvil #12100E`, `--c-iron #2A2622`, `--c-iron-hi #4A423A`,
     `--c-slag #0C0A08`, `--c-ash #8A7E70`, `--c-steel #E8DFD2`, `--c-ember #FF6A1A`,
     `--c-ember-deep #C24A12`, `--c-spark #FFB03A`, `--c-flame #FFE08A`,
     `--c-quench #2FA8C4`, `--c-patina #5F9E5A`, `--c-warning #E23B2E`.
   - **Arcade CRT ramp (default):** `--c-anvil #06070C`, `--c-iron #10131E`,
     `--c-iron-hi #232A3E`, `--c-slag #020308`, `--c-ash #7C86A8`, `--c-steel #E8F0FF`,
     `--c-ember #00F0FF`, `--c-ember-deep #0090C4`, `--c-spark #FF2E88`,
     `--c-flame #FFD300`, `--c-quench #39FF14`, `--c-patina #39FF14`,
     `--c-warning #FF3B30`. A test asserts both value sets.
2. The default active theme on first load is **Arcade CRT** (assert the resolved
   `--c-ember` is `#00F0FF` before any user theme change).
3. Contrast assertions pass for the DEFAULT (CRT) ramp: `#E8F0FF` on `#06070C` ≥ 7:1;
   `#7C86A8` on `#06070C` ≥ 4.5:1; `#06070C` on `#00F0FF` ≥ 4.5:1. And for Forge:
   `#E8DFD2` on `#12100E` ≥ 7:1; `#8A7E70` on `#12100E` ≥ 4.5:1; `#12100E` on
   `#FF6A1A` ≥ 4.5:1 (computed WCAG ratios in a unit test).
4. The four fonts (Press Start 2P, Pixelify Sans, Silkscreen, VT323) are
   self-hosted `.woff2` assets in the repo (not fetched from a third-party URL).
5. Button/Panel/Slider/Dialog/Frame components exist and render without throwing
   (Vitest Browser Mode or Playwright component render).
6. The CRT layer element is a non-interactive overlay (`pointer-events: none`),
   toggles Off/Subtle/Full, and its presence does not change any content DOM pixels
   (it lives above content, not inside it).

## Manual / review (Reviewer + QA)
- Bevels use hard `box-shadow` (0 blur, 0 spread, integer `--px` offsets); pressed
  state swaps light/dark and translates by `--px`.
- No `border-radius` and no blurred shadow on chrome; no CSS soft gradients (dither
  used instead).
- Focus ring is Spark `#FFB03A`, visibly rendered, on keyboard focus.
- `prefers-reduced-motion: reduce` disables all ambient animation (CRT flicker,
  blink, sparks); reduced-sound / default-muted respected.
- CRT layer has Off/Subtle/Full and defaults to Subtle without dropping text below AA.
- Under `prefers-reduced-motion` the CRT flicker/sweep/shimmer stop (static scanlines/
  glow may remain); a one-click clean mode removes scanlines + glow entirely.
- Look matches design-direction.md (Arcade-CRT-over-Forge, not a generic/stock-kit
  retro look).
