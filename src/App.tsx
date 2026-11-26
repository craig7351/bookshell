import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CommandBar } from "./components/CommandBar";
import type { ClaudeBinding } from "./components/ClaudeChatPanel";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { FileBrowser } from "./components/FileBrowser";
import { GitPanel } from "./components/GitPanel";
import { NotePanel } from "./components/NotePanel";
import { SideTerminalPanel } from "./components/SideTerminal";
import { StatusFooter } from "./components/StatusFooter";
import { initDiagnostics } from "./stores/diagnostics";
import { isSideTermOpen, toggleSideTerm } from "./stores/sideTerm";
import { MarkCwdDialog } from "./components/MarkCwdDialog";
import { SettingsDialog, type PaneId } from "./components/SettingsDialog";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/Terminal";
import { filesOpen, filesWidth, setFilesWidth, toggleFiles } from "./stores/files";
import { gitWidth, isGitOpen, setGitWidth, toggleGit } from "./stores/git";
import { cycleLayout, layoutMode, setLayout } from "./stores/layout";
import { api, type Connection } from "./ipc/api";
import { connectionUnavailable, isMac, loadConnections } from "./stores/connections";
import { general, loadGeneral } from "./stores/general";
import { closeSearch, openSearch, searchTabId } from "./stores/search";
import { actionFor } from "./stores/shortcuts";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./components/ui/Kbd";
import { Notice } from "./components/ui/Notice";
import { StatusDot } from "./components/ui/StatusDot";
import { button, C, H, R, S, SH, T } from "./theme";
import {
  activeTab,
  activeTabId,
  addTab,
  closeMarkCwd,
  closeTab,
  connectTab,
  connectTabLocal,
  connectTabSerial,
  connectTabTelnet,
  flushTabsBeforeClose,
  isActiveTabPassthrough,
  markCwdTabId,
  newTabId,
  reconnectTabFromProfile,
  reorderTabs,
  restoreTabs,
  setActiveTab,
  supportsShellTools,
  tabConnectionKind,
  tabs,
  toggleTabPassthrough,
  type Tab,
} from "./stores/tabs";

const ClaudeChatPanel = lazy(() => import("./components/ClaudeChatPanel"));

const LAYOUT_LABEL: Record<string, string> = {
  horizontal: "Horizontal",
  vertical: "Vertical",
  "right-split": "Right",
};

const LAYOUT_ICON: Record<string, IconName> = {
  horizontal: "columns-2",
  vertical: "rows-2",
  "right-split": "panel-right",
};

export default function App() {
  const tabsTop = () => general().tab_position === "top";
  const shellTabId = () => {
    const tab = activeTab();
    return tab && supportsShellTools(tab) ? tab.id : null;
  };
  const [showDialog, setShowDialog] = createSignal(false);
  // One Settings dialog, opened on a named pane. The CommandBar pencil used
  // to open a separate ButtonEditor modal; it now lands on the same dialog's
  // "buttons" pane, which is where reordering lives.
  const [settingsPane, setSettingsPane] = createSignal<PaneId | null>(null);
  const [colDragging, setColDragging] = createSignal(false);
  const [filesColDragging, setFilesColDragging] = createSignal(false);
  const [noteOpen, setNoteOpen] = createSignal(false);
  const [chatOpen, setChatOpen] = createSignal(false);
  const [closeSaveError, setCloseSaveError] = createSignal(false);
  const chatBindings = new WeakMap<Tab, ClaudeBinding>();
  const chatAvailable = () => {
    const tab = activeTab();
    const kind = tab && tabConnectionKind(tab);
    return kind === "local" || kind === "ssh";
  };
  const chatTab = () => chatOpen() && chatAvailable() ? activeTab() : null;
  const noteTab = () => noteOpen() ? activeTab() : null;
  const panelsOpen = () => {
    const id = shellTabId();
    return !!noteTab() || (!!id && (isGitOpen(id) || isSideTermOpen(id) || filesOpen()));
  };

  function toggleNote() {
    if (!activeTab()) return;
    if (!noteOpen()) setLayout("right-split");
    setNoteOpen(!noteOpen());
  }

  function startColDrag(ev: MouseEvent) {
    ev.preventDefault();
    setColDragging(true);
    document.body.classList.add("bs-dragging");
    const startX = ev.clientX;
    const startW = gitWidth();
    const onMove = (e: MouseEvent) => setGitWidth(startW + (startX - e.clientX));
    const onUp = () => {
      setColDragging(false);
      document.body.classList.remove("bs-dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /** Resize handle for the inline FileBrowser panel (horizontal/vertical
   *  layouts only — right-split shares the Git column width). */
  function startFilesColDrag(ev: MouseEvent) {
    ev.preventDefault();
    setFilesColDragging(true);
    document.body.classList.add("bs-dragging");
    const startX = ev.clientX;
    const startW = filesWidth();
    const onMove = (e: MouseEvent) => setFilesWidth(startW + (startX - e.clientX));
    const onUp = () => {
      setFilesColDragging(false);
      document.body.classList.remove("bs-dragging");
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
        const shouldAutoOpen = restoredTabIds.has(id) && !!tab.cwd && supportsShellTools(tab);
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
    initDiagnostics();

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
          const tab = tabs().find((tab) => tab.id === id);
          if (tab && !supportsShellTools(tab)) continue;
          // Restore local shells and SSH profiles with saved credentials.
          reconnectTabFromProfile(id).catch((e) =>
            console.warn(`auto-reconnect ${id} failed`, e),
          );
        }
      }
    })();

    let closing = false;
    const fallbackSave = () => {
      if (!closing) void flushTabsBeforeClose().catch((error) => console.warn("tabs save on unload", error));
    };
    window.addEventListener("beforeunload", fallbackSave);
    // An unload handler can't wait for IPC. Hold the native window open until
    // the last edit has finished saving, including any queued autosave.
    const closeListener = isTauri() ? getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) {
        event.preventDefault();
        return;
      }
      closing = true;
      setCloseSaveError(false);
      try {
        await flushTabsBeforeClose();
      } catch (error) {
        event.preventDefault();
        console.warn("tabs save before closing", error);
        setCloseSaveError(true);
        closing = false;
      }
    }) : undefined;
    void closeListener?.catch((error) => console.warn("listen for window close", error));
    onCleanup(() => {
      window.removeEventListener("beforeunload", fallbackSave);
      void closeListener?.then((unlisten) => unlisten(), () => {});
    });

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
          setChatOpen(false);
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
    if (connectionUnavailable(conn)) return;
    setShowDialog(false);
    const tabName =
      conn.name ||
      (conn.kind === "serial" ? conn.serial?.port || "Serial (COM)"
        : conn.kind === "local" ? "local"
        : conn.kind === "telnet" ? conn.host : `${conn.user}@${conn.host}`);
    const tab = addTab({
      id: newTabId(),
      name: tabName,
      connectionId: conn.id,
      kind: conn.kind,
      sessionId: null,
      status: "connecting",
      color: conn.color ?? null,
      icon: conn.icon ?? null,
    });

    // The terminal needs a moment to mount and report its size.
    await new Promise((r) => setTimeout(r, 50));

    try {
      if (conn.kind === "serial") {
        await connectTabSerial(tab.id, conn.serial);
      } else if (conn.kind === "telnet") {
        await connectTabTelnet(tab.id, conn.host, conn.port);
      } else if (conn.kind === "local") {
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
        {/* Decorative macOS traffic lights — only render on macOS, since the
         *  OS chrome there visually expects them. Drawing fake lights on
         *  Windows / Linux looked off because the real window controls are
         *  still in the native top-right (or different style). */}
        <Show when={isMac()}>
          <div style={{ display: "flex", gap: "6px", "align-items": "center", "flex-shrink": 0 }}>
            <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tRed }} />
            <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tYellow }} />
            <div style={{ width: "12px", height: "12px", "border-radius": "50%", background: C.tGreen }} />
          </div>
        </Show>

        <Show when={tabsTop()}>
          <TabBar orientation="horizontal" onNew={() => setShowDialog(true)} />
        </Show>

        <Show when={activeTab()}>
          {(t) => (
            <span class="bs-header-tab-status" style={{ ...T[12], color: C.text2, display: "flex", "align-items": "center", gap: S[1.5], "min-width": 0 }}>
              {/* "connected" is the steady state — drop the text so the
               *  header stops yelling "everything is fine" on every active
               *  tab. Show transient/broken states with a dot + label. */}
              <Show when={t().status !== "connected"}>
                <span
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: S[1.5],
                    color: t().status === "error" ? C.red : C.text3,
                    "font-weight": t().status === "error" ? 600 : 400,
                  }}
                >
                  <StatusDot state={t().status} />
                  {t().status}
                </span>
              </Show>
              <Show when={t().errorMessage}>
                <span title={t().errorMessage} style={{ color: C.red, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  {t().errorMessage}
                </span>
              </Show>
              <Show when={t().passthrough}>
                <span
                  class="bs-tip"
                  data-tip="AI passthrough on (Ctrl+Shift+P to disable)"
                  style={passthroughBadge}
                >
                  <Icon name="bot" size={12} />
                  passthrough
                </span>
              </Show>
            </span>
          )}
        </Show>

        {/* right-side toolbar */}
        <div style={{ "margin-left": "auto", display: "flex", gap: S[1], "align-items": "center" }}>
          <Show when={panelsOpen()}>
            <button class="bs-btn bs-tip" data-tip="Cycle layout" aria-label={`Cycle layout (${LAYOUT_LABEL[layoutMode()]})`} onClick={cycleLayout} style={toolBtn}>
              <Icon name={LAYOUT_ICON[layoutMode()]} size={14} />
              <span class="bs-panel-button-label">{LAYOUT_LABEL[layoutMode()]}</span>
            </button>
          </Show>

          <div style={segmentedStyle}>
            <button
              class="bs-btn bs-tip"
              data-tip="Side terminal (cwd if marked)"
              aria-label="Side terminal"
              aria-pressed={!!shellTabId() && isSideTermOpen(shellTabId()!)}
              onClick={() => { const id = shellTabId(); if (id) toggleSideTerm(id); }}
              style={segBtn}
              disabled={!shellTabId()}
            >
              <Icon name="terminal" size={14} />
              <span class="bs-panel-button-label">Terminal</span>
            </button>
            <button
              class="bs-btn bs-tip"
              data-tip="Toggle git view"
              aria-label="Git"
              aria-pressed={!!shellTabId() && isGitOpen(shellTabId()!)}
              onClick={() => { const id = shellTabId(); if (id) toggleGit(id); }}
              style={segBtn}
              disabled={!shellTabId()}
            >
              <Icon name="git-branch" size={14} />
              <span class="bs-panel-button-label">Git</span>
            </button>
            <button
              class="bs-btn bs-tip"
              data-tip="File browser"
              aria-pressed={!!shellTabId() && filesOpen()}
              onClick={() => { if (shellTabId()) toggleFiles(); }}
              style={segBtn}
              disabled={!shellTabId()}
            >
              <Icon name="folder" size={14} />
              Files
            </button>
            <button
              class="bs-btn bs-tip"
              data-tip="Note for this tab"
              aria-pressed={!!noteTab()}
              onClick={toggleNote}
              style={segBtn}
              disabled={!activeTab()}
            >
              <Icon name="sticky-note" size={14} />
              Note
            </button>
            <button
              class="bs-btn bs-tip"
              data-tip={chatAvailable() ? "View Claude Code chat" : "Claude chat requires a local or SSH tab"}
              aria-label="Claude chat"
              aria-pressed={!!chatTab()}
              onClick={() => setChatOpen((open) => !open)}
              style={segBtn}
              disabled={!chatAvailable()}
            >
              <Icon name="message-square" size={14} />
              <span class="bs-panel-button-label">Chat</span>
            </button>
          </div>

          <button
            class="bs-iconbtn bs-tip"
            data-tip="Search (Ctrl+F)"
            aria-pressed={!!activeTabId() && searchTabId() === activeTabId()}
            onClick={() => {
              const id = activeTabId();
              if (!id) return;
              setChatOpen(false);
              if (searchTabId() === id) closeSearch();
              else openSearch(id);
            }}
            style={iconBtn}
            disabled={!activeTabId()}
          >
            <Icon name="search" size={14} />
          </button>
          <button
            class="bs-iconbtn bs-tip"
            data-tip="Settings"
            onClick={() => setSettingsPane("general")}
            style={iconBtn}
          >
            <Icon name="settings" size={14} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, "min-height": 0 }}>
        <Show when={!tabsTop()}>
          <TabBar onNew={() => setShowDialog(true)} />
        </Show>
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0 }}>
          <div style={{
            flex: 1,
            display: "flex",
            "min-height": 0,
            "flex-direction": layoutMode() === "vertical" ? "column" : "row",
          }}>
            {/* The 6px gutter that turns the terminal into a card lives on
             *  this wrapper, NOT on the positioned box below: an absolutely
             *  positioned child resolves `inset: 0` against the padding box,
             *  so padding on the terminals' own containing block would be
             *  invisible. Left/bottom stay flush against the TabBar and the
             *  CommandBar. */}
            <div style={{
              flex: 1, "min-width": 0, "min-height": 0, display: "flex",
              // With no sidebar to sit flush against, the card gets a left gutter too.
              padding: `${S[1.5]} ${S[1.5]} 0 ${tabsTop() ? S[1.5] : "0"}`,
            }}>
              <div style={{ flex: 1, position: "relative", "min-width": 0, "min-height": 0 }}>
                <Show
                  when={tabs().length > 0}
                  fallback={
                    <div style={emptyStyle}>
                      <div style={emptyGlyph}>
                        <Icon name="terminal" size={40} stroke={1.5} />
                      </div>
                      <div style={emptyTitle}>No active session</div>
                      <div style={emptySub}>
                        Open a connection to start a terminal. Saved hosts live in the sidebar.
                      </div>
                      <button class="bs-btn" onClick={() => setShowDialog(true)} style={button("primary", "roomy")}>
                        <Icon name="plus" size={14} />
                        Connect
                      </button>
                      <div style={emptyKeys}>
                        <span style={emptyKeyPair}>
                          <Kbd>Ctrl+Shift+T</Kbd> new session
                        </span>
                        <span style={emptyKeyPair}>
                          <Kbd>Ctrl+F</Kbd> search
                        </span>
                      </div>
                    </div>
                  }
                >
                  <For each={tabs()}>
                    {(t) => <TerminalView tab={t} active={t.id === activeTabId() && !chatTab()} />}
                  </For>
                </Show>
                <Show when={chatTab()} keyed>
                  {(tab) => (
                    <Suspense fallback={<div role="status">Loading Claude chat…</div>}>
                      <ClaudeChatPanel
                        tab={tab}
                        initialBinding={chatBindings.get(tab)}
                        onBind={(binding) => chatBindings.set(tab, binding)}
                        onClose={() => setChatOpen(false)}
                      />
                    </Suspense>
                  )}
                </Show>
              </div>
            </div>

            {/* horizontal / vertical: panels render standalone */}
            <Show when={layoutMode() !== "right-split"}>
              <Show when={shellTabId() && isGitOpen(shellTabId()!)}>
                <GitPanel />
              </Show>
              <Show when={shellTabId() && filesOpen()}>
                {/* Inline file-browser column with its own resize handle. */}
                <div
                  class="bs-resize"
                  data-dragging={filesColDragging() ? "true" : "false"}
                  onMouseDown={startFilesColDrag}
                  style={resizeHandle}
                  title="Drag to resize file browser"
                />
                <div style={{
                  width: `${filesWidth()}px`,
                  display: "flex",
                  "flex-direction": "column",
                  "flex-shrink": "0",
                  "min-height": 0,
                  background: C.bg2,
                }}>
                  <FileBrowser />
                </div>
              </Show>
              <Show when={shellTabId() && isSideTermOpen(shellTabId()!)}>
                <SideTerminalPanel />
              </Show>
              <Show when={noteTab()} keyed>
                {(tab) => <NotePanel tab={tab} onClose={() => setNoteOpen(false)} />}
              </Show>
            </Show>

            {/* right-split: panels share a right column */}
            <Show when={layoutMode() === "right-split" && panelsOpen()}>
              {/* left-edge drag handle for column width */}
              <div
                class="bs-resize"
                data-dragging={colDragging() ? "true" : "false"}
                onMouseDown={startColDrag}
                style={resizeHandle}
                title="Drag to resize column"
              />
              <div style={{
                width: `${gitWidth()}px`,
                "max-width": noteTab() ? "60%" : undefined,
                display: "flex",
                "flex-direction": "column",
                "flex-shrink": "0",
                "min-height": 0,
                background: C.bg2,
              }}>
                <Show when={shellTabId() && isGitOpen(shellTabId()!)}>
                  <GitPanel />
                </Show>
                <Show when={shellTabId() && filesOpen()}>
                  <FileBrowser />
                </Show>
                <Show when={noteTab()} keyed>
                  {(tab) => <NotePanel tab={tab} onClose={() => setNoteOpen(false)} />}
                </Show>
                <Show when={shellTabId() && isSideTermOpen(shellTabId()!)}>
                  <SideTerminalPanel />
                </Show>
              </div>
            </Show>
          </div>
          <CommandBar onEdit={() => setSettingsPane("buttons")} />
        </div>
      </div>

      <Show when={closeSaveError()}>
        <div role="alert">
          <Notice tone="error">Could not save your tabs. Try closing BOOKSHELL again to save.</Notice>
        </div>
      </Show>
      <StatusFooter />

      <Show when={showDialog()}>
        <ConnectionDialog
          onConnect={startConnection}
          onClose={() => setShowDialog(false)}
        />
      </Show>
      <Show when={settingsPane()}>
        {(pane) => (
          <SettingsDialog initialPane={pane()} onClose={() => setSettingsPane(null)} />
        )}
      </Show>
      <Show when={markCwdTabId()}>
        {(id) => <MarkCwdDialog tabId={id()} onClose={closeMarkCwd} />}
      </Show>
    </div>
  );
}

const headerStyle = {
  height: "40px",
  padding: "0 10px",
  "background-color": C.bg2,
  // The header draws the seam; the TabBar / canvas below it draw nothing, so
  // there is exactly one hairline. --hl-top supplies the top edge highlight
  // that the old blurred glass surface used to give it.
  "box-shadow": `inset 0 -1px 0 ${C.borderSub}, ${SH.hlTop}`,
  display: "flex",
  gap: S[2],
  "align-items": "center",
  "flex-shrink": 0,
} as const;

const passthroughBadge = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[1],
  height: H.compact,
  padding: `0 ${S[2]}`,
  background: C.purpleBg,
  color: C.purple,
  border: `1px solid ${C.purpleBdr}`,
  "border-radius": R.full,
  ...T[11],
  "font-weight": 600,
} as const;

/* Empty state — a single centred column, capped at 360px so the copy wraps in
 * two lines instead of stretching across an ultrawide window. The radial wash
 * gives the void a centre of gravity without drawing a box. It is a gradient,
 * not a filter: nothing blurred may sit where the terminal will mount. */
const emptyStyle = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "justify-content": "center",
  height: "100%",
  gap: S[3],
  padding: `0 ${S[6]}`,
  "text-align": "center",
  color: C.text3,
  background: `radial-gradient(ellipse at 50% 40%, ${C.accentGlow}, transparent 60%)`,
} as const;

/** Colour lives on the wrapper — an <Icon> never paints itself. */
const emptyGlyph = {
  color: C.text4,
  "margin-bottom": S[1],
} as const;

const emptyTitle = {
  ...T[15],
  "font-weight": 600,
  color: C.text,
} as const;

const emptySub = {
  ...T[13],
  color: C.text3,
  "max-width": "360px",
} as const;

const emptyKeys = {
  display: "flex",
  "flex-wrap": "wrap",
  "justify-content": "center",
  gap: S[3],
  "margin-top": S[1],
  ...T[11],
  color: C.text4,
} as const;

const emptyKeyPair = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[1.5],
} as const;

/** Ghost toolbar button. Background / foreground are slots the .bs-btn class
 *  drives on hover and on [aria-pressed=true] — never set them inline here. */
const toolBtn = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  gap: S[1.5],
  height: H.default,
  padding: `0 ${S[2]}`,
  border: "1px solid transparent",
  "border-radius": R.sm,
  ...T[12],
  "font-weight": 500,
  "white-space": "nowrap",
  cursor: "pointer",
  "--btn-bg": "transparent",
  "--btn-fg": C.text3,
} as const;

/** Track for the Terminal / Git / Files segmented control. */
const segmentedStyle = {
  display: "flex",
  gap: S[0.5],
  padding: S[0.5],
  background: C.bg3,
  "border-radius": R.md,
} as const;

/** A segment: same anatomy as toolBtn, shorter so track + segment = 26px. */
const segBtn = {
  ...toolBtn,
  height: H.compact,
} as const;

/** 26x26 icon-only button (Find, Settings). */
const iconBtn = {
  ...toolBtn,
  width: H.default,
  padding: "0",
} as const;

/** 8px grab strip pulled into the gutter with a negative margin so it costs
 *  no layout width; the visible 2px bar is painted by .bs-resize::after. */
const resizeHandle = {
  width: S[2],
  margin: `0 -${S[1]}`,
  cursor: "col-resize",
  "z-index": "5",
} as const;
