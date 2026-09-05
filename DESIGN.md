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
