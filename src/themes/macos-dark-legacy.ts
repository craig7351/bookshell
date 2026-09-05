/** xterm ANSI palette — "legacy": the table BOOKSHELL shipped before the
 *  ladder was corrected, kept verbatim so anyone who preferred it can switch
 *  back via GeneralSettings.terminal_palette = "legacy".
 *
 *  PURE HEX / RGBA ONLY — same rule as macos-dark.ts, never import C here.
 *  selectionInactiveBackground is deliberately absent: the old table did not
 *  set it, so xterm's own default keeps applying.
 */
export const ansiMacosDarkLegacy = {
  black:   "#000000",
  red:     "#ff453a",
  green:   "#30d158",
  yellow:  "#ffd60a",
  blue:    "#0a84ff",
  magenta: "#bf5af2",
  cyan:    "#5ac8fa",
  white:   "#ebebf5",

  brightBlack:   "#636366",
  brightRed:     "#ff6961",
  brightGreen:   "#34c759",
  brightYellow:  "#ffd60a",
  brightBlue:    "#409cff",
  brightMagenta: "#da8fff",
  brightCyan:    "#70d7ff",
  brightWhite:   "#ffffff",

  selectionBackground: "rgba(10,132,255,0.3)",
} as const;
