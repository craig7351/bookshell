import type { IDisposable, Terminal } from "@xterm/xterm";
import { api } from "../ipc/api";

/**
 * OSC 52 clipboard writes: `ESC ] 52 ; <targets> ; <base64> BEL`.
 *
 * TUIs that grab the mouse (Claude Code, tmux, vim with mouse=a) draw their
 * own selection and hand the text to the terminal through this sequence,
 * because they have no direct route to the OS clipboard — especially over SSH.
 * Without a handler xterm.js drops it and the copy silently does nothing.
 *
 * Only writes are honoured. A `?` query (read the clipboard back to the app)
 * is ignored on purpose: it would let any program in the PTY, including a
 * remote host, read whatever the user last copied. Targets (c/p/s/0-7) are
 * all mapped to the one system clipboard. The write goes through the native
 * arboard command, same as selection auto-copy, because navigator.clipboard
 * can hang or need focus inside the WebView.
 */
export function registerOsc52(term: Terminal): IDisposable {
  const decoder = new TextDecoder();
  return term.parser.registerOscHandler(52, (data) => {
    const sep = data.indexOf(";");
    if (sep < 0) return true;
    const payload = data.slice(sep + 1);
    // Empty payload means "clear selection"; `?` is a read request. Skip both.
    if (payload === "" || payload === "?") return true;
    let text: string;
    try {
      const bin = atob(payload);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      text = decoder.decode(bytes);
    } catch (e) {
      console.warn("OSC 52: invalid base64 payload", e);
      return true;
    }
    api.clipboardWriteText(text).catch((e) => console.warn("OSC 52 clipboard write failed", e));
    return true;
  });
}
