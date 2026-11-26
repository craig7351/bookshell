import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { activeTabId } from "./tabs";
import { general } from "./general";

/**
 * Per-tab AI agent state, fed by in-band terminal signals (see
 * components/aiSignals.ts), so it works for local and SSH tabs alike.
 *
 *   working    the agent is busy (title spinner / OSC 9;4 progress)
 *   attention  the agent wants you: bell / OSC 9 / OSC 777 notification
 *   done       the agent went idle while you were not looking at the tab
 *
 * attention / done are "unread" marks: they clear as soon as the tab is the
 * active one in a focused window. A tab with no entry shows nothing.
 */
export type AiState = "working" | "attention" | "done";

const [ai, setAi] = createStore<Record<string, AiState | undefined>>({});

export const aiStateOf = (tabId: string): AiState | undefined => ai[tabId];

const [windowFocused, setWindowFocused] = createSignal(document.hasFocus());
window.addEventListener("focus", () => setWindowFocused(true));
window.addEventListener("blur", () => setWindowFocused(false));

const isSeen = (tabId: string) => activeTabId() === tabId && windowFocused();

// Looking at a tab reads its unread mark.
createRoot(() => {
  createEffect(() => {
    const id = activeTabId();
    if (id && windowFocused() && ai[id] && ai[id] !== "working") setAi(id, undefined);
  });
});

/** Flash the taskbar / dock icon when the window is in the background. */
function alertUser(kind: "attention" | "done") {
  if (!general().ai_alerts || windowFocused()) return;
  getCurrentWindow()
    .requestUserAttention(kind === "attention" ? UserAttentionType.Critical : UserAttentionType.Informational)
    .catch((e) => console.warn("requestUserAttention failed", e));
}

export function aiWorking(tabId: string) {
  setAi(tabId, "working");
}

/** The agent stopped working. Only meaningful after a `working` phase. */
export function aiFinished(tabId: string) {
  if (ai[tabId] !== "working") return;
  if (isSeen(tabId)) {
    setAi(tabId, undefined);
    return;
  }
  setAi(tabId, "done");
  alertUser("done");
}

/** The agent (or anything in the PTY) asked for the user. */
export function aiAttention(tabId: string) {
  if (isSeen(tabId)) {
    // Already looking at it; drop a stale working spinner but add no badge.
    if (ai[tabId] === "working") setAi(tabId, undefined);
    return;
  }
  setAi(tabId, "attention");
  alertUser("attention");
}

export function aiForget(tabId: string) {
  setAi(tabId, undefined);
}
