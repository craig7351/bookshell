# BOOKSHELL — design hard rules

The full rationale lives in `docs/UI_PLAN.md`. This file is the short version:
the rules `npm run check` enforces and the ones a reviewer must enforce by eye.

## Colour

- `src/theme.ts` is the only place raw colour exists. `RAW` holds pure
  hex/rgba, `C` holds the same palette as `var(--…)` strings.
- Inline style objects use `C`. Anything consumed by **JavaScript** — the xterm
  theme, mermaid `themeVariables`, highlight.js, `<input type="color">`, string
  concatenation like `color + "70"` — must use `RAW`. A `var()` is not a colour.
- Exactly three interaction fills, app-wide: `--fill-hover` .06 /
  `--fill-active` .10 / `--fill-selected` .14. No component invents a fourth.
- Four text tiers: `--text-1` body, `--text-2` secondary-but-readable,
  `--text-3` meta (~4.3:1), `--text-4` decoration only (never load-bearing).
- Lines: `--line` for container edges, `--line-sub` for internal dividers. Two
  adjacent elements: only one of them draws the line.

## Selection language — there are exactly two

- **Toggle** → `aria-pressed="true"` → `--accent-fill` background, `--accent`
  foreground.
- **List selection / nav current** → `aria-selected` / `aria-current` →
  `--fill-selected` background, `--text-1` foreground.
- **Disabled** → `opacity: .4` + `cursor: default`. Never `pointer-events:
  none` — the tooltip explaining *why* must stay reachable.

## Focus, motion, elevation

- `:focus { outline: none }`; `:focus-visible` gets a 2px `--accent` ring at
  2px offset. Inputs instead take `--accent-line` border + a 3px `--accent-fill`
  shadow.
- Durations: 90ms hover/press, 140ms popover/menu/tab, 200ms dialog, 2600ms
  breathe. Press is always `scale(.97)`. Animate **opacity / transform only**.
- `@media (prefers-reduced-motion: reduce)` turns all of it off.
- Shadows are `--sh-1/2/3` plus `--hl-top`. Nothing else, and nothing blurred
  anywhere near the terminal.

## Inline / class precedence

`.bs-btn`, `.bs-iconbtn`, `.bs-row`, `.bs-pill`, `.bs-input`, `.bs-menu-item`,
`.bs-resize`, `.bs-tip` own `:hover / :active / :focus-visible / :disabled`.
Any property a class drives on a state must **not** also be set inline on that
element — inline sets the slot (`--btn-bg` for background, `--btn-fg` for
foreground), the class reads `var(--btn-bg, transparent)` /
`var(--btn-fg, inherit)`. Setting `background` or `color` inline defeats the
hover and `[aria-pressed]` rules silently. Delete `onMouseOver`/`onMouseOut`
handlers that only rewrite style; keep the handler if it also does real work
(e.g. `setHoverPath`).

The full slot set is `--btn-bg` / `--btn-bg-hover` / `--btn-bg-active` /
`--btn-bg-selected` (the `[aria-selected]` fill, for a row that carries a user
colour) and `--btn-fg` / `--btn-fg-hover`. Every one of them has a token
default, so a component sets only the ones it actually changes.

## Panels

The three right-column panels (Git, Files, Side terminal) share
`components/ui/PanelHeader.tsx`: a 32px bar, 16px glyph, uppercase `--t-11`/600
title, a meta slot and one 22x22 close button. In the right-split layout each
panel is a card — `panelCard()`: 6px margin on three sides, `--r-md`, one
`--line-sub` hairline, `overflow: hidden` — so a splitter never draws a second
line beside the card's own. A splitter between two stacked cards is
`.bs-resize[data-axis="row"]` and is pulled into the gap with a negative
margin, exactly like the column handle, so the gap stays 6px.

`ui/EmptyState.tsx` (28px `--text-4` glyph, `--t-13`/500 title) and its
`Skeleton`, and `ui/Notice.tsx` (one tinted inline band, four tones) are the
only "nothing here" / "something happened" blocks a panel may use. A panel
shows `Skeleton` on its FIRST load only — a refresh keeps the stale list on
screen — and a list that answers in under 150ms shows no placeholder at all.

A file status marker is a 16px `StatusBadge` chip, never a bare letter on the
text baseline, and a path is always two parts: the filename in `--text-1` and
its directory in `--text-3`/`--t-11`, the directory being the half that
truncates. The Git diff viewer is pre-parsed (`parseDiff`) rather than styled
line-by-line at render time: line numbers cannot be accumulated inside a
SolidJS render callback. Its two number gutters are `--text-3` (they are
information, not decoration) and the `+`/`-` marker is its own
`user-select: none` column, so copying a diff yields code that compiles.

## Dialogs

Every modal is `components/ui/DialogFrame.tsx`: an optional full-height
sidebar, then a 48px header (`--t-15`/600 title, one 22x22 ✕), a `flex: 1`
body that scrolls at 16px/20px, and an optional footer with a `--line-sub`
top edge. The frame itself never scrolls (`max-height: 85vh` +
`overflow: hidden`), so a long list moves under a title and a footer that
stay put. `role="dialog"` + `aria-modal`, `--r-xl`, `--sh-3` + `--hl-top`,
`bs-pop-in`. `Escape` closes a dialog, and a sub-state (an open edit form)
gets first refusal on that key before the dialog itself does.

Inside Settings, a pane is `SettingsGroup` (uppercase section label over one
`--bg-4` card at `--r-md`) filled with `SettingsRow`s. The divider between
rows is `.bs-settings-group > * + *` in base.css, never an inline
`border-top`, so the first row never doubles up with the card's own edge.

A list row in a dialog is the whole click target (`.bs-row`, `role="option"`
or `role="button"`, `tabindex="0"`); its Edit / Delete / reorder buttons live
in a `.bs-row-actions` wrapper and are invisible and click-through until the
row is hovered or holds focus. Reordering is `arrow-up` / `arrow-down` ghost
buttons, disabled at the ends — never a grip handle, because nothing behind
these lists implements dragging.

## The bottom dock

`CommandBar` + `StatusFooter` are one 56px base, not two unrelated strips.

The CommandBar is a **single 34px row that never wraps** — command buttons
scroll horizontally instead, so adding a thirteenth button can never steal a
terminal line. It is the one place in the app that hides its scrollbar
(`.bs-dock-scroll`); a 24px right-edge mask (`.bs-dock-fade`, applied only
while there is more to see) says "there is more" in its place, a vertical
wheel scrolls it sideways, and the edit pencil is pinned outside the scroller.
A command pill is `.bs-pill` at 26px: a user colour appears as a 6px dot plus
a 35% `color-mix` border tint, never as coloured label text. Sending flashes
the pill once (`bs-flash`, opacity only). A confirm is an **anchored popover**
above the pill — `--bg-3`, `--r-lg`, `--sh-2`, no scrim — because confirming
one button is not a modal moment.

The StatusFooter is the sunken floor: `--bg-0` with a single `--line-sub` top
edge. Every cell is `tabular-nums` and every system metric has a fixed value
width, so a digit rolling over moves nothing. Metrics sit at `--text-4` and
lift to `--text-3` while the pointer is on the footer (`.bs-metric`) — they
are ambient, not a readout. Zero warnings is a 6px green dot and a `--text-4`
count; only a non-zero count earns `--red` on `--red-fill`.

## Terminal overlays

Everything that floats over the canvas takes `--sh-1`, never `--sh-2`/`--sh-3`:
a 24px blur radius over live terminal output is exactly what xterm rule 1
forbids. Only two states still earn a full-canvas overlay — a dead session and
a drag in flight. Every other message (an upload, a pasted path, a copy, a
passthrough flip) is the **HUD pill**: bottom-centred, `--bg-3`, `--r-full`,
30px, `bs-pop-in`, held 1.6s and then faded out over 200ms, `pointer-events:
none` throughout.

Search is one capsule — `--r-full`, height-locked, one hairline — carrying a
bare field (`.bs-input.bs-input-bare`, no box and no ring of its own), one
segmented track for the three options and a tabular counter. The capsule owns
the state the field cannot show: no match turns its border `--red-line` and the
counter `--red`. Keyword highlight expands as a drawer underneath it, never as
a second floating window.

Two canvas-wide modes mark the canvas itself. Passthrough draws a 1.5px
`--purple-ring` inset ring in its own layer (the xterm host paints over
anything the root could draw) plus a `--t-10` mono label in the top-right
corner, which yields to the search capsule. The agent activity rail is a 2px
`--accent` line along the top edge that breathes while the PTY writes: the
output callback stamps a **plain variable**, a 250ms interval flips the signal,
and only when the state actually changes — 4Hz, opacity only, cleared in
`onCleanup` (xterm rule 6).

## Menus

`components/ContextMenu.tsx` is the only context menu. Its surface is the same
floating recipe as every other popover — `--bg-3`, one `--line` hairline,
`--r-lg`, `--sh-2` + `--hl-top` — and a row is a `.bs-menu-item` that sets
only the `--btn-*` slots (hover `--fill-active`, press `--fill-selected`, and
`--red-fill` on a `danger` row). A row has a 16px leading column that is
reserved even when empty, so every label in a menu starts on the same x, and
it holds exactly one of: an `Icon`, a 10px ringed colour swatch, or an emoji —
the tab-icon picker being the one menu whose glyphs are the user's content.
The trailing end carries, in order, a `<kbd>` shortcut (never spelled into the
label), an `--accent` ✓ for the current value of a group, and the submenu
chevron. `disabled` is `aria-disabled` and nothing else: the row still hovers.

Placement is `ui/usePopoverPosition.ts` for every fixed popover: clamp inside
an 8px margin, and where a caller supplies an opposite edge, **flip** to it
rather than sliding — a menu opened near the bottom-right corner opens up and
to the left of the cursor, and a submenu opens on the other side of its parent.
The popover stays `visibility: hidden` until it has been measured, so the
corrected position is the first one anyone sees. A submenu is fixed-positioned
but stays a DOM child of its row, so the pointer can travel into it without the
row losing `:hover`.

## Rendered Markdown

`.md-viewer` is the one place in the app that is *prose*, not chrome, and it is
styled as a document: a 760px measure inside 28px/32px/56px margins, one
neutral colour ramp for h1–h6 and body (`--text-1` over `--text-2`), and the
only coloured text on the page is a link. Hierarchy is size and rule, not hue:
h1 24px with a `--line` underline, h2 19px with `--line-sub`, h3 16px, h4 14px,
h5/h6 12px uppercase.

Code blocks are a `--bg-1` card with a `--line-sub` hairline, `--r-md`, 13px
mono, and the language in the top-right corner as a `--text-4` `--t-11` tag
(`pre[data-lang]::before`). Syntax colours come from `RAW.hljs` — pure hex,
because the rules are built as a string — and **no stylesheet may be linked
out of `node_modules`**: `index.html` loads `tokens.css` and `base.css` and
nothing else. Sanitisation (DOMPurify) runs on every parse and is not
negotiable; `data-*` and `class` survive it, which is what lets the mermaid
placeholders and the language tag work.

## Tooltips

`class="bs-tip" data-tip="…"`, not `title=`. Dark bubble, 400ms delay, visible
on disabled buttons, wraps at 320px. The bubble hangs below and centred by
default; add `bs-tip-up` on anything near the bottom edge (StatusFooter,
CommandBar) and `bs-tip-start` / `bs-tip-end` on anything near a side edge,
or it renders off-window. An element with `overflow: hidden` cannot host one —
the bubble is an `::after`, so it gets clipped; keep `title=` there.

A `<kbd>` is styled by an element rule in base.css (`components/ui/Kbd.tsx` is
just the semantic wrapper), so key caps look the same everywhere.

## Scales

`R` 4/6/8/10/14/999px · `S` 2/4/6/8/12/16/20/24/32px · gaps 4/6/8/12/16 ·
`H` 22/26/30px (+28px TabBar row) · type 10/11/12/13/15/20 · weights 400/500/600
(no 700 in chrome). `npm run check` fails on off-scale radius / font-size, on a
bare hex, on a bare `monospace`, and on any `backdrop-filter`.

## Fonts

No Google Fonts, no CDN at runtime. `"BS Mono"` is our private alias for the
bundled JetBrains Mono latin 400/700 (`@fontsource/jetbrains-mono`, `@font-face`
hand-written in `src/styles/base.css` — the package's own CSS is never
imported). It is UI chrome only, via `FONT.mono`.

## The seven xterm rules

1. The terminal container, its ancestors and any overlay above it never carry
   `backdrop-filter`, `filter`, or a `box-shadow` with blur > 4px.
2. `xtermTheme.background` must equal the host element's background
   (`RAW.bg2`, opaque).
3. Card treatment is `border-radius` + `overflow: hidden` on the `Terminal.tsx`
   root only. No shadow. The 6px gutter around it belongs to a *static*
   wrapper in `App.tsx` — padding on the terminals' own positioned container
   would be invisible, since `inset: 0` resolves against the padding box.
4. After touching padding / lineHeight / overviewRulerWidth, re-check cols and
   rows against `htop`, `fzf`, `ls --color`, a Claude Code TUI, and a CJK diff.
5. Panel toggles never animate column widths — fade the content instead.
6. Animate opacity / transform only; any signal driven by PTY output updates at
   most 4×/second.
7. The terminal font stack (`FONT.term`) contains system-installed families
   only. A webfont there would re-measure the cell grid after `term.open()`.
   If one is ever needed: `await document.fonts.load('16px "…"')` before
   `new Terminal`, then `term.clearTextureAtlas(); fit.fit()` on
   `document.fonts.ready`.
