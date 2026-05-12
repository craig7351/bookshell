import { createSignal, For, Show } from "solid-js";

const [tabBarWidth, setTabBarWidth] = createSignal(190);
const MIN_W = 140;
const MAX_W = 400;
import { C } from "../theme";
import {
  activeTabId,
  closeTab,
  dumpTabBuffer,
  openMarkCwd,
  renameTab,
  reorderTabs,
  setActiveTab,
  setTabColor,
  setTabIcon,
  tabs,
  toggleTabPassthrough,
  type Tab,
  type TabStatus,
} from "../stores/tabs";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { api } from "../ipc/api";

interface Props {
  onNew: () => void;
}

const statusColor: Record<TabStatus, string> = {
  connecting: C.yellow,
  connected: C.green,
  disconnected: C.text3,
  error: C.red,
};

const statusGlyph: Record<TabStatus, string> = {
  connecting: "◐",
  connected: "●",
  disconnected: "○",
  error: "!",
};

const COLORS = [
  { name: "Default", value: null },
  { name: "Red",    value: C.red    },
  { name: "Orange", value: C.orange },
  { name: "Yellow", value: C.yellow },
  { name: "Green",  value: C.green  },
  { name: "Blue",   value: C.accent },
  { name: "Purple", value: C.purple },
];

const ICONS = [
  { name: "None", value: null },
  { name: "🤖 Robot", value: "🤖" },
  { name: "🚀 Rocket", value: "🚀" },
  { name: "🐧 Linux", value: "🐧" },
  { name: "🔧 Tool", value: "🔧" },
  { name: "📦 Box", value: "📦" },
  { name: "⭐ Star", value: "⭐" },
  { name: "🔥 Fire", value: "🔥" },
];

function shortCwd(p: string): string {
  if (p.length <= 28) return p;
  return "…" + p.slice(p.length - 27);
}

export function TabBar(props: Props) {
  const [menu, setMenu] = createSignal<{ x: number; y: number; tab: Tab } | null>(null);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [resizing, setResizing] = createSignal(false);
  /** Tab id under cursor (or "__end__"). Null when not over any drop target. */
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);

  function startResize(ev: MouseEvent) {
    ev.preventDefault();
    setResizing(true);
    const startX = ev.clientX;
    const startW = tabBarWidth();
    const onMove = (e: MouseEvent) =>
      setTabBarWidth(Math.max(MIN_W, Math.min(MAX_W, startW + (e.clientX - startX))));
    const onUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /** Pointer-event-based drag. HTML5 drag-and-drop is unreliable in WebView2 —
   *  events frequently don't fire, so we hand-roll it with mousedown/move/up. */
  function startDrag(ev: MouseEvent, tabId: string) {
    if (ev.button !== 0) return;
    if (renamingId() === tabId) return;
    // Don't start drag if user clicked the close × or the rename input.
    const target = ev.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    let active = false; // becomes true after threshold

    const onMove = (e: MouseEvent) => {
      if (!active) {
        // 4px threshold so quick clicks aren't misread as drags
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        active = true;
        setDraggingId(tabId);
      }
      // Find which tab the cursor is currently over.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slot = el?.closest("[data-tab-slot]");
      setDropTargetId(slot?.getAttribute("data-tab-slot") ?? null);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const target = dropTargetId();
      if (active && target && target !== tabId) {
        reorderTabs(tabId, target === "__end__" ? null : target);
      }
      setDraggingId(null);
      setDropTargetId(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function openMenu(e: MouseEvent, tab: Tab) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, tab });
  }

  function buildMenu(tab: Tab): MenuItem[] {
    return [
      { label: "Rename (F2)", onClick: () => setRenamingId(tab.id) },
      {
        label: tab.cwd ? `📍 Edit cwd (${shortCwd(tab.cwd)})` : "📍 Mark cwd…",
        onClick: () => openMarkCwd(tab.id),
      },
      {
        label: tab.passthrough ? "🤖 Disable passthrough" : "🤖 Enable passthrough",
        onClick: () => toggleTabPassthrough(tab.id),
      },
      {
        label: "Color",
        submenu: COLORS.map((c) => ({
          label: c.name + (tab.color === c.value ? "  ✓" : ""),
          onClick: () => setTabColor(tab.id, c.value),
        })),
      },
      {
        label: "Icon",
        submenu: ICONS.map((ic) => ({
          label: ic.name + (tab.icon === ic.value ? "  ✓" : ""),
          onClick: () => setTabIcon(tab.id, ic.value),
        })),
      },
      { separator: true, label: "" },
      { label: "📝 Export transcript…", onClick: () => exportTranscript(tab) },
      { separator: true, label: "" },
      { label: "Close", danger: true, onClick: () => closeTab(tab.id) },
    ];
  }

  async function exportTranscript(tab: Tab) {
    const text = dumpTabBuffer(tab.id);
    if (text === null) {
      console.warn("no buffer dumper registered for", tab.id);
      return;
    }
    // Header lets the file stand on its own when shared.
    const header = [
      `# BOOKSHELL transcript`,
      `# tab:    ${tab.name}`,
      `# cwd:    ${tab.cwd ?? "(unset)"}`,
      `# saved:  ${new Date().toISOString()}`,
      ``,
      ``,
    ].join("\n");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = tab.name.replace(/[^\w.-]+/g, "_") || "tab";
    const suggested = `bookshell-${safeName}-${stamp}.txt`;
    try {
      await api.transcriptSaveDialog(suggested, header + text + "\n");
    } catch (e) {
      console.warn("transcript save failed", e);
    }
  }

  function commitRename(tabId: string, ev: HTMLInputElement) {
    renameTab(tabId, ev.value);
    setRenamingId(null);
  }

  return (
    <div style={{ display: "flex", width: `${tabBarWidth()}px`, "flex-shrink": 0 }}>
    <div style={containerStyle}>
      <For each={tabs()}>
        {(t) => (
          <div
            data-tab-slot={t.id}
            onMouseDown={(e) => startDrag(e, t.id)}
            onClick={() => setActiveTab(t.id)}
            onDblClick={() => setRenamingId(t.id)}
            onContextMenu={(e) => openMenu(e, t)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "F2" && t.id === activeTabId()) {
                e.preventDefault();
                setRenamingId(t.id);
              }
            }}
            tabindex={t.id === activeTabId() ? 0 : -1}
            style={{
              ...tabStyle,
              background: t.id === activeTabId() ? C.bgActive : "transparent",
              "border-left-color": t.color ?? "transparent",
              opacity: draggingId() === t.id ? 0.35 : 1,
              "border-top": dropTargetId() === t.id && draggingId() && draggingId() !== t.id
                ? `2px solid ${C.accent}`
                : "2px solid transparent",
            }}
            title={t.errorMessage ?? t.name}
          >
          <div style={tabTopRowStyle}>
            <span style={{ color: statusColor[t.status], "font-size": "10px", width: "12px" }}>
              {statusGlyph[t.status]}
            </span>
            <Show when={t.passthrough}>
              <span title="AI passthrough on" style={{ "font-size": "11px" }}>🤖</span>
            </Show>
            <Show when={t.cwd}>
              <span title={`cwd: ${t.cwd}`} style={{ "font-size": "10px" }}>📍</span>
            </Show>
            <Show when={t.icon}>{(ic) => <span>{ic()}</span>}</Show>
            <Show
              when={renamingId() === t.id}
              fallback={
                <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  {t.name}
                </span>
              }
            >
              <input
                value={t.name}
                autofocus
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={(e) => commitRename(t.id, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(t.id, e.currentTarget);
                  if (e.key === "Escape") setRenamingId(null);
                  e.stopPropagation();
                }}
                style={renameInputStyle}
              />
            </Show>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              style={closeBtnStyle}
              title="Close (Ctrl+Shift+W)"
            >
              ×
            </button>
          </div>
          <Show when={t.cwd}>
            <div style={cwdRowStyle}>
              {shortCwd(t.cwd!)}
            </div>
          </Show>
          </div>
        )}
      </For>
      <div
        data-tab-slot="__end__"
        style={{
          "min-height": "12px",
          "border-top": dropTargetId() === "__end__" && draggingId()
            ? `2px solid ${C.accent}`
            : "2px solid transparent",
        }}
      />
      <button onClick={props.onNew} style={newBtnStyle} title="New tab (Ctrl+Shift+T)">
        + New
      </button>

      <Show when={menu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            items={buildMenu(m().tab)}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
    </div>
    {/* right-edge drag handle */}
    <div
      onMouseDown={startResize}
      style={{
        width: "4px",
        cursor: "col-resize",
        background: resizing() ? C.accent : "transparent",
        "border-right": `1px solid ${C.border}`,
        "flex-shrink": 0,
        transition: "background 0.15s",
      }}
      title="Drag to resize"
    />
    </div>
  );
}

const containerStyle = {
  flex: 1,
  background: C.bg2,
  display: "flex",
  "flex-direction": "column",
  padding: "6px 4px",
  gap: "1px",
  "overflow-y": "auto",
  "min-width": 0,
} as const;

const tabStyle = {
  display: "flex",
  "flex-direction": "column",
  padding: "5px 8px",
  "border-radius": "6px",
  cursor: "grab",
  "font-size": "12px",
  color: C.text,
  "border-left": "3px solid transparent",
  "user-select": "none",
  transition: "background 0.1s",
} as const;

const tabTopRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: "5px",
  width: "100%",
} as const;

const cwdRowStyle = {
  "font-size": "10px",
  color: C.text3,
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "padding-left": "17px",
  "margin-top": "2px",
} as const;

const renameInputStyle = {
  flex: 1,
  background: C.bg,
  color: C.text,
  border: `1px solid ${C.accent}`,
  "border-radius": "4px",
  padding: "1px 5px",
  "font-size": "12px",
  outline: "none",
  "min-width": 0,
} as const;

const closeBtnStyle = {
  background: "transparent",
  color: C.text3,
  border: "none",
  cursor: "pointer",
  "font-size": "14px",
  padding: "0 3px",
  "line-height": "1",
  "flex-shrink": 0,
} as const;

const newBtnStyle = {
  background: "transparent",
  color: C.text3,
  border: `1px dashed ${C.borderSub}`,
  "border-radius": "6px",
  padding: "5px 8px",
  cursor: "pointer",
  "font-size": "12px",
  "margin-top": "4px",
  transition: "color 0.1s, border-color 0.1s",
} as const;
