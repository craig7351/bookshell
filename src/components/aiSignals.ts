import type { IDisposable, Terminal } from "@xterm/xterm";
import { aiAttention, aiFinished, aiForget, aiWorking } from "../stores/aiStatus";

/**
 * Title prefixes that mean "an agent is working". Claude Code animates its
 * window title between ◐ / ◑ while busy and shows ✳ when idle; braille
 * spinner frames (⠋⠙⠹…) cover the many CLIs that use them.
 */
const WORKING_TITLE = /^\s*[◐-◓⠀-⣿]/;

/**
 * Watch one terminal for AI-agent signals. Everything here is in-band (escape
 * sequences in the PTY stream), so it works the same for local and SSH tabs:
 *
 *  - OSC 0/2 title: spinner prefix → working; spinner gone → finished.
 *  - BEL (e.g. Claude Code with preferredNotifChannel "terminal_bell").
 *  - OSC 9 <text> / OSC 777;notify;… / OSC 99 desktop notifications → attention.
 *  - OSC 9;4;<state>;<pct> progress: 1/3/4 → working, 0 → finished, 2 → attention.
 *
 * Working transitions fire only on edges, so a title spinner repainting every
 * second never overwrites an `attention` mark raised mid-run.
 */
export function registerAiSignals(term: Terminal, tabId: string): IDisposable {
  let titleWorking = false;
  let progressWorking = false;

  const setTitleWorking = (working: boolean) => {
    if (working && !titleWorking) aiWorking(tabId);
    else if (!working && titleWorking && !progressWorking) aiFinished(tabId);
    titleWorking = working;
  };

  const disposables: IDisposable[] = [
    term.onTitleChange((title) => setTitleWorking(WORKING_TITLE.test(title))),
    term.onBell(() => aiAttention(tabId)),
    term.parser.registerOscHandler(9, (data) => {
      if (data.startsWith("4;")) {
        const state = data.split(";")[1];
        const working = state === "1" || state === "3" || state === "4";
        if (state === "2") aiAttention(tabId);
        else if (working && !progressWorking) aiWorking(tabId);
        else if (!working && progressWorking && !titleWorking) aiFinished(tabId);
        progressWorking = working;
      } else if (!/^\d+;/.test(data)) {
        // Other numeric ConEmu sub-commands (9;9 cwd report — emitted on
        // every prompt by some PowerShell/oh-my-posh setups — 9;1 sleep, …)
        // are not notifications.
        aiAttention(tabId);
      }
      return true;
    }),
    term.parser.registerOscHandler(777, (data) => {
      if (data.startsWith("notify")) aiAttention(tabId);
      return true;
    }),
    term.parser.registerOscHandler(99, () => {
      aiAttention(tabId);
      return true;
    }),
  ];

  return {
    dispose() {
      for (const d of disposables) d.dispose();
      aiForget(tabId);
    },
  };
}
