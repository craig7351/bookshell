/** xterm ANSI palette — "macos-dark" (default).
 *
 *  PURE HEX / RGBA ONLY. xterm parses these strings as real colours, so a
 *  "var(--…)" value would silently render as transparent. Never import C here.
 *
 *  Corrected ladder versus the legacy table: black is lifted off pure #000 so
 *  a filled ANSI-black cell reads as a surface rather than a hole, brightBlack
 *  is raised until dim text is legible, and every bright colour is genuinely
 *  brighter than its base (the legacy brightGreen was darker than green).
 */
export const ansiMacosDark = {
  black:   "#1c1c1e",
  red:     "#ff453a",
  green:   "#30d158",
  yellow:  "#f0c541",
  blue:    "#3d9dff",
  magenta: "#bf5af2",
  cyan:    "#5ac8fa",
  white:   "#ebebf5",

  brightBlack:   "#7c7c80",
  brightRed:     "#ff6961",
  brightGreen:   "#5be37a",
  brightYellow:  "#ffe066",
  brightBlue:    "#6cb8ff",
  brightMagenta: "#da8fff",
  brightCyan:    "#70d7ff",
  brightWhite:   "#ffffff",

  selectionBackground:         "rgba(10,132,255,0.3)",
  selectionInactiveBackground: "rgba(255,255,255,0.10)",
} as const;
