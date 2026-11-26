import type { Terminal } from "@xterm/xterm";
import { api } from "../ipc/api";

/** How long after the middle button is released a stray native `paste`
 *  event is still treated as the browser's own PRIMARY-selection paste. */
const NATIVE_PASTE_WINDOW_MS = 300;
/** Upper bound if the release never reaches `host` (button let go elsewhere). */
const HELD_WINDOW_MS = 5000;

/**
 * Middle-click paste, uniform across platforms: read the system clipboard
 * (select-to-copy keeps it populated) and paste it via term.paste().
 *
 * On Linux, WebKitGTK ALSO pastes the PRIMARY selection on middle-click,
 * which used to land a second copy. Making the textarea readOnly did not
 * stop that: the browser still dispatches a `paste` event, and xterm's own
 * paste listener forwards its text to the shell. Two guards replace it:
 *  1. preventDefault() on the middle-button mouseup — WebKit skips its
 *     global-selection paste when the release event is cancelled;
 *  2. a capture-phase `paste` filter that swallows any native paste arriving
 *     right after a middle click, in case (1) is not honoured.
 * term.paste() writes straight to onData without a DOM paste event, so our
 * own paste is never filtered. Both guards are no-ops on Windows / macOS.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function installMiddleClickPaste(host: HTMLElement, getTerm: () => Terminal | undefined): () => void {
  let suppressUntil = 0;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    suppressUntil = performance.now() + HELD_WINDOW_MS;
    api
      .clipboardReadText()
      .then((text) => {
        if (text) getTerm()?.paste(text);
      })
      .catch((err) => console.warn("middle-click paste failed", err));
  };

  const onUp = (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    suppressUntil = performance.now() + NATIVE_PASTE_WINDOW_MS;
  };

  const onPaste = (e: Event) => {
    if (performance.now() >= suppressUntil) return;
    suppressUntil = 0;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  host.addEventListener("mousedown", onDown);
  host.addEventListener("mouseup", onUp, true);
  host.addEventListener("paste", onPaste, true);
  return () => {
    host.removeEventListener("mousedown", onDown);
    host.removeEventListener("mouseup", onUp, true);
    host.removeEventListener("paste", onPaste, true);
  };
}
