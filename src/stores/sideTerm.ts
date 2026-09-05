import { createStore } from "solid-js/store";
import { api } from "../ipc/api";
import { connections } from "./connections";
import { activeTab, tabs as allTabs } from "./tabs";

interface SideTermEntry {
  /** Sub-session id from ssh_open_pty; null while opening or after close. */
  sessionId: string | null;
  open: boolean;
  /** True while ssh_open_pty is in flight. */
  opening: boolean;
  error?: string;
}

interface SideTermState {
  entries: Record<string, SideTermEntry>;
  /** Width of the right-side terminal panel in px (horizontal layout). */
  width: number;
  /** Height of the bottom terminal panel in px (vertical layout). */
  height: number;
}

const [state, setState] = createStore<SideTermState>({ entries: {}, width: 380, height: 300 });

export const sideTermState = state;

export function isSideTermOpen(parentTabId: string): boolean {
  return !!state.entries[parentTabId]?.open;
}

export function sideTermSessionId(parentTabId: string): string | null {
  return state.entries[parentTabId]?.sessionId ?? null;
}

export const sideTermWidth = () => state.width;
export function setSideTermWidth(w: number) {
  setState("width", Math.max(260, Math.min(900, w)));
}

export const sideTermHeight = () => state.height;
export function setSideTermHeight(h: number) {
  setState("height", Math.max(150, Math.min(800, h)));
}

export async function openSideTerm(parentTabId: string) {
  const tab = allTabs().find((t) => t.id === parentTabId);
  if (!tab || !tab.sessionId || tab.status !== "connected") return;
  if (state.entries[parentTabId]?.opening) return;

  setState("entries", parentTabId, {
    sessionId: state.entries[parentTabId]?.sessionId ?? null,
    open: true,
    opening: !state.entries[parentTabId]?.sessionId,
    error: undefined,
  });

  if (state.entries[parentTabId]?.sessionId) return;

  try {
    // For local tabs we can't share a single SSH session — spawn a fresh
    // local PTY using the same shell, optionally starting in the saved
    // 📍 cwd or the profile's default cwd.
    const profile = connections().find((c) => c.id === tab.connectionId);
    const isLocal = profile?.kind === "local";
    let sid: string;
    if (isLocal) {
      sid = await api.localOpenPty({
        shell: profile?.shell ?? null,
        cwd: tab.cwd ?? profile?.cwd ?? null,
        cols: 100,
        rows: 30,
      });
    } else {
      sid = await api.sshOpenPty(tab.sessionId, 100, 30);
    }
    setState("entries", parentTabId, {
      sessionId: sid,
      open: true,
      opening: false,
      error: undefined,
    });
    // Local PTY honours `cwd` at spawn time, so no follow-up cd is needed
    // for it. SSH side terminals only chain `cd` when 📍 was marked.
    if (!isLocal) {
      const savedCwd = tab.cwd;
      if (savedCwd) {
        setTimeout(() => {
          const escaped = savedCwd.replace(/'/g, "'\\''");
          api.sshWrite(sid, `cd '${escaped}'\r`).catch(() => {});
        }, 350);
      }
    }
  } catch (e: any) {
    setState("entries", parentTabId, {
      sessionId: null,
      open: true,
      opening: false,
      error: String(e),
    });
  }
}

export async function closeSideTerm(parentTabId: string, hardKill: boolean = true) {
  const e = state.entries[parentTabId];
  if (!e) return;
  if (hardKill && e.sessionId) {
    await api.sshDisconnect(e.sessionId).catch(() => {});
  }
  setState("entries", parentTabId, {
    sessionId: null,
    open: false,
    opening: false,
    error: undefined,
  });
}

export async function toggleSideTerm(parentTabId: string) {
  if (isSideTermOpen(parentTabId)) {
    await closeSideTerm(parentTabId);
  } else {
    await openSideTerm(parentTabId);
  }
}

// Keep helper available
export { activeTab };
