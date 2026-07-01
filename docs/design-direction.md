# Design Direction — PixelForge

> Bespoke art direction, derived from THIS project's concept and built from
> scratch. The Builder implements this as the single source of visual truth —
> it overrides any global/house style. Never reuse another project's look.

## Concept

- **One-line essence:** A blacksmith's workshop for pixels — you heat raw color
  on an anvil and hammer it into sprites. The tool *is* a forge; the artwork is
  the metal.
- **Mood / adjectives:** Warm, molten, craftsman-grade, tactile, focused (not
  toy-like, not cutesy).
- **Audience & context of use:** Hobbyist and indie pixel artists, game-jam
  devs, and curious first-timers, on desktop primarily and touch secondarily,
  in focused making sessions. The UI must recede so the canvas dominates.
- **Emotional target:** Sitting at a well-worn workbench with good tools — heat,
  spark, and control. Competent and cozy, never sterile SaaS and never a
  childish 8-bit gimmick.
- **Anti-references (deliberately avoided):**
  - The generic AI-SaaS look (indigo-on-white, soft shadows, 16px rounded cards,
    Inter everywhere). Forbidden.
  - Shipping NES.css / 98.css / XP.css wholesale — the instantly-recognizable
    stock-kit Win95 grey/green with Press Start 2P slapped on. We study their
    box-shadow math but build our own tokens and palette.
  - Press Start 2P used *everywhere* at tiny unreadable sizes.
  - "Retro nostalgia cosplay": random pixel hearts/coins/stars as filler with no
    tie to the concept. Every motif here is forge-native (anvil, ember, ingot,
    spark, tongs, temperature).
  - Blurry pseudo-pixel UI: `border-radius` on chrome, blurred `box-shadow`,
    soft CSS gradients, eased cubic-bezier motion. All banned (see rules below).
  - CRT effect cranked to 11 (heavy scanlines that kill contrast, constant
    flicker, big bloom). Ours is subtle, optional, and off/subtle by default.

## Visual language (invented for this project)

The whole system obeys five laws: **hard edges, stepped tones, zero
anti-aliasing on chrome, integer offsets, one light source (top-left).**
Everything snaps to a logical pixel grid `--px` (default `2px`).

### Palette — "The Forge Ramp" (built from scratch)

A temperature metaphor: **cold iron = idle/disabled, hot ember = active/primary,
white-hot spark = focus/highlight**, on a near-black anvil ground. Genuinely
ownable and encodes state in value, not hue alone.

| Token | Name | Hex | Role |
|-------|------|-----|------|
| `--c-anvil` | Anvil | `#12100E` | App background (near-black, warm-biased) |
| `--c-iron` | Iron | `#2A2622` | Panels / raised surfaces |
| `--c-iron-hi` | Iron Light | `#4A423A` | Bevel top-left highlight |
| `--c-slag` | Slag | `#0C0A08` | Bevel bottom-right shade / hard outline |
| `--c-ash` | Ash | `#8A7E70` | Secondary/muted text (≥4.6:1 on Anvil) |
| `--c-steel` | Steel | `#E8DFD2` | Primary text (~13:1 on Anvil) |
| `--c-ember` | Ember | `#FF6A1A` | Primary accent / CTA / active tool |
| `--c-ember-deep` | Ember Deep | `#C24A12` | Pressed/active accent |
| `--c-spark` | Spark | `#FFB03A` | Focus ring / hot highlight |
| `--c-flame` | Flame | `#FFE08A` | Brightest sparks / selection glints |
| `--c-quench` | Quench | `#2FA8C4` | Cool secondary accent ("cooled metal") |
| `--c-patina` | Patina | `#5F9E5A` | Success |
| `--c-warning` | Hot Iron | `#E23B2E` | Error/destructive (redder/darker than Ember) |

Contrast rules baked in: primary text `#E8DFD2` on any surface ≥ 4.5:1; **never
set small Ember text on dark** — Ember is for button *faces*, icons, borders and
large labels, with dark `#12100E` text placed *on* Ember (~5.5:1). State is
always conveyed by shape + value, never hue alone.

**The canvas artwork is never tinted by this palette.** Chrome is Forge-warm; the
pixel canvas renders the user's true colors on a neutral checkerboard
(`#C8C8C8` / `#8F8F8F`, theme-independent).

### Palette themes (recolor the chrome, not the art)

The bespoke **Forge** workshop is the structural identity (layout, bevels,
metaphor). The **default theme on first load is Arcade CRT** (the chosen hero
vibe): neon-on-black with scanlines/glow forward. Selecting a hardware palette
(spec §7) can retheme the *whole UI* accent ramp — a signature move no competitor
nails: "Game Boy" turns the chrome olive-monochrome; "Amber Terminal" swaps the
ramp to `#1A0E05 → #5A2E0A → #C9741A → #FFB84D`; "Forge" restores the ember ramp.
All themes remain switchable at any time.

**Arcade CRT theme accent ramp (default):** neon on black —
`--c-anvil #06070C` (deep CRT black), `--c-iron #10131E` (panel),
`--c-iron-hi #232A3E` (bevel hi), `--c-slag #020308` (bevel dark/outline),
`--c-ash #7C86A8` (muted text ≥4.5:1), `--c-steel #E8F0FF` (primary text),
`--c-ember → --c-neon #00F0FF` (primary accent / active tool, "electric cyan"),
`--c-ember-deep → --c-neon-deep #0090C4` (pressed), `--c-spark #FF2E88` (focus /
hot highlight, "hot magenta"), `--c-flame #FFD300` (arcade yellow highlights),
`--c-quench #39FF14` (laser-green secondary), `--c-patina #39FF14` (success),
`--c-warning #FF3B30` (error). Same token *names* as the Forge Ramp so components
are theme-agnostic; only the values swap.

### Typography

Self-hosted `.woff2` (Fontsource), no third-party requests.

- **Display / logo / major headings:** **Press Start 2P** — only large and
  sparingly (app title, splash, dialog titles, primary buttons).
- **UI / menus / panels / mid labels:** **Pixelify Sans** (400–700) — the
  "does-everything" pixel face; weights drive hierarchy.
- **Tiny labels / tool captions / tags:** **Silkscreen** — crisp at small sizes.
- **Numeric readouts / status bar / tooltips (CRT flavor):** **VT323**.

`-webkit-font-smoothing: none` on chrome to keep bitmap glyphs crisp; font sizes
are integer multiples of each face's native EM so glyphs land on the grid.

### Layout & grid language

- Three-zone workbench: left **tool rack** (vertical bevelled tool buttons),
  center **anvil** (canvas on checkerboard, dominant), right **workbench**
  (stacked panels: Color/Palette, Layers, Frames). Top **menu/marquee** bar,
  bottom **status readout** (coords, zoom, canvas size, active tool/color).
- Everything on multiples of `--px`; no fractional spacing. Panels are
  collapsible and dockable; on mobile they become bottom sheets / a tool drawer.

### Shape / texture / depth

- **Bevels** = two light hard shadows (top-left) + two dark hard shadows
  (bottom-right), `0` blur, `0` spread, offset by whole `--px`. Outset = raised
  control; inset = recessed groove (sliders, canvas well, text inputs). Pressed =
  swap light/dark + `translate(--px,--px)`.
- **Panels** carry a hard offset drop-shadow (`2px 2px 0 #0C0A08`), never blurred.
- **Frames** use `border-image` 9-slice from a tiny hand-authored PNG (`repeat`,
  not `stretch`) or a `clip-path` notched-corner frame with a `drop-shadow`
  pixel outline. No `border-radius` on chrome.
- **Dither** for any "gradient" surface: a tiling 4×4 Bayer PNG overlay at
  `image-rendering: pixelated`, never a smooth CSS gradient.

### Iconography & imagery style

- Bespoke **16×16 (and 32×32) pixel icons**, 1px Slag outline, lit top-left,
  drawn on the same grid as the art. Tools are forge-native where natural
  (pencil = chisel/stylus, fill = molten pour, eyedropper = tongs, eraser =
  grinding block). Delivered as a single sprite sheet + `<svg>`/CSS sprite;
  crisp via `pixelated`.
- No stock illustration or photography. Hero/empty-state art is purpose-drawn
  pixel art (an anvil with a glowing sprite on it).

### Motion language — purposeful, never ambient

- **All motion uses `steps()` / integer position changes — never eased
  cubic-bezier.** Retro motion *snaps*.
- Tool select: 1px press-in + a single spark blink. Frame playback: honest frame
  swap. Blinking cursor/marquee: `steps(1)` hard on/off. Selection "marching
  ants": stepped dash offset.
- Animate compositor-friendly props only (`transform`, `opacity`, `clip-path`).
- Everything ambient (CRT flicker, sparks, marquee crawl) disabled under
  `prefers-reduced-motion`.

### CRT atmospherics (default ON, but a pure display layer)

The Arcade CRT hero vibe is expressed through a **CRT display layer** —
scanlines, ≤2px phosphor glow/bloom, optional flicker + subtle curvature/vignette.
Because CRT is the default theme, this layer is **ON at "Subtle" by default**
(scanlines + gentle glow, no flicker), with levels **Off / Subtle / Full**.

**Clean-pixel invariant (hard rule):** the CRT layer is a separate overlay/CSS
effect that composites *above* the display canvas ONLY. It must NEVER write to the
pixel buffers and must NEVER be part of any export. Scanlines, glow, bloom,
flicker, and curvature are absent from the source-of-truth buffers and from every
exported artifact (PNG, SVG, GIF, spritesheet, `.forge`) — exports are the raw,
effect-free pixels the user drew. Export code reads the composited buffer, not the
screen, so it is structurally impossible for CRT effects to leak into output.

**Accessibility for CRT:** a dedicated toggle (Off / Subtle / Full) plus a
one-click "clean mode" that removes scanlines and glow entirely. Under
`prefers-reduced-motion` all motion in the layer (flicker, sweep, chromatic
shimmer) is disabled automatically, keeping only static scanlines/glow (or the
user can turn the whole layer Off). The layer never drops text below AA; base
token contrast is measured with the layer *on* at Subtle. No full-screen flash
> 3/sec.

### Chiptune UI SFX (off by default)

- **Chiptune UI SFX** (~15-line WebAudio square/triangle blips): hover/click/
  success/error, fitting the arcade vibe. **Shipped muted by default**, one clear
  toggle, honors a reduce-sound preference, single shared AudioContext resumed on
  first gesture.

## Signature moment

**The Anvil canvas under glass + Temperature accents.** The canvas sits in a
recessed "anvil well" with a hard inner bevel, viewed through the CRT display
layer (scanlines + phosphor glow) that makes it feel like a live arcade monitor —
while the pixels underneath stay perfectly clean and export effect-free. The
active tool and current color glow the theme accent (electric-cyan by default,
Ember in the Forge theme), and the focus ring is a hot highlight. Selecting a
hardware palette / theme re-tempers the whole workshop's accent ramp. The metaphor
— cold metal heats as it becomes active, seen through arcade glass — makes the app
unmistakably PixelForge and not a generic pixel editor.

## Asset sources & resources

- **Icons** — bespoke 16/32px pixel set, hand-drawn on-grid, SVG/PNG sprite.
  Source: `bespoke` (AI-selected approach).
- **Animations / motion** — hand-rolled CSS `steps()` + `transform`/`opacity`;
  no animation library. Source: `AI: bespoke CSS`.
- **Fonts** — Press Start 2P, Pixelify Sans, Silkscreen, VT323 — all OFL, via
  **Fontsource** self-hosted `.woff2`. Source: `AI: Google Fonts / Fontsource`,
  SIL Open Font License.
- **Imagery / illustration** — purpose-drawn pixel art (anvil/ember empty-states).
  Source: `bespoke`.
- **UI components** — bespoke, from the token + bevel system in U-002; no kit
  shipped. Study-only reference: NES.css / 98.css shadow math. Source: `bespoke`.
- **Brand / style reference(s)** — none supplied by user; direction invented here.
- **Gaps filled by research** — sub-style, palette, fonts, chrome technique, CRT
  and sound approach all selected by the Architect from web research for THIS
  concept (decision-log ADR-004). Confirm the primary retro sub-style in intake
  Q1; default committed is the bespoke **Forge** workshop.

## Guardrails

- **Accessibility:** WCAG 2.2 AA contrast on all base colors (measured with CRT
  on); keyboard-first with a visible Spark focus ring; `prefers-reduced-motion`
  disables all ambient motion; state never conveyed by hue alone; no full-screen
  flash > 3/sec.
- **Performance:** No decorative cost on the drawing hot path. CRT/sound opt-in
  and must not regress INP or canvas repaint. Chrome fonts self-hosted to protect
  LCP/CLS.
