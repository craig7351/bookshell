/** macOS-style design tokens shared across all components. */

export const C = {
  // Three-tier surface hierarchy:
  //   bg2 = chrome/panels (darkest, recedes)
  //   bg  = main content / terminal (hero surface)
  //   bg3 = elevated controls (inputs, pills) — sits ABOVE main content
  // This lets the terminal area visually pop without any borders.
  bg:         "#1c1c1e",
  bg2:        "#141416",
  bg3:        "#2e2e30",
  bgHover:    "rgba(255,255,255,0.07)",
  bgActive:   "rgba(255,255,255,0.12)",
  border:     "rgba(255,255,255,0.1)",
  borderSub:  "rgba(255,255,255,0.06)",
  text:       "#f2f2f7",
  text2:      "rgba(242,242,247,0.55)",
  text3:      "rgba(242,242,247,0.28)",
  accent:     "#0a84ff",
  accentBg:   "rgba(10,132,255,0.18)",
  accentBdr:  "rgba(10,132,255,0.4)",
  green:      "#30d158",
  greenBg:    "rgba(48,209,88,0.15)",
  red:        "#ff453a",
  redBg:      "rgba(255,69,58,0.18)",
  yellow:     "#ffd60a",
  orange:     "#ff9f0a",
  purple:     "#bf5af2",
  tRed:       "#ff5f57",
  tYellow:    "#ffbd2e",
  tGreen:     "#28c840",
} as const;

/** xterm.js theme that matches the macOS dark palette. */
export const xtermTheme = {
  background:         C.bg,
  foreground:         C.text,
  cursor:             C.text,
  cursorAccent:       C.bg,
  selectionBackground:"rgba(10,132,255,0.3)",
  black:   "#000000", red:     C.red,    green: C.green,  yellow: C.yellow,
  blue:    C.accent,  magenta: C.purple, cyan:  "#5ac8fa", white: "#ebebf5",
  brightBlack:   "#636366", brightRed:     "#ff6961",
  brightGreen:   "#34c759", brightYellow:  C.yellow,
  brightBlue:    "#409cff", brightMagenta: "#da8fff",
  brightCyan:    "#70d7ff", brightWhite:   "#ffffff",
} as const;

export const overlayStyle = {
  position:           "fixed",
  inset:              "0",
  background:         "rgba(0,0,0,0.45)",
  "backdrop-filter":  "blur(6px)",
  display:            "flex",
  "align-items":      "center",
  "justify-content":  "center",
  "z-index":          "100",
} as const;

export const dialogStyle = {
  position:           "relative",
  background:         "rgba(30,30,32,0.97)",
  "backdrop-filter":  "blur(40px) saturate(180%)",
  color:              C.text,
  border:             `1px solid ${C.border}`,
  "border-radius":    "14px",
  "box-shadow":       "0 24px 64px rgba(0,0,0,0.75), 0 4px 16px rgba(0,0,0,0.4)",
  padding:            "20px",
} as const;

export const inputStyle = {
  background:     C.bg3,
  color:          C.text,
  border:         `1px solid ${C.border}`,
  padding:        "7px 10px",
  "border-radius":"8px",
  "font-size":    "13px",
  outline:        "none",
} as const;

/** Primary action button (blue). */
export const btnPrimary = {
  background:     C.accent,
  color:          "#fff",
  border:         "none",
  "border-radius":"8px",
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
  "border-radius":"8px",
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
  "border-radius":"8px",
  padding:        "6px 14px",
  "font-size":    "13px",
  cursor:         "pointer",
  "font-weight":  600,
} as const;
