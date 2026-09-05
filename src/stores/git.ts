import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { api, type GitCommitDetail, type GitViewData } from "../ipc/api";
import { general } from "./general";
import {
  activeTab,
  activeTabId,
  captureCwd,
  captureCwdViaPty,
  setTabCwd,
  setTabGitWidth,
  tabs as allTabs,
} from "./tabs";

/** unlisten callbacks for git://changed events, keyed by tabId */
const changeListeners: Record<string, () => void> = {};
/** debounce timers for watcher callbacks, keyed by tabId */
const watchDebounce: Record<string, ReturnType<typeof setTimeout>> = {};

interface GitPanelState {
  /** tabIds with the panel toggled on */
  open: Record<string, boolean>;
  /** cached panel data per tab */
  data: Record<string, GitViewData | null>;
  /** loading flag per tab */
  loading: Record<string, boolean>;
  /** last error per tab */
  error: Record<string, string | null>;
  /** height of the bottom panel in px (vertical layout) */
  height: number;
}

/** Default Git panel width for tabs that haven't customized it. */
const DEFAULT_GIT_WIDTH = 520;

const [state, setState] = createStore<GitPanelState>({
  open: {},
  data: {},
  loading: {},
  error: {},
  height: 300,
});

export const gitState = state;

export function isGitOpen(tabId: string): boolean {
  return !!state.open[tabId];
}

/** Width (px) of the Git panel for the active tab. Falls back to the default
 *  when the tab has no persisted preference. */
export const gitWidth = (): number => activeTab()?.gitWidth ?? DEFAULT_GIT_WIDTH;

export function setGitWidth(w: number) {
  const id = activeTabId();
  if (!id) return;
  setTabGitWidth(id, Math.max(260, Math.min(900, w)));
}

export const gitHeight = () => state.height;
export function setGitHeight(h: number) {
  setState("height", Math.max(150, Math.min(800, h)));
}

export async function toggleGit(tabId: string, opts?: { probe?: boolean }) {
  const next = !state.open[tabId];
  setState("open", tabId, next);
  if (next) {
    // Re-probe the live cwd via PTY sentinel each time the panel opens, so
    // git view follows the user's `cd` between open/close cycles. If the
    // probe fails (shell busy, timed out), keep whatever 📍 mark exists.
    // Callers can pass { probe: false } to skip the probe — used by the
    // session-restore auto-open path where tab.cwd is already trusted.
    if (opts?.probe !== false) {
      const detected = await captureCwdViaPty(tabId);
      if (detected) setTabCwd(tabId, detected);
    }
    await refreshGit(tabId);
    startGitWatch(tabId);
  } else {
    stopGitWatch(tabId);
  }
}

async function startGitWatch(tabId: string) {
  const tab = allTabs().find((t) => t.id === tabId);
  const cwd = state.data[tabId]?.cwd;
  if (!tab?.sessionId || !cwd) return;

  // Remove stale listener if any.
  changeListeners[tabId]?.();
  delete changeListeners[tabId];

  const pollSecs = general().git_poll_secs ?? 5;
  try {
    await api.gitWatchStart(tabId, tab.sessionId, cwd, pollSecs);
    const unlisten = await api.onGitChanged(tabId, () => {
      clearTimeout(watchDebounce[tabId]);
      watchDebounce[tabId] = setTimeout(() => refreshGitWithCwd(tabId, cwd), 500);
    });
    changeListeners[tabId] = unlisten;
  } catch (e) {
    console.warn("gitWatchStart failed", e);
  }
}

function stopGitWatch(tabId: string) {
  changeListeners[tabId]?.();
  delete changeListeners[tabId];
  api.gitWatchStop(tabId).catch(() => {});
}

/** Re-run git commands using a known cwd (no cwd probe). Used by the watcher. */
async function refreshGitWithCwd(tabId: string, cwd: string) {
  const tab = allTabs().find((t) => t.id === tabId);
  if (!tab || !tab.sessionId || tab.status !== "connected") return;
  if (state.loading[tabId]) return; // already refreshing
  setState("loading", tabId, true);
  setState("error", tabId, null);
  try {
    const data = await api.gitView(tab.sessionId, cwd);
    setState("data", tabId, data);
    if (data.error) setState("error", tabId, data.error);
  } catch (e: any) {
    setState("error", tabId, String(e));
  } finally {
    setState("loading", tabId, false);
  }
}

export async function refreshGit(tabId: string) {
  const tab = allTabs().find((t) => t.id === tabId);
  if (!tab || !tab.sessionId || tab.status !== "connected") {
    setState("error", tabId, "Tab is not connected.");
    return;
  }
  setState("loading", tabId, true);
  setState("error", tabId, null);
  try {
    // Prefer the user's saved 📍 mark — it's the only reliable source of
    // truth for the interactive shell's cwd. captureCwd over a fresh SSH
    // exec channel just returns $HOME (not the user's `cd`-ed location),
    // so it's only useful as a guess when no mark is set yet.
    let cwd = tab.cwd ?? null;
    if (!cwd) cwd = await captureCwd(tabId);
    if (!cwd) {
      setState(
        "error",
        tabId,
        "No working directory set for this tab. Open 📍 Mark cwd from the tab's right-click menu and Auto-detect.",
      );
      setState("loading", tabId, false);
      return;
    }
    const data = await api.gitView(tab.sessionId, cwd);
    setState("data", tabId, data);
    if (data.error) setState("error", tabId, data.error);
  } catch (e: any) {
    setState("error", tabId, String(e));
  } finally {
    setState("loading", tabId, false);
  }
}

// ─── Diff / Commit viewer modal state ──────────────────────────────────

export type ViewerState =
  | { kind: null }
  | {
      kind: "diff";
      title: string;
      body: string;
      loading: boolean;
      /** Extra context needed for the MD preview tab. */
      sessionId: string;
      cwd: string;
      path: string;
      /** undefined = working tree, "staged" = index */
      mdRev: string | undefined;
    }
  | {
      kind: "commit";
      tabId: string;
      sessionId: string;
      cwd: string;
      rev: string;
      detail: GitCommitDetail | null;
      loading: boolean;
      selectedPath: string | null;
      fileDiff: string;
      fileLoading: boolean;
      error?: string;
    };

const [viewer, setViewer] = createSignal<ViewerState>({ kind: null });

export { viewer };
export function closeViewer() {
  setViewer({ kind: null });
}

export async function openDiff(tabId: string, path: string, staged: boolean, untracked: boolean) {
  const tab = allTabs().find((t) => t.id === tabId);
  if (!tab || !tab.sessionId) return;
  const data = state.data[tabId];
  const cwd = data?.cwd ?? tab.cwd ?? "";
  if (!cwd) return;
  const title = `${untracked ? "untracked " : staged ? "staged " : ""}${path}`;
  const mdRev: string | undefined = staged ? "staged" : undefined;
  setViewer({ kind: "diff", title, body: "", loading: true, sessionId: tab.sessionId, cwd, path, mdRev });
  try {
    const body = untracked
      ? await api.gitShowUntracked(tab.sessionId, cwd, path)
      : await api.gitDiff(tab.sessionId, cwd, path, staged);
    setViewer({ kind: "diff", title, body: body || "(no changes)", loading: false, sessionId: tab.sessionId, cwd, path, mdRev });
  } catch (e: any) {
    setViewer({ kind: "diff", title: path, body: String(e), loading: false, sessionId: tab.sessionId, cwd, path, mdRev });
  }
}

export async function openCommit(tabId: string, rev: string) {
  const tab = allTabs().find((t) => t.id === tabId);
  if (!tab || !tab.sessionId) return;
  const data = state.data[tabId];
  const cwd = data?.cwd ?? tab.cwd ?? "";
  if (!cwd) return;
  setViewer({
    kind: "commit",
    tabId,
    sessionId: tab.sessionId,
    cwd,
    rev,
    detail: null,
    loading: true,
    selectedPath: null,
    fileDiff: "",
    fileLoading: false,
  });
  try {
    const detail = await api.gitCommitDetail(tab.sessionId, cwd, rev);
    const first = detail.files[0]?.path ?? null;
    setViewer({
      kind: "commit",
      tabId,
      sessionId: tab.sessionId,
      cwd,
      rev,
      detail,
      loading: false,
      selectedPath: first,
      fileDiff: "",
      fileLoading: !!first,
    });
    if (first) {
      void selectCommitFile(first);
    }
  } catch (e: any) {
    setViewer({
      kind: "commit",
      tabId,
      sessionId: tab.sessionId,
      cwd,
      rev,
      detail: null,
      loading: false,
      selectedPath: null,
      fileDiff: "",
      fileLoading: false,
      error: String(e),
    });
  }
}

export async function selectCommitFile(path: string) {
  const v = viewer();
  if (v.kind !== "commit" || !v.detail) return;
  setViewer({ ...v, selectedPath: path, fileDiff: "", fileLoading: true });
  try {
    const diff = await api.gitCommitFileDiff(v.sessionId, v.cwd, v.rev, path);
    const cur = viewer();
    if (cur.kind !== "commit" || cur.rev !== v.rev || cur.selectedPath !== path) return;
    setViewer({ ...cur, fileDiff: diff || "(no changes for this file)", fileLoading: false });
  } catch (e: any) {
    const cur = viewer();
    if (cur.kind !== "commit") return;
    setViewer({ ...cur, fileDiff: String(e), fileLoading: false });
  }
}

// Keep types reachable from components
export { activeTab };
