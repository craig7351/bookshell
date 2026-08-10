import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { api, type Connection, type TabState, type UnlistenFn } from "../ipc/api";
import { connections } from "./connections";

export type TabStatus = "connecting" | "connected" | "disconnected" | "error";

export interface Tab {
  id: string;
  name: string;
  connectionId: string | null;
  sessionId: string | null;
  status: TabStatus;
  errorMessage?: string;
  color?: string | null;
  icon?: string | null;
  /** AI passthrough: when true, GUI hotkeys (except Ctrl+Shift+P) are not
   *  intercepted and flow through to the remote PTY. Single-modifier shell
   *  hotkeys (Ctrl+R, Shift+Tab, Alt+.) always pass through regardless. */
  passthrough: boolean;
  /** Manually-marked working directory. If set, `cd '<cwd>'` is sent
   *  ~500ms after a successful reconnect. Null means no cd happens. */
  cwd?: string | null;
  /** Persisted per-tab width (px) of the right-side Git panel. */
  gitWidth?: number | null;
  /** Id of the group this tab belongs to (see `groups`), or null/undefined
   *  when the tab is ungrouped. */
  groupId?: string | null;
  /** monotonic counter to nudge consumers when tab needs to refit */
  fitTick: number;
}

/** A collapsible category the user drags tabs into. Membership is by
 *  `Tab.groupId`; this record holds the group's display state. */
export interface TabGroup {
  id: string;
  name: string;
  collapsed: boolean;
  color?: string | null;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  groups: TabGroup[];
}

const [state, setState] = createStore<TabsState>({
  tabs: [],
  activeTabId: null,
  groups: [],
});

export const tabs = () => state.tabs;
export const activeTabId = () => state.activeTabId;
export const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId) ?? null;
export const tabGroups = () => state.groups;
export const groupById = (id: string): TabGroup | undefined =>
  state.groups.find((g) => g.id === id);

const [markCwdTabId, setMarkCwdTabId] = createSignal<string | null>(null);
export { markCwdTabId };
export function openMarkCwd(tabId: string) {
  setMarkCwdTabId(tabId);
}
export function closeMarkCwd() {
  setMarkCwdTabId(null);
}

const sessionUnlisteners = new Map<string, UnlistenFn[]>();
const dataListeners = new Map<string, (bytes: Uint8Array) => void>();
const closeListeners = new Map<string, (reason: string) => void>();
export function onTabData(tabId: string, cb: (bytes: Uint8Array) => void) {
  dataListeners.set(tabId, cb);
}
export function onTabClose(tabId: string, cb: (reason: string) => void) {
  closeListeners.set(tabId, cb);
}
let nextTabSeq = 1;
export function newTabId(): string {
  return `tab-${Date.now()}-${nextTabSeq++}`;
}

export function setActiveTab(id: string) {
  setState("activeTabId", id);
  const t = state.tabs.find((x) => x.id === id);
  if (t) {
    bumpFit(t.id);
    // If the newly active tab lives in a collapsed group, expand it so the
    // user can see where they are (e.g. after Ctrl+Tab cycling into it).
    if (t.groupId) {
      const gi = state.groups.findIndex((g) => g.id === t.groupId);
      if (gi >= 0 && state.groups[gi].collapsed) {
        setState("groups", gi, "collapsed", false);
      }
    }
  }
}

export function bumpFit(id: string) {
  setState(
    "tabs",
    (t) => t.id === id,
    "fitTick",
    (n) => n + 1,
  );
}

export function addTab(initial: Omit<Tab, "fitTick" | "passthrough"> & { passthrough?: boolean }): Tab {
  const tab: Tab = { passthrough: false, ...initial, fitTick: 0 };
  // Insert right after the current active tab so the new tab appears
  // next to where the user is, not at the bottom of the sidebar. Falls
  // back to appending when there is no active tab (first tab added).
  setState("tabs", (prev) => {
    const idx = prev.findIndex((t) => t.id === state.activeTabId);
    if (idx < 0) return [...prev, tab];
    return [...prev.slice(0, idx + 1), tab, ...prev.slice(idx + 1)];
  });
  setState("activeTabId", tab.id);
  return tab;
}

export function toggleTabPassthrough(id: string) {
  setState("tabs", (t) => t.id === id, "passthrough", (v) => !v);
}

export function isActiveTabPassthrough(): boolean {
  const t = state.tabs.find((x) => x.id === state.activeTabId);
  return !!t?.passthrough;
}

export function updateTab(id: string, patch: Partial<Tab>) {
  setState("tabs", (t) => t.id === id, patch);
}

export function renameTab(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  updateTab(id, { name: trimmed });
}

export function setTabColor(id: string, color: string | null) {
  updateTab(id, { color });
}

export function setTabIcon(id: string, icon: string | null) {
  updateTab(id, { icon });
}

export function setTabCwd(id: string, cwd: string | null) {
  updateTab(id, { cwd });
}

export function setTabGitWidth(id: string, width: number) {
  updateTab(id, { gitWidth: width });
}

export async function captureCwd(tabId: string): Promise<string | null> {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || !t.sessionId || t.status !== "connected") return null;

  const profile = connections().find((c) => c.id === t.connectionId);

  // Local PTY: we cannot run a side-channel probe without polluting the
  // visible terminal. Fall back to the saved 📍 cwd instead.
  if (profile?.kind === "local") return null;

  // SSH: run `pwd` on a fresh exec channel — never touches the PTY.
  // NOTE: this returns the SSH login default ($HOME), NOT the cwd of the
  // user's interactive PTY shell. Good enough for a periodic git refresh
  // hint; for auto-detect (user-initiated), use captureCwdViaPty instead.
  try {
    const result = await api.sessionExecCapture(t.sessionId, "pwd");
    return result.trim() || null;
  } catch {
    return null;
  }
}

type ShellKind = "posix" | "powershell" | "cmd";

function shellTypeForTab(tabId: string): ShellKind {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || !t.connectionId) return "posix";
  const profile = connections().find((c) => c.id === t.connectionId);
  if (!profile || profile.kind !== "local") return "posix";
  const shell = (profile.shell ?? "").toLowerCase();
  const base = shell.replace(/^.*[\\/]/, "").replace(/\.exe$/, "");
  if (base === "cmd") return "cmd";
  if (base === "powershell" || base === "pwsh") return "powershell";
  return "posix";
}

/** Probe the cwd of the interactive PTY shell by writing a sentinel pwd
 *  command to the PTY itself. The user briefly sees the command and its
 *  echo; that's the trade-off for getting the *actual* current directory
 *  (the exec-channel approach used by captureCwd returns $HOME for SSH
 *  and isn't usable for local PTYs at all).
 *
 *  Used by Mark cwd → Auto-detect, where the user explicitly asked for it. */
export async function captureCwdViaPty(tabId: string): Promise<string | null> {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || !t.sessionId || t.status !== "connected") return null;
  const sid = t.sessionId;
  const kind = shellTypeForTab(tabId);

  const nonce = Math.random().toString(36).slice(2, 10);
  const begin = `__BSH_CWD_B${nonce}__`;
  const end = `__BSH_CWD_E${nonce}__`;

  return await new Promise<string | null>(async (resolve) => {
    let unlisten: UnlistenFn | null = null;
    let buffer = "";
    let settled = false;
    const decoder = new TextDecoder();

    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      if (unlisten) unlisten();
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 3000);

    unlisten = await api.onSshData(sid, (bytes) => {
      buffer += decoder.decode(bytes, { stream: true });
      if (buffer.length > 65536) buffer = buffer.slice(-32768);

      // Shell echoes the typed command (markers appear with %s placeholder
      // or $(...) pieces) BEFORE printing the actual output. Pick the LAST
      // begin..end pair and validate it's a real path.
      const lastBegin = buffer.lastIndexOf(begin);
      if (lastBegin < 0) return;
      const e = buffer.indexOf(end, lastBegin + begin.length);
      if (e < 0) return;
      const candidate = buffer.slice(lastBegin + begin.length, e).trim();
      if (
        candidate.length > 0 &&
        !candidate.includes("%s") &&
        !candidate.includes("$(") &&
        !candidate.includes("(Get-Location)") &&
        !candidate.includes("%cd%")
      ) {
        finish(candidate);
      }
    });

    let cmd: string;
    if (kind === "powershell") {
      cmd = `"${begin}$((Get-Location).Path)${end}"\r`;
    } else if (kind === "cmd") {
      cmd = `echo ${begin}%cd%${end}\r`;
    } else {
      cmd = `printf '${begin}%s${end}\\n' "$(pwd)"\r`;
    }
    try {
      await api.sshWrite(sid, cmd);
    } catch {
      finish(null);
    }
  });
}

/** If the tab has a saved cwd and is connected, send `cd '<cwd>'\r`
 *  after a short delay so the remote shell has time to draw a prompt.
 *  No-op when cwd is unset. */
export async function restoreCwd(tabId: string) {
  const t0 = state.tabs.find((x) => x.id === tabId);
  if (!t0 || !t0.cwd || !t0.sessionId) return;
  const sid0 = t0.sessionId;
  await new Promise((r) => setTimeout(r, 500));
  // Re-check that the same session is still alive.
  const t1 = state.tabs.find((x) => x.id === tabId);
  if (!t1 || t1.sessionId !== sid0 || t1.status !== "connected") return;
  const escaped = t1.cwd!.replace(/'/g, "'\\''");
  try {
    await api.sshWrite(sid0, `cd '${escaped}'\r`);
  } catch (e) {
    console.warn("restoreCwd write", e);
  }
}

/** Move tab `sourceId` so it appears before `targetId`.
 *  If `targetId` is null, append to the end. */
export function reorderTabs(sourceId: string, targetId: string | null) {
  if (sourceId === targetId) return;
  setState("tabs", (prev) => {
    const arr = [...prev];
    const fromIdx = arr.findIndex((t) => t.id === sourceId);
    if (fromIdx < 0) return prev;
    const [moved] = arr.splice(fromIdx, 1);
    if (targetId === null) {
      arr.push(moved);
    } else {
      const toIdx = arr.findIndex((t) => t.id === targetId);
      if (toIdx < 0) {
        arr.push(moved);
      } else {
        arr.splice(toIdx, 0, moved);
      }
    }
    return arr;
  });
}

// ─── Tab groups ─────────────────────────────────────────────────────

let nextGroupSeq = 1;
function newGroupId(): string {
  return `grp-${Date.now()}-${nextGroupSeq++}`;
}

/** Move `sourceId` in the flat array to sit immediately after `anchorId`
 *  (or to the end when anchorId is null). Order among group members and the
 *  group's vertical position both derive from array order, so grouping ops
 *  reposition the tab to keep members visually clustered. */
function moveTabAfter(sourceId: string, anchorId: string | null) {
  setState("tabs", (prev) => {
    const arr = [...prev];
    const from = arr.findIndex((t) => t.id === sourceId);
    if (from < 0) return prev;
    const [moved] = arr.splice(from, 1);
    if (anchorId === null) {
      arr.push(moved);
      return arr;
    }
    const at = arr.findIndex((t) => t.id === anchorId);
    if (at < 0) arr.push(moved);
    else arr.splice(at + 1, 0, moved);
    return arr;
  });
}

/** Last tab id belonging to `groupId` in array order, or null if none. */
function lastMemberOf(groupId: string): string | null {
  let last: string | null = null;
  for (const t of state.tabs) if (t.groupId === groupId) last = t.id;
  return last;
}

/** Assign a tab to an existing group, clustering it after the group's last
 *  current member. */
export function assignTabToGroup(tabId: string, groupId: string) {
  if (!groupById(groupId)) return;
  const anchor = lastMemberOf(groupId);
  updateTab(tabId, { groupId });
  if (anchor && anchor !== tabId) moveTabAfter(tabId, anchor);
}

/** Create a new group containing `tabIds` (in the given order) and return its
 *  id. The group is positioned where the first member currently sits. */
export function createGroupWith(tabIds: string[], name?: string): string {
  const id = newGroupId();
  const n = state.groups.length + 1;
  setState("groups", (g) => [...g, { id, name: name ?? `Group ${n}`, collapsed: false, color: null }]);
  let anchor: string | null = null;
  for (const tid of tabIds) {
    updateTab(tid, { groupId: id });
    if (anchor) moveTabAfter(tid, anchor);
    anchor = tid;
  }
  return id;
}

/** Remove a tab from its group (keeps the tab, keeps the group). Deletes the
 *  group if it becomes empty. */
export function removeTabFromGroup(tabId: string) {
  const t = state.tabs.find((x) => x.id === tabId);
  const gid = t?.groupId ?? null;
  updateTab(tabId, { groupId: null });
  if (gid) pruneGroupIfEmpty(gid);
}

/** Dissolve a group: all members become ungrouped, the group record is
 *  removed. Tabs keep their positions. */
export function ungroup(groupId: string) {
  setState("tabs", (t) => t.groupId === groupId, "groupId", null);
  setState("groups", (g) => g.filter((x) => x.id !== groupId));
}

export function toggleGroupCollapsed(groupId: string) {
  const i = state.groups.findIndex((g) => g.id === groupId);
  if (i >= 0) setState("groups", i, "collapsed", (v) => !v);
}

export function renameGroup(groupId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const i = state.groups.findIndex((g) => g.id === groupId);
  if (i >= 0) setState("groups", i, "name", trimmed);
}

export function setGroupColor(groupId: string, color: string | null) {
  const i = state.groups.findIndex((g) => g.id === groupId);
  if (i >= 0) setState("groups", i, "color", color);
}

/** Drop-handler entry point used by the tab bar drag. `kind`:
 *   - "before": reorder source before target; source joins target's group
 *   - "group":  source joins target's group (creating one if target is
 *               ungrouped and is itself a tab)
 *   - "group-header": source joins the group whose header was hit
 *   - "end":    move to end, ungrouped */
export function dropTab(
  sourceId: string,
  drop: { kind: "before" | "group" | "end" | "group-header"; targetId: string | null },
) {
  if (sourceId === drop.targetId) return;
  const prevGroup = state.tabs.find((t) => t.id === sourceId)?.groupId ?? null;

  if (drop.kind === "end") {
    updateTab(sourceId, { groupId: null });
    reorderTabs(sourceId, null);
  } else if (drop.kind === "group-header" && drop.targetId) {
    assignTabToGroup(sourceId, drop.targetId);
  } else if (drop.kind === "group" && drop.targetId) {
    const target = state.tabs.find((t) => t.id === drop.targetId);
    if (!target) return;
    if (target.groupId) {
      assignTabToGroup(sourceId, target.groupId);
    } else {
      createGroupWith([target.id, sourceId]);
    }
  } else if (drop.kind === "before" && drop.targetId) {
    const target = state.tabs.find((t) => t.id === drop.targetId);
    updateTab(sourceId, { groupId: target?.groupId ?? null });
    reorderTabs(sourceId, drop.targetId);
  }

  if (prevGroup) pruneGroupIfEmpty(prevGroup);
}

/** Remove a group record once it has no members left. */
function pruneGroupIfEmpty(groupId: string) {
  const stillUsed = state.tabs.some((t) => t.groupId === groupId);
  if (!stillUsed) setState("groups", (g) => g.filter((x) => x.id !== groupId));
}

export async function closeTab(id: string) {
  const t = state.tabs.find((x) => x.id === id);
  if (t?.sessionId) {
    await api.sshDisconnect(t.sessionId).catch(() => {});
  }
  const ul = sessionUnlisteners.get(id);
  ul?.forEach((u) => u());
  sessionUnlisteners.delete(id);
  dataListeners.delete(id);
  closeListeners.delete(id);

  // Capture the closed tab's index BEFORE removal so we can pick the
  // right-hand neighbor (falling back to the left if it was the last one).
  const closedIdx = state.tabs.findIndex((x) => x.id === id);
  const closedGroup = state.tabs[closedIdx]?.groupId ?? null;
  setState("tabs", (prev) => prev.filter((x) => x.id !== id));
  if (closedGroup) pruneGroupIfEmpty(closedGroup);
  if (state.activeTabId === id) {
    const remaining = state.tabs;
    if (remaining.length === 0) {
      setState("activeTabId", null);
    } else {
      const nextIdx = Math.min(closedIdx, remaining.length - 1);
      setState("activeTabId", remaining[nextIdx].id);
    }
  }
}

/** Connect a tab using a connection profile + override password (e.g. fresh prompt). */
export async function connectTab(
  tabId: string,
  args: {
    host: string;
    port: number;
    user: string;
    password: string;
    cols: number;
    rows: number;
  },
) {
  updateTab(tabId, { status: "connecting", errorMessage: undefined });
  try {
    const sid = await api.sshConnect(args);
    updateTab(tabId, { status: "connected", sessionId: sid });

    const ulData = await api.onSshData(sid, (bytes) => {
      dataListeners.get(tabId)?.(bytes);
    });
    const ulClose = await api.onSshClose(sid, (reason) => {
      updateTab(tabId, { status: "disconnected", errorMessage: reason });
      closeListeners.get(tabId)?.(reason);
    });
    sessionUnlisteners.set(tabId, [ulData, ulClose]);
  } catch (e: any) {
    updateTab(tabId, { status: "error", errorMessage: String(e) });
    throw e;
  }
}

/** Spawn a local PTY in this tab. Mirrors connectTab's bookkeeping but
 *  goes through local_open_pty instead of ssh_connect. */
export async function connectTabLocal(
  tabId: string,
  args: { shell?: string | null; cwd?: string | null; cols: number; rows: number },
) {
  updateTab(tabId, { status: "connecting", errorMessage: undefined });
  try {
    const sid = await api.localOpenPty(args);
    updateTab(tabId, { status: "connected", sessionId: sid });

    const ulData = await api.onSshData(sid, (bytes) => {
      dataListeners.get(tabId)?.(bytes);
    });
    const ulClose = await api.onSshClose(sid, (reason) => {
      updateTab(tabId, { status: "disconnected", errorMessage: reason });
      closeListeners.get(tabId)?.(reason);
    });
    sessionUnlisteners.set(tabId, [ulData, ulClose]);
  } catch (e: any) {
    updateTab(tabId, { status: "error", errorMessage: String(e) });
    throw e;
  }
}

export async function disconnectTab(tabId: string) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (t?.sessionId) {
    await api.sshDisconnect(t.sessionId).catch(() => {});
  }
}

/** Reconnect a previously-restored or disconnected tab using its profile.
 *  If the profile is missing or has no saved password, returns false so
 *  the caller can prompt for credentials. */
export async function reconnectTabFromProfile(tabId: string): Promise<boolean> {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || !t.connectionId) return false;
  const profile = connections().find((c) => c.id === t.connectionId);
  if (!profile) return false;
  if (profile.kind === "local") {
    // Local PTYs always reconnect — no credentials to wait on. Prefer the
    // tab's 📍 marked cwd; fall back to the profile's default cwd. The PTY
    // spawns straight into that directory so we don't need a follow-up cd.
    await connectTabLocal(tabId, {
      shell: profile.shell ?? null,
      cwd: t.cwd ?? profile.cwd ?? null,
      cols: 80,
      rows: 24,
    });
    return true;
  }
  if (!profile.password || profile.password.length === 0) return false;
  await connectTab(tabId, {
    host: profile.host,
    port: profile.port,
    user: profile.user,
    password: profile.password,
    cols: 80,
    rows: 24,
  });
  // Fire-and-forget: only sends `cd` when a cwd was previously marked.
  restoreCwd(tabId).catch(() => {});
  return true;
}

// ─── Persistence ────────────────────────────────────────────────────

let saveTimer: number | undefined;
let restoring = true;

function snapshot(): {
  tabs: TabState[];
  active_tab_id: string | null;
  groups: { id: string; name: string; collapsed: boolean; color: string | null }[];
} {
  return {
    tabs: state.tabs.map((t) => ({
      id: t.id,
      name: t.name,
      connection_id: t.connectionId,
      color: t.color ?? null,
      icon: t.icon ?? null,
      passthrough: t.passthrough,
      cwd: t.cwd ?? null,
      git_width: t.gitWidth ?? null,
      group_id: t.groupId ?? null,
    })),
    active_tab_id: state.activeTabId,
    groups: state.groups.map((g) => ({
      id: g.id,
      name: g.name,
      collapsed: g.collapsed,
      color: g.color ?? null,
    })),
  };
}

function scheduleSave() {
  if (restoring) return;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.tabsSaveState(snapshot()).catch((e) => console.warn("tabs save", e));
    saveTimer = undefined;
  }, 400);
}

// Wrapped in createRoot so this app-lifetime effect has an owner; a bare
// module-level createEffect is owner-less and logs "computations created
// outside a createRoot or render will never be disposed".
createRoot(() => {
  createEffect(() => {
    // Track each persisted field. Solid's reactivity collects deps automatically.
    state.tabs.forEach((t) => {
      void t.id;
      void t.name;
      void t.connectionId;
      void t.color;
      void t.icon;
      void t.passthrough;
      void t.cwd;
      void t.gitWidth;
      void t.groupId;
    });
    state.groups.forEach((g) => {
      void g.id;
      void g.name;
      void g.collapsed;
      void g.color;
    });
    void state.activeTabId;
    scheduleSave();
  });
});

/** Restore tabs from disk. Each restored tab starts disconnected; the caller
 *  decides which ones to auto-reconnect (typically those whose profile has a
 *  saved password). Returns the list of restored tab IDs in original order. */
export async function restoreTabs(): Promise<string[] | null> {
  let file;
  try {
    file = await api.tabsLoadState();
  } catch (e) {
    console.warn("tabs restore", e);
    restoring = false;
    return null;
  }
  if (!file.tabs || file.tabs.length === 0) {
    restoring = false;
    return [];
  }
  setState("tabs", () =>
    file.tabs.map((t) => ({
      id: t.id,
      name: t.name,
      connectionId: t.connection_id,
      sessionId: null,
      status: "disconnected" as const,
      color: t.color ?? null,
      icon: t.icon ?? null,
      passthrough: t.passthrough,
      cwd: t.cwd ?? null,
      gitWidth: t.git_width ?? null,
      groupId: t.group_id ?? null,
      fitTick: 0,
    })),
  );
  // Restore groups, dropping any that ended up with no members (defensive
  // against a hand-edited or partially-written tabs file).
  const restoredGroups = (file.groups ?? []).filter((g) =>
    file.tabs.some((t) => t.group_id === g.id),
  );
  setState("groups", () =>
    restoredGroups.map((g) => ({
      id: g.id,
      name: g.name,
      collapsed: g.collapsed ?? false,
      color: g.color ?? null,
    })),
  );
  setState(
    "activeTabId",
    file.active_tab_id && file.tabs.some((t) => t.id === file.active_tab_id)
      ? file.active_tab_id
      : file.tabs[0].id,
  );
  restoring = false;
  return file.tabs.map((t) => t.id);
}

export function flushPersistedState() {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  api.tabsSaveState(snapshot()).catch(() => {});
}

export type { Connection };
