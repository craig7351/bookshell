import type { GeneralSettings, TerminalPalette } from "../ipc/api";
import { FONT, xtermTheme } from "../theme";

const greenOnBlack = { foreground: "#00ff00", background: "#000000" };

export const terminalPalettes = [
  { id: "macos-dark", label: "macOS Dark" },
  { id: "green-on-black", label: "Green on Black" },
  { id: "custom", label: "Custom" },
] as const satisfies ReadonlyArray<{ id: TerminalPalette; label: string }>;

export type TerminalColors = Pick<GeneralSettings,
  "terminal_palette" | "terminal_foreground" | "terminal_background">;

export function terminalPalette(value: string | null): TerminalPalette {
  return terminalPalettes.find((palette) => palette.id === value)?.id ?? "macos-dark";
}

export function terminalColor(value: string | null): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function terminalTheme(settings: TerminalColors) {
  const palette = terminalPalette(settings.terminal_palette);
  if (palette === "macos-dark") return xtermTheme;

  const foreground = palette === "green-on-black"
    ? greenOnBlack.foreground
    : terminalColor(settings.terminal_foreground) ?? xtermTheme.foreground;
  const background = palette === "green-on-black"
    ? greenOnBlack.background
    : terminalColor(settings.terminal_background) ?? xtermTheme.background;
  return { ...xtermTheme, foreground, background, cursor: foreground, cursorAccent: background };
}

const terminalFontNameLimit = 120;

export function terminalFontName(value: string | null): string | null {
  const name = value?.trim();
  return name && name.length <= terminalFontNameLimit && !/[\u0000-\u001f\u007f]/.test(name)
    ? name
    : null;
}

export function terminalFontFamily(value: string | null): string {
  const name = terminalFontName(value);
  return name ? `"${name.replace(/[\\"]/g, "\\$&")}", ${FONT.term}` : FONT.term;
}
