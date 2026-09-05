/** macOS-style design tokens shared across all components.
 *
 * TWO LAYERS, ON PURPOSE:
 *
 *   RAW  — pure hex / rgba strings. The single source of truth for colour.
 *          Anything consumed by JavaScript rather than by CSS MUST read RAW:
 *          the xterm theme, mermaid themeVariables, highlight.js injection,
 *          <input type="color"> values and any string concatenation such as
 *          `color + "70"`. A "var(--x)" string is not a colour and will make
 *          those consumers silently break.
 *
 *   C    — the same palette expressed as "var(--…)" strings for use inside
 *          inline style objects. Keys are unchanged from before so every
 *          component keeps compiling. NEVER pass a C value to a JS colour API.
 *
 * src/styles/tokens.css carries a literal copy of every variable so the page
 * is styled before applyTokens(RAW) runs; applyTokens re-asserts them on
 * :root at boot (see main.tsx) and is the hook future theming will use.
 */

import { ansiMacosDark } from "./themes/macos-dark";
import { ansiMacosDarkLegacy } from "./themes/macos-dark-legacy";

/** Pure colour values. No var() may ever appear in here.
 *  This is the flat part of RAW — every key here maps 1:1 onto a CSS custom
 *  property (see TOKEN_NAMES) and is written to :root by applyTokens. */
const TOKENS = {
  // Surfaces
  bg0: "#0e0e10",
  bg1: "#141416",
  bg2: "#1c1c1e",
  bg3: "#242427",
  bg4: "#2e2e30",

  // The only three interaction fills
  fillHover: "rgba(255,255,255,0.06)",
  fillActive: "rgba(255,255,255,0.10)",
  fillSelected: "rgba(255,255,255,0.14)",

  // Lines
  line: "rgba(255,255,255,0.09)",
  lineSub: "rgba(255,255,255,0.055)",

  // Text, four tiers
  text1: "#f2f2f7",
  text2: "rgba(242,242,247,0.72)",
  text3: "rgba(242,242,247,0.48)",
  text4: "rgba(242,242,247,0.30)",

  // Accent
  accent: "#0a84ff",
  accentHover: "#3d9dff",
  accentPress: "#0870d8",
  accentFill: "rgba(10,132,255,0.16)",
  accentLine: "rgba(10,132,255,0.38)",
  // Ambient wash behind hero content (the empty state's radial). Too faint to
  // read as a fill, which is exactly the point — it tints, it does not select.
  accentGlow: "rgba(10,132,255,0.06)",

  // Semantic colours, each with a fill and a line
  green: "#30d158",
  greenFill: "rgba(48,209,88,0.15)",
  greenLine: "rgba(48,209,88,0.35)",
  yellow: "#ffd60a",
  yellowFill: "rgba(255,214,10,0.15)",
  yellowLine: "rgba(255,214,10,0.35)",
  orange: "#ff9f0a",
  orangeFill: "rgba(255,159,10,0.15)",
  orangeLine: "rgba(255,159,10,0.35)",
  red: "#ff453a",
  redFill: "rgba(255,69,58,0.16)",
  redLine: "rgba(255,69,58,0.35)",
  purple: "#bf5af2",
  purpleFill: "rgba(191,90,242,0.15)",
  purpleLine: "rgba(191,90,242,0.35)",
  cyan: "#5ac8fa",
  cyanFill: "rgba(90,200,250,0.15)",
  cyanLine: "rgba(90,200,250,0.35)",

  // Scrims
  scrim: "rgba(0,0,0,0.55)",
  scrimTerm: "rgba(14,14,16,0.78)",
  scrimDrop: "rgba(10,132,255,0.08)",

  // Window traffic lights
  tlRed: "#ff5f57",
  tlYellow: "#ffbd2e",
  tlGreen: "#28c840",
} as const;

/** Terminal keyword-highlight swatches (Terminal.tsx). Must stay pure hex:
 *  the values are concatenated with an alpha suffix (`color + "70"`) and fed
 *  to <input type="color">, neither of which understands a var(). */
const HIGHLIGHT = [
  TOKENS.red,
  TOKENS.yellow,
  TOKENS.green,
  TOKENS.accent,
  TOKENS.purple,
] as const;

/** The raw palette. Flat colour tokens plus the three JS-only colour tables:
 *  `ansi` / `ansiLegacy` (xterm) and `highlight` (Terminal swatches). */
export const RAW = {
  ...TOKENS,
  ansi: ansiMacosDark,
  ansiLegacy: ansiMacosDarkLegacy,
  highlight: HIGHLIGHT,
} as const;

/** Maps a flat RAW key onto its CSS custom property name. */
const TOKEN_NAMES: Record<keyof typeof TOKENS, string> = {
  bg0: "--bg-0",
  bg1: "--bg-1",
  bg2: "--bg-2",
  bg3: "--bg-3",
  bg4: "--bg-4",
  fillHover: "--fill-hover",
  fillActive: "--fill-active",
  fillSelected: "--fill-selected",
  line: "--line",
  lineSub: "--line-sub",
  text1: "--text-1",
  text2: "--text-2",
  text3: "--text-3",
  text4: "--text-4",
  accent: "--accent",
  accentHover: "--accent-hover",
  accentPress: "--accent-press",
  accentFill: "--accent-fill",
  accentLine: "--accent-line",
  accentGlow: "--accent-glow",
  green: "--green",
  greenFill: "--green-fill",
  greenLine: "--green-line",
  yellow: "--yellow",
  yellowFill: "--yellow-fill",
  yellowLine: "--yellow-line",
  orange: "--orange",
  orangeFill: "--orange-fill",
  orangeLine: "--orange-line",
  red: "--red",
  redFill: "--red-fill",
  redLine: "--red-line",
  purple: "--purple",
  purpleFill: "--purple-fill",
  purpleLine: "--purple-line",
  cyan: "--cyan",
  cyanFill: "--cyan-fill",
  cyanLine: "--cyan-line",
  scrim: "--scrim",
  scrimTerm: "--scrim-term",
  scrimDrop: "--scrim-drop",
  tlRed: "--tl-red",
  tlYellow: "--tl-yellow",
  tlGreen: "--tl-green",
};

/**
 * Writes a raw palette onto :root as CSS custom properties. Call once at boot,
 * before the app renders. tokens.css already carries identical literals, so
 * this is idempotent today and becomes the swap point for future theming.
 */
export function applyTokens(palette: Partial<Record<keyof typeof TOKENS, string>> = RAW): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of Object.keys(TOKEN_NAMES) as (keyof typeof TOKENS)[]) {
    const value = palette[key];
    if (value) root.style.setProperty(TOKEN_NAMES[key], value);
  }
}

/**
 * Palette for inline style objects — every value is a var() reference.
 * Key names are frozen: components across the app import these directly.
 */
export const C = {
  // Surface hierarchy:
  //   bg2 = chrome/panels (darkest, recedes)
  //   bg  = main content / terminal (hero surface)
  //   bg3 = elevated controls (inputs, pills) — sits ABOVE main content
  bg:          "var(--bg-2)",
  bg2:         "var(--bg-1)",
  // The sunken floor: StatusFooter and the scrollbar track only.
  bg0:         "var(--bg-0)",
  bg3:         "var(--bg-4)",
  bgHover:     "var(--fill-hover)",
  bgActive:    "var(--fill-active)",
  bgSelected:  "var(--fill-selected)",
  overlay:     "var(--bg-3)",
  border:      "var(--line)",
  borderSub:   "var(--line-sub)",
  text:        "var(--text-1)",
  text2:       "var(--text-2)",
  text3:       "var(--text-3)",
  text4:       "var(--text-4)",
  accent:      "var(--accent)",
  accentHover: "var(--accent-hover)",
  accentPress: "var(--accent-press)",
  accentBg:    "var(--accent-fill)",
  accentBdr:   "var(--accent-line)",
  accentGlow:  "var(--accent-glow)",
  cyan:        "var(--cyan)",
  cyanBg:      "var(--cyan-fill)",
  green:       "var(--green)",
  greenBg:     "var(--green-fill)",
  red:         "var(--red)",
  redBg:       "var(--red-fill)",
  yellow:      "var(--yellow)",
  yellowBg:    "var(--yellow-fill)",
  orange:      "var(--orange)",
  orangeBg:    "var(--orange-fill)",
  purple:      "var(--purple)",
  purpleBg:    "var(--purple-fill)",
  purpleBdr:   "var(--purple-line)",
  scrim:       "var(--scrim)",
  scrimTerm:   "var(--scrim-term)",
  scrimDrop:   "var(--scrim-drop)",
  tRed:        "var(--tl-red)",
  tYellow:     "var(--tl-yellow)",
  tGreen:      "var(--tl-green)",
} as const;

/** Corner radii. 3 / 5 / 7 / 12px are gone — pick from this list. */
export const R = {
  xs:   "var(--r-xs)",    // 4px  — kbd, badge, tag, diff marker, tooltip
  sm:   "var(--r-sm)",    // 6px  — buttons, inputs, rows, tabs, pills
  md:   "var(--r-md)",    // 8px  — terminal card, panel card, segmented, pre
  lg:   "var(--r-lg)",    // 10px — popover, context menu, diag panel
  xl:   "var(--r-xl)",    // 14px — dialog, viewer modal
  full: "var(--r-full)",  // capsules
} as const;

/** 4pt spacing grid. 6px is the card-gutter special case. */
export const S = {
  0.5: "2px",
  1: "4px",
  1.5: "6px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
} as const;

/** Control heights — lock the height, keep vertical padding at 0. */
export const H = {
  compact: "22px",  // footer, panel toolbar, icon-only
  default: "26px",  // header toolbar, CommandBar pill
  roomy:   "30px",  // dialog form fields, HUD pill
  row:     "28px",  // TabBar row (the one exception)
} as const;

/** Type scale: six steps, size paired with line-height. */
export const T = {
  10: { "font-size": "10px", "line-height": "14px" },
  11: { "font-size": "11px", "line-height": "16px" },
  12: { "font-size": "12px", "line-height": "16px" },
  13: { "font-size": "13px", "line-height": "18px" },
  15: { "font-size": "15px", "line-height": "20px" },
  20: { "font-size": "20px", "line-height": "26px" },
} as const;

/** Font families. FONT.term is xterm-only and lists system fonts exclusively:
 *  a webfont swapping in after term.open() would break cell measurement. */
export const FONT = {
  ui:   "var(--font-ui)",
  mono: "var(--font-mono)",
  term: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Shadows. No blur ever reaches the terminal container or its ancestors. */
export const SH = {
  hlTop: "var(--hl-top)",
  e1:    "var(--sh-1)",
  e2:    "var(--sh-2)",   // popover, menu, search pill, diag panel, tooltip
  e3:    "var(--sh-3)",   // dialog
} as const;

/** Motion. Animate opacity / transform only. */
export const M = {
  d1:      "var(--dur-1)",
  d2:      "var(--dur-2)",
  d3:      "var(--dur-3)",
  breathe: "var(--dur-breathe)",
  ease:    "var(--ease)",
  easePop: "var(--ease-pop)",
} as const;

/** Common text roles, ready to spread into a style object. */
export const TYPO = {
  title:   { ...T[15], "font-weight": 600, color: C.text },
  body:    { ...T[12], "font-weight": 400, color: C.text },
  label:   { ...T[11], "font-weight": 500, color: C.text2 },
  meta:    { ...T[11], "font-weight": 400, color: C.text3 },
  section: {
    ...T[10],
    "font-weight": 600,
    color: C.text3,
    "text-transform": "uppercase",
    "letter-spacing": "0.06em",
  },
  mono:    { ...T[12], "font-family": FONT.mono },
  num:     { ...T[12], "font-variant-numeric": "tabular-nums" },
} as const;

export const overlayStyle = {
  position:           "fixed",
  inset:              "0",
  background:         C.scrim,
  display:            "flex",
  "align-items":      "center",
  "justify-content":  "center",
  "z-index":          "100",
} as const;

export const dialogStyle = {
  position:           "relative",
  background:         C.overlay,
  color:              C.text,
  border:             `1px solid ${C.border}`,
  "border-radius":    R.xl,
  "box-shadow":       `${SH.e3}, ${SH.hlTop}`,
  padding:            "20px",
} as const;

export const inputStyle = {
  background:     C.bg3,
  color:          C.text,
  border:         `1px solid ${C.border}`,
  padding:        "7px 10px",
  "border-radius":R.sm,
  "font-size":    "13px",
} as const;

/** Primary action button (blue). */
export const btnPrimary = {
  background:     C.accent,
  color:          "#fff",
  border:         "none",
  "border-radius":R.sm,
  padding:        "6px 14px",
  "font-size":    "13px",
  cursor:         "pointer",
  "font-weight":  600,
} as const;

/** Secondary/ghost button. */
export const btnSecondary = {
  background:     C.bg3,
  color:          C.text,
  border:         `1px solid ${C.border}`,
  "border-radius":R.sm,
  padding:        "6px 14px",
  "font-size":    "13px",
  cursor:         "pointer",
  "font-weight":  500,
} as const;

/** Danger button (red). */
export const btnDanger = {
  background:     C.red,
  color:          "#fff",
  border:         "none",
  "border-radius":R.sm,
  padding:        "6px 14px",
  "font-size":    "13px",
  cursor:         "pointer",
  "font-weight":  600,
} as const;

export type BtnVariant = "primary" | "secondary" | "danger" | "ghost";
export type CtrlSize = "compact" | "default" | "roomy";

const BTN_PAD: Record<CtrlSize, string> = {
  compact: "0 8px",
  default: "0 10px",
  roomy:   "0 14px",
};

const BTN_TEXT: Record<CtrlSize, { "font-size": string; "line-height": string }> = {
  compact: T[11],
  default: T[12],
  roomy:   T[13],
};

/**
 * Button style factory. Returns layout plus the component-specific colour only;
 * hover / active / focus / disabled belong to the .bs-btn class, so callers
 * pair this with class="bs-btn" and never set those properties inline.
 */
export function button(variant: BtnVariant = "secondary", size: CtrlSize = "default") {
  const base = {
    display:           "inline-flex",
    "align-items":     "center",
    "justify-content": "center",
    gap:               S[1.5],
    height:            H[size],
    padding:           BTN_PAD[size],
    ...BTN_TEXT[size],
    "font-weight":     500,
    "border-radius":   R.sm,
    cursor:            "pointer",
    "white-space":     "nowrap",
  };
  switch (variant) {
    case "primary":
      return {
        ...base,
        "--btn-bg": C.accent,
        "--btn-bg-hover": C.accentHover,
        "--btn-bg-active": C.accentPress,
        color: "#fff",
        border: "none",
        "font-weight": 600,
      };
    case "danger":
      return { ...base, "--btn-bg": C.red, color: "#fff", border: "none", "font-weight": 600 };
    case "ghost":
      return { ...base, "--btn-bg": "transparent", color: C.text2, border: "1px solid transparent" };
    default:
      return { ...base, "--btn-bg": C.bg3, color: C.text, border: `1px solid ${C.border}` };
  }
}

/** Input style factory — pair with class="bs-input" for the focus state. */
export function input(size: CtrlSize = "roomy") {
  return {
    height:         H[size],
    padding:        BTN_PAD[size],
    ...BTN_TEXT[size],
    color:          C.text,
    background:     C.bg3,
    border:         `1px solid ${C.border}`,
    "border-radius":R.sm,
    width:          "100%",
  };
}

/** Terminal palette ids accepted by GeneralSettings.terminal_palette. */
export type TerminalPalette = "macos-dark" | "legacy";

/** xterm.js theme. Reads RAW because xterm parses these as real colours —
 *  a "var(--…)" string here renders as transparent, so never pass C.
 *  `background` MUST equal the host element background (RAW.bg2, opaque):
 *  a mismatch shows up as a seam around the terminal card. */
export function xtermThemeFor(palette?: string | null) {
  const ansi = palette === "legacy" ? RAW.ansiLegacy : RAW.ansi;
  return {
    background:   RAW.bg2,
    foreground:   RAW.text1,
    cursor:       RAW.text1,
    cursorAccent: RAW.bg2,
    ...ansi,
  };
}

/** Default terminal theme. Kept as a named export so anything that does not
 *  care about the user's palette choice keeps compiling. */
export const xtermTheme = xtermThemeFor("macos-dark");
