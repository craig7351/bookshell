import type { ITheme, Terminal } from "@xterm/xterm";
import type { GeneralSettings } from "../ipc/api";
import { terminalFontFamily } from "../themes/terminal";

/** Apply options to the existing terminal. The view refits when geometry changes. */
export function applyTerminalSettings(
  term: Terminal,
  settings: GeneralSettings,
  fontSize: number,
  theme: ITheme,
): boolean {
  const fontFamily = terminalFontFamily(settings.terminal_font_family);
  const previous = term.options;
  const needsFit = previous.fontFamily !== fontFamily || previous.fontSize !== fontSize
    || previous.scrollback !== settings.scrollback;

  term.options = { fontFamily, fontSize, scrollback: settings.scrollback };
  if (previous.theme?.foreground !== theme.foreground || previous.theme?.background !== theme.background) {
    term.options.theme = theme;
  }
  return needsFit;
}
