import { createMemo, createSignal, For, Show } from "solid-js";

const [tabBarWidth, setTabBarWidth] = createSignal(190);
const MIN_W = 140;
const MAX_W = 400;
import { C } from "../theme";
import {
  activeTabId,
  closeTab,
  dropTab,
  groupById,
  openMarkCwd,
  removeTabFromGroup,
  renameGroup,
  renameTab,
  setActiveTab,
  setGroupColor,
  setTabColor,
  setTabIcon,
  tabGroups,
  tabs,
  toggleGroupCollapsed,
  toggleTabPassthrough,
  ungroup,
  type Tab,
  type TabGroup,
  type TabStatus,
} from "../stores/tabs";
import { ContextMenu, type MenuItem } from "./ContextMenu";

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

/** Where a dragged tab will land. `before` inserts above the target tab (same
 *  group as target); `group` merges into the target tab (creating a group if
 *  needed); `group-header` joins the hit group; `end` moves out to the bottom
 *  ungrouped. */
type DropIntent =
  | { kind: "before" | "group"; id: string }
  | { kind: "group-header"; id: string }
  | { kind: "end"; id: "__end__" };

/** One render row: either a group (with its members) or a lone ungrouped tab.
 *  Groups cluster their members at the group's first-appearance position. */
type Row =
  | { kind: "group"; group: TabGroup; members: Tab[] }
  | { kind: "tab"; tab: Tab };

export function TabBar(props: Props) {
  const [menu, setMenu] = createSignal<{ x: number; y: number; tab: Tab } | null>(null);
  const [groupMenu, setGroupMenu] = createSignal<{ x: number; y: number; group: TabGroup } | null>(null);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = createSignal<string | null>(null);
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  const [resizing, setResizing] = createSignal(false);
  /** Live drop intent while dragging; null when not over any valid target. */
  const [dropIntent, setDropIntent] = createSignal<DropIntent | null>(null);

  /** Build the clustered render model from the flat tab list + groups. */
  const rows = createMemo<Row[]>(() => {
    const list = tabs();
    const membersByGroup = new Map<string, Tab[]>();
    for (const t of list) {
      if (t.groupId && groupById(t.groupId)) {
        const arr = membersByGroup.get(t.groupId) ?? [];
        arr.push(t);
        membersByGroup.set(t.groupId, arr);
      }
    }
    const emitted = new Set<string>();
    const out: Row[] = [];
    for (const t of list) {
      const gid = t.groupId && groupById(t.groupId) ? t.groupId : null;
      if (gid) {
        if (emitted.has(gid)) continue;
        emitted.add(gid);
        out.push({ kind: "group", group: groupById(gid)!, members: membersByGroup.get(gid)! });
      } else {
        out.push({ kind: "tab", tab: t });
      }
    }
    return out;
  });

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
   *  events frequently don't fire, so we hand-roll it with mousedown/move/up.
   *  Computes a DropIntent from the cursor: over a group header → join it; over
   *  a tab → top 40% inserts before, lower 60% merges into a group; over the
   *  end slot → move out ungrouped. */
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
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const header = el?.closest("[data-group-slot]");
      if (header) {
        setDropIntent({ kind: "group-header", id: header.getAttribute("data-group-slot")! });
        return;
      }
      const slot = el?.closest("[data-tab-slot]") as HTMLElement | null;
      const sid = slot?.getAttribute("data-tab-slot") ?? null;
      if (!sid) {
        setDropIntent(null);
        return;
      }
      if (sid === "__end__") {
        setDropIntent({ kind: "end", id: "__end__" });
        return;
      }
      if (sid === tabId) {
        setDropIntent(null);
        return;
      }
      const rect = slot!.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      setDropIntent({ kind: ratio < 0.4 ? "before" : "group", id: sid });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const intent = dropIntent();
      if (active && intent) {
        dropTab(tabId, { kind: intent.kind, targetId: intent.kind === "end" ? null : intent.id });
      }
      setDraggingId(null);
      setDropIntent(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function openMenu(e: MouseEvent, tab: Tab) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, tab });
  }

  function openGroupMenu(e: MouseEvent, group: TabGroup) {
    e.preventDefault();
    e.stopPropagation();
    setGroupMenu({ x: e.clientX, y: e.clientY, group });
  }

  function buildMenu(tab: Tab): MenuItem[] {
    return [
      { icon: "✎", label: "Rename (F2)", onClick: () => setRenamingId(tab.id) },
      {
        icon: "📍",
        label: tab.cwd ? "Edit cwd" : "Mark cwd…",
        sublabel: tab.cwd ? shortCwd(tab.cwd) : undefined,
        onClick: () => openMarkCwd(tab.id),
      },
      {
        icon: "🤖",
        label: tab.passthrough ? "Disable passthrough" : "Enable passthrough",
        onClick: () => toggleTabPassthrough(tab.id),
      },
      {
        icon: "🎨",
        label: "Color",
        submenu: COLORS.map((c) => ({
          label: c.name,
          icon: tab.color === c.value ? "✓" : undefined,
          onClick: () => setTabColor(tab.id, c.value),
        })),
      },
      {
        icon: "★",
        label: "Icon",
        submenu: ICONS.map((ic) => ({
          label: ic.name,
          icon: tab.icon === ic.value ? "✓" : undefined,
          onClick: () => setTabIcon(tab.id, ic.value),
        })),
      },
      ...(tab.groupId
        ? [{ icon: "⏏", label: "Remove from group", onClick: () => removeTabFromGroup(tab.id) } as MenuItem]
        : []),
      { separator: true, label: "" },
      { icon: "🗑", label: "Close", danger: true, onClick: () => closeTab(tab.id) },
    ];
  }

  function buildGroupMenu(group: TabGroup): MenuItem[] {
    return [
      { icon: "✎", label: "Rename group", onClick: () => setRenamingGroupId(group.id) },
      {
        icon: group.collapsed ? "▸" : "▾",
        label: group.collapsed ? "Expand" : "Collapse",
        onClick: () => toggleGroupCollapsed(group.id),
      },
      {
        icon: "🎨",
        label: "Color",
        submenu: COLORS.map((c) => ({
          label: c.name,
          icon: group.color === c.value ? "✓" : undefined,
          onClick: () => setGroupColor(group.id, c.value),
        })),
      },
      { separator: true, label: "" },
      { icon: "⏏", label: "Ungroup", danger: true, onClick: () => ungroup(group.id) },
    ];
  }

  function commitRename(tabId: string, ev: HTMLInputElement) {
    renameTab(tabId, ev.value);
    setRenamingId(null);
  }
  function commitGroupRename(groupId: string, ev: HTMLInputElement) {
    renameGroup(groupId, ev.value);
    setRenamingGroupId(null);
  }

  /** Render a single tab row. `inGroup` indents members under their header. */
  function renderTab(t: Tab, inGroup: boolean) {
    const intent = () => dropIntent();
    const isBefore = () => {
      const i = intent();
      return i?.kind === "before" && i.id === t.id;
    };
    const isGroupMerge = () => {
      const i = intent();
      return i?.kind === "group" && i.id === t.id;
    };
    return (
      <div
        data-tab-slot={t.id}
        onMouseDown={(e) => startDrag(e, t.id)}
        onMouseEnter={() => setHoveredId(t.id)}
        onMouseLeave={() => setHoveredId((id) => (id === t.id ? null : id))}
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
          "margin-left": inGroup ? "10px" : "0",
          background: isGroupMerge()
            ? C.accentBg
            : t.id === activeTabId()
              ? C.accentBg
              : hoveredId() === t.id
                ? C.bgHover
                : "transparent",
          "border-left-color": t.color ?? "transparent",
          "box-shadow": isGroupMerge()
            ? `inset 0 0 0 1.5px ${C.accent}`
            : t.id === activeTabId()
              ? `inset 2px 0 0 ${C.accent}`
              : "none",
          color: C.text,
          "font-weight": t.id === activeTabId() ? 600 : 500,
          opacity: draggingId() === t.id ? 0.35 : 1,
          "border-top": isBefore() ? `2px solid ${C.accent}` : "2px solid transparent",
        }}
        title={t.errorMessage ?? t.name}
      >
        <div style={tabTopRowStyle}>
          <Show when={t.status !== "connected"}>
            <span
              class={t.status === "connecting" ? "bs-pulse" : undefined}
              style={{
                color: statusColor[t.status],
                "font-size": "10px",
                width: "12px",
                "flex-shrink": 0,
                "font-weight": t.status === "error" ? 700 : 400,
              }}
              title={t.status}
            >
              {statusGlyph[t.status]}
            </span>
          </Show>
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
            style={{
              ...closeBtnStyle,
              visibility:
                hoveredId() === t.id || t.id === activeTabId() ? "visible" : "hidden",
            }}
            title="Close (Ctrl+Shift+W)"
          >
            ×
          </button>
        </div>
        <Show when={t.cwd}>
          <div style={cwdRowStyle}>{shortCwd(t.cwd!)}</div>
        </Show>
      </div>
    );
  }

  /** Render a group header + its members (unless collapsed). */
  function renderGroup(group: TabGroup, members: Tab[]) {
    const isHeaderTarget = () => {
      const i = dropIntent();
      return i?.kind === "group-header" && i.id === group.id;
    };
    const activeInside = () => members.some((m) => m.id === activeTabId());
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
        <div
          data-group-slot={group.id}
          onClick={() => toggleGroupCollapsed(group.id)}
          onDblClick={(e) => {
            e.stopPropagation();
            setRenamingGroupId(group.id);
          }}
          onContextMenu={(e) => openGroupMenu(e, group)}
          style={{
            ...groupHeaderStyle,
            background: isHeaderTarget() ? C.accentBg : C.bg3,
            "box-shadow": isHeaderTarget() ? `inset 0 0 0 1.5px ${C.accent}` : "none",
            "border-left": `3px solid ${group.color ?? C.borderSub}`,
          }}
          title={group.collapsed ? "Click to expand" : "Click to collapse"}
        >
          <span style={{ "font-size": "9px", width: "10px", "flex-shrink": 0, color: C.text2 }}>
            {group.collapsed ? "▸" : "▾"}
          </span>
          <Show
            when={renamingGroupId() === group.id}
            fallback={
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  "font-weight": 600,
                  "font-size": "11px",
                  color: activeInside() && group.collapsed ? C.accent : C.text,
                  "letter-spacing": "0.02em",
                }}
              >
                {group.name}
              </span>
            }
          >
            <input
              value={group.name}
              autofocus
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => commitGroupRename(group.id, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitGroupRename(group.id, e.currentTarget);
                if (e.key === "Escape") setRenamingGroupId(null);
                e.stopPropagation();
              }}
              style={renameInputStyle}
            />
          </Show>
          <span style={{ "font-size": "10px", color: C.text3, "flex-shrink": 0 }}>
            {members.length}
          </span>
        </div>
        <Show when={!group.collapsed}>
          <For each={members}>{(m) => renderTab(m, true)}</For>
        </Show>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: `${tabBarWidth()}px`, "flex-shrink": 0 }}>
    <div style={containerStyle}>
      <For each={rows()}>
        {(row) =>
          row.kind === "group"
            ? renderGroup(row.group, row.members)
            : renderTab(row.tab, false)
        }
      </For>
      <div
        data-tab-slot="__end__"
        style={{
          "min-height": "12px",
          "border-top": dropIntent()?.kind === "end" && draggingId()
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
      <Show when={groupMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            items={buildGroupMenu(m().group)}
            onClose={() => setGroupMenu(null)}
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
  padding: "4px 4px",
  gap: "1px",
  "overflow-y": "auto",
  "min-width": 0,
} as const;

const tabStyle = {
  display: "flex",
  "flex-direction": "column",
  // Tighter vertical padding — name row is now ~26px and the optional cwd row
  // is ~14px. Previously each tab was ~42px which capped the visible list to
  // ~10 entries on a typical 800px-tall window.
  padding: "3px 8px 3px 6px",
  "border-radius": "5px",
  cursor: "grab",
  "font-size": "13px",
  "border-left": "3px solid transparent",
  "user-select": "none",
  transition: "background 0.08s, color 0.08s",
} as const;

const groupHeaderStyle = {
  display: "flex",
  "align-items": "center",
  gap: "5px",
  padding: "3px 8px",
  "border-radius": "5px",
  cursor: "pointer",
  "user-select": "none",
  transition: "background 0.08s",
} as const;

const tabTopRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: "5px",
  width: "100%",
} as const;

const cwdRowStyle = {
  "font-size": "11px",
  color: C.text2,
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "padding-left": "17px",
  "margin-top": "1px",
  "line-height": "1.2",
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
