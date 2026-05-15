import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { ButtonEditor } from "./components/ButtonEditor";
import { CommandBar } from "./components/CommandBar";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { GitPanel } from "./components/GitPanel";
import { LogViewer } from "./components/LogViewer";
import { SideTerminalPanel } from "./components/SideTerminal";
import { isSideTermOpen, toggleSideTerm } from "./stores/sideTerm";
import { MarkCwdDialog } from "./components/MarkCwdDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/Terminal";
import { gitWidth, isGitOpen, setGitWidth, toggleGit } from "./stores/git";
import { cycleLayout, layoutMode, setLayout } from "./stores/layout";
import { api, type Connection } from "./ipc/api";
import { loadConnections } from "./stores/connections";
import { loadGeneral } from "./stores/general";
import { closeSearch, openSearch, searchTabId } from "./stores/search";
import { actionFor } from "./stores/shortcuts";
import { C } from "./theme";
import {
  activeTab,
  activeTabId,
  addTab,
  closeMarkCwd,
  closeTab,
  connectTab,
  connectTabLocal,
  flushPersistedState,
  isActiveTabPassthrough,
  markCwdTabId,
  newTabId,
  reconnectTabFromProfile,
  reorderTabs,
  restoreTabs,
  setActiveTab,
  tabs,
  toggleTabPassthrough,
} from "./stores/tabs";

const LAYOUT_LABEL: Record<string, string> = {
  horizontal: "↔ Horizontal",
  vertical: "↕ Vertical",
  "right-split": "⊞ Right",
};

export default function App() {
  const [showDialog, setShowDialog] = createSignal(false);
  const [showButtonEditor, setShowButtonEditor] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [showLogs, setShowLogs] = createSignal(false);
  const [colDragging, setColDragging] = createSignal(false);
  const [appVersion, setAppVersion] = createSignal("");

  function startColDrag(ev: MouseEvent) {
    ev.preventDefault();
    setColDragging(true);
    const startX = ev.clientX;
    const startW = gitWidth();
    const onMove = (e: MouseEvent) => setGitWidth(startW + (startX - e.clientX));
    const onUp = () => {
      setColDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Track previous tab statuses so we can detect the "just became connected"
  // transition. Auto-open Git view + side terminal ONLY for restored tabs that
  // already had a 📍 mark cwd — opening Git view fires a PTY sentinel probe
  // that prints a marker line to the terminal, which is too noisy to do
  // automatically on every fresh connect or for tabs the user never marked.
  const prevStatus = new Map<string, string>();
  const restoredTabIds = new Set<string>();

  createEffect(() => {
    for (const tab of tabs()) {
      const prev = prevStatus.get(tab.id);
      if (tab.status === "connected" && prev !== "connected") {
        const id = tab.id;
        const shouldAutoOpen = restoredTabIds.has(id) && !!tab.cwd;
        if (shouldAutoOpen) {
          setTimeout(() => {
            // Saved cwd is trusted — skip PTY probe, just refresh git with it.
            if (!isGitOpen(id)) toggleGit(id, { probe: false });
            if (!isSideTermOpen(id)) toggleSideTerm(id);
            setLayout("right-split");
          }, 1000);
        }
      }
      prevStatus.set(tab.id, tab.status);
    }
    // Remove stale entries for closed tabs.
    for (const id of [...prevStatus.keys()]) {
      if (!tabs().find((t) => t.id === id)) prevStatus.delete(id);
    }
  });

  onMount(() => {
    getVersion().then(setAppVersion).catch(() => {});

    // Connections must be loaded before tab restore so reconnect can find profiles.
    (async () => {
      await Promise.all([loadConnections(), loadGeneral()]);
      const restoredIds = await restoreTabs();
      if (restoredIds && restoredIds.length > 0) {
        // Mark these as restored so the createEffect above will auto-open
        // Git view + side terminal for them (only if they have a saved cwd).
        for (const id of restoredIds) restoredTabIds.add(id);
        // Give the freshly-mounted xterm instances a tick to settle.
        await new Promise((r) => setTimeout(r, 80));
        for (const id of restoredIds) {
          // reconnectTabFromProfile auto-connects only when the profile has a
          // saved password; otherwise the tab stays disconnected and the
          // TerminalView's reconnect overlay handles it.
          reconnectTabFromProfile(id).catch((e) =>
            console.warn(`auto-reconnect ${id} failed`, e),
          );
        }
      }
    })();

    window.addEventListener("beforeunload", () => flushPersistedState());

    // Tab cycle / move shortcuts (user-customizable; see stores/shortcuts.ts).
    // Registered in the capture phase so it fires before xterm's textarea
    // handler — otherwise xterm swallows the event (translates it to a PTY
    // escape sequence) and the tab bar only responds after the user clicks
    // the sidebar to move focus. Skipped when focus is in a real text input /
    // passthrough mode so the key can still extend selection / be forwarded
    // to the remote agent.
    window.addEventListener(
      "keydown",
      (e) => {
        const action = actionFor(e);
        if (!action) return;
        if (isActiveTabPassthrough()) return;
        // xterm's own input is a hidden <textarea>, so we can't blanket-skip
        // text inputs — instead, allow if focus is inside an .xterm container,
        // and skip only "real" inputs (search box, rename field, dialogs).
        const tgt = e.target as HTMLElement | null;
        if (tgt && !tgt.closest(".xterm")) {
          const tag = tgt.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tgt.isContentEditable) return;
        }
        const list = tabs();
        if (list.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const goPrev = action === "prevTab" || action === "moveTabPrev";
        const idx = list.findIndex((t) => t.id === activeTabId());
        if (action === "moveTabPrev" || action === "moveTabNext") {
          if (idx < 0) return;
          let target: string | null;
          if (goPrev) {
            target = idx === 0 ? null : list[idx - 1].id;
          } else {
            if (idx === list.length - 1) target = list[0].id;
            else if (idx + 2 >= list.length) target = null;
            else target = list[idx + 2].id;
          }
          reorderTabs(list[idx].id, target);
          return;
        }
        const next = goPrev
          ? (idx - 1 + list.length) % list.length
          : (idx + 1) % list.length;
        setActiveTab(list[next].id);
      },
      true,
    );

    window.addEventListener("keydown", (e) => {
      // Ctrl+Shift+P: ALWAYS available — toggles AI passthrough on active tab.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        const id = activeTabId();
        if (id) toggleTabPassthrough(id);
        return;
      }

      // In passthrough mode, all other GUI hotkeys are released so the remote
      // agent (Claude Code, etc.) can use them.
      if (isActiveTabPassthrough()) return;

      // Ctrl+Shift+T: new tab
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowDialog(true);
      }
      // Ctrl+Shift+W: close active tab (Ctrl+W is reserved for shell ^W)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        const id = activeTabId();
        if (id) closeTab(id);
      }
      // Ctrl+Tab / Ctrl+Shift+Tab: cycle tabs
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const list = tabs();
        if (list.length > 1) {
          const idx = list.findIndex((t) => t.id === activeTabId());
          const next = e.shiftKey
            ? (idx - 1 + list.length) % list.length
            : (idx + 1) % list.length;
          setActiveTab(list[next].id);
        }
      }
      // Ctrl+F / Ctrl+Shift+F: open search on active tab.
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") {
        const id = activeTabId();
        if (id) {
          e.preventDefault();
          if (searchTabId() === id) closeSearch();
          else openSearch(id);
        }
      }
      // Ctrl+1..9: jump to tab by index
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        const list = tabs();
        if (idx < list.length) {
          e.preventDefault();
          setActiveTab(list[idx].id);
        }
      }
    });
  });

  async function startConnection(conn: Connection, password: string) {
    setShowDialog(false);
    const tabName =
      conn.name ||
      (conn.kind === "local" ? "local" : `${conn.user}@${conn.host}`);
    const tab = addTab({
      id: newTabId(),
      name: tabName,
      connectionId: conn.id,
      sessionId: null,
      status: "connecting",
      color: conn.color ?? null,
      icon: conn.icon ?? null,
    });

    // The terminal needs a moment to mount and report its size.
    await new Promise((r) => setTimeout(r, 50));

    try {
      if (conn.kind === "local") {
        await connectTabLocal(tab.id, {
          shell: conn.shell ?? null,
          cwd: conn.cwd ?? null,
          cols: 80,
          rows: 24,
        });
      } else {
        await connectTab(tab.id, {
          host: conn.host,
          port: conn.port,
          user: conn.user,
          password,
          cols: 80,
          rows: 24,
        });
      }
    } catch (e) {
      console.error("connect failed", e);
    }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={headerStyle}>
        {/* macOS traffic lights */}
        <div style={{ display: "flex", gap: "6px", "align-items": "center", "flex-shrink": 0 }}>
          <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tRed }} />
          <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tYellow }} />
          <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tGreen }} />
        </div>

        <strong style={{ color: C.accent, "font-size": "13px", "letter-spacing": "0.04em" }}>BOOKSHELL</strong>

        <Show when={activeTab()}>
          {(t) => (
            <span style={{ "font-size": "12px", color: C.text2, display: "flex", "align-items": "center", gap: "6px" }}>
              <span style={{ color: t().status === "connected" ? C.green : C.yellow }}>
                {t().status === "connected" ? "●" : "◐"} {t().status}
              </span>
              <Show when={t().errorMessage}>
                <span style={{ color: C.red }}>{t().errorMessage}</span>
              </Show>
              <Show when={t().passthrough}>
                <span
                  title="AI passthrough on (Ctrl+Shift+P to disable)"
                  style={{
                    background: C.purple,
                    color: "#fff",
                    padding: "1px 7px",
                    "border-radius": "10px",
                    "font-size": "11px",
                    "font-weight": 600,
                  }}
                >
                  🤖 passthrough
                </span>
              </Show>
            </span>
          )}
        </Show>

        {/* right-side toolbar */}
        <div style={{ "margin-left": "auto", display: "flex", gap: "4px", "align-items": "center" }}>
          <Show when={activeTabId() && (isGitOpen(activeTabId()!) || isSideTermOpen(activeTabId()!))}>
            <button onClick={cycleLayout} style={toolBtn} title="Cycle layout">
              {LAYOUT_LABEL[layoutMode()]}
            </button>
          </Show>
          <button
            onClick={() => { const id = activeTabId(); if (id) toggleSideTerm(id); }}
            style={{
              ...toolBtn,
              background: activeTabId() && isSideTermOpen(activeTabId()!) ? C.accentBg : "transparent",
              color: activeTabId() && isSideTermOpen(activeTabId()!) ? C.accent : C.text2,
              border: `1px solid ${activeTabId() && isSideTermOpen(activeTabId()!) ? C.accentBdr : C.border}`,
            }}
            title="Side terminal (📍 cwd if marked)"
            disabled={!activeTabId()}
          >
            📟 Terminal
          </button>
          <button
            onClick={() => { const id = activeTabId(); if (id) toggleGit(id); }}
            style={{
              ...toolBtn,
              background: activeTabId() && isGitOpen(activeTabId()!) ? C.accentBg : "transparent",
              color: activeTabId() && isGitOpen(activeTabId()!) ? C.accent : C.text2,
              border: `1px solid ${activeTabId() && isGitOpen(activeTabId()!) ? C.accentBdr : C.border}`,
            }}
            title="Toggle git view"
            disabled={!activeTabId()}
          >
            🌿 Git
          </button>
          <button
            onClick={() => {
              const id = activeTabId();
              if (!id) return;
              if (searchTabId() === id) closeSearch();
              else openSearch(id);
            }}
            style={{ ...toolBtn, color: C.text2, border: `1px solid ${C.border}` }}
            title="Search (Ctrl+F)"
            disabled={!activeTabId()}
          >
            🔍 Find
          </button>
          <button
            onClick={() => setShowLogs(true)}
            style={{ ...toolBtn, color: C.text2, border: `1px solid ${C.border}` }}
            title="Open log viewer"
          >
            📜 Logs
          </button>
          <div style={{ width: "1px", height: "16px", background: C.border, margin: "0 2px" }} />
          <button onClick={() => setShowDialog(true)} style={btnPrimary}>
            + Connect
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{ ...toolBtn, color: C.text2, border: `1px solid ${C.border}`, "font-size": "15px", padding: "3px 9px" }}
            title="Settings"
          >
            ⚙
          </button>
          <Show when={appVersion()}>
            <span style={{ "font-size": "11px", color: C.text3, "letter-spacing": "0.02em" }}>
              v{appVersion()}
            </span>
          </Show>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, "min-height": 0 }}>
        <TabBar onNew={() => setShowDialog(true)} />
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0 }}>
          <div style={{
            flex: 1,
            display: "flex",
            "min-height": 0,
            "flex-direction": layoutMode() === "vertical" ? "column" : "row",
          }}>
            <div style={{ flex: 1, position: "relative", "min-width": 0, "min-height": 0 }}>
              <Show
                when={tabs().length > 0}
                fallback={
                  <div style={emptyStyle}>
                    <div>No active session</div>
                    <button onClick={() => setShowDialog(true)} style={btnPrimary}>+ Connect</button>
                  </div>
                }
              >
                <For each={tabs()}>
                  {(t) => <TerminalView tab={t} active={t.id === activeTabId()} />}
                </For>
              </Show>
            </div>

            {/* horizontal / vertical: panels render standalone */}
            <Show when={layoutMode() !== "right-split"}>
              <Show when={activeTabId() && isGitOpen(activeTabId()!)}>
                <GitPanel />
              </Show>
              <Show when={activeTabId() && isSideTermOpen(activeTabId()!)}>
                <SideTerminalPanel />
              </Show>
            </Show>

            {/* right-split: panels share a right column */}
            <Show when={layoutMode() === "right-split" && activeTabId() && (isGitOpen(activeTabId()!) || isSideTermOpen(activeTabId()!))}>
              {/* left-edge drag handle for column width */}
              <div
                onMouseDown={startColDrag}
                style={{
                  width: "4px",
                  cursor: "col-resize",
                  background: colDragging() ? C.accent : "transparent",
                  "border-right": `1px solid ${C.border}`,
                  "flex-shrink": "0",
                  transition: "background 0.15s",
                }}
                title="Drag to resize column"
              />
              <div style={{
                width: `${gitWidth()}px`,
                display: "flex",
                "flex-direction": "column",
                "flex-shrink": "0",
                "min-height": 0,
                background: C.bg2,
                "border-left": `1px solid ${C.border}`,
              }}>
                <Show when={activeTabId() && isGitOpen(activeTabId()!)}>
                  <GitPanel />
                </Show>
                <Show when={activeTabId() && isSideTermOpen(activeTabId()!)}>
                  <SideTerminalPanel />
                </Show>
              </div>
            </Show>
          </div>
          <CommandBar onEdit={() => setShowButtonEditor(true)} />
        </div>
      </div>

      <Show when={showDialog()}>
        <ConnectionDialog
          onConnect={startConnection}
          onClose={() => setShowDialog(false)}
        />
      </Show>
      <Show when={showButtonEditor()}>
        <ButtonEditor onClose={() => setShowButtonEditor(false)} />
      </Show>
      <Show when={showSettings()}>
        <SettingsDialog onClose={() => setShowSettings(false)} />
      </Show>
      <Show when={markCwdTabId()}>
        {(id) => <MarkCwdDialog tabId={id()} onClose={closeMarkCwd} />}
      </Show>
      <Show when={showLogs()}>
        <LogViewer onClose={() => setShowLogs(false)} />
      </Show>
    </div>
  );
}

const headerStyle = {
  padding: "7px 12px",
  "background-color": C.bg2,
  "border-bottom": `1px solid ${C.border}`,
  display: "flex",
  gap: "8px",
  "align-items": "center",
  "flex-shrink": 0,
} as const;

const emptyStyle = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "justify-content": "center",
  height: "100%",
  gap: "16px",
  color: C.text3,
} as const;

/** Small pill-shaped toolbar button */
const toolBtn = {
  background: "transparent",
  color: C.text2,
  border: `1px solid ${C.border}`,
  padding: "3px 10px",
  "border-radius": "6px",
  "font-size": "12px",
  cursor: "pointer",
  "font-weight": 500,
  "white-space": "nowrap",
} as const;

const btnPrimary = {
  background: C.accent,
  color: "#fff",
  border: "none",
  padding: "4px 13px",
  "border-radius": "6px",
  "font-size": "12px",
  cursor: "pointer",
  "font-weight": 600,
} as const;
