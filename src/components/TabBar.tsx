import { createMemo, createSignal, For, Show } from "solid-js";

const [tabBarWidth, setTabBarWidth] = createSignal(190);
const MIN_W = 140;
const MAX_W = 400;
import { C, FONT, H, M, R, S, T } from "../theme";
import { Icon } from "../icons";
import { CloseGlyph } from "./CloseX";
import { Kbd } from "./ui/Kbd";
import { StatusDot } from "./ui/StatusDot";
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
  tabs,
  toggleGroupCollapsed,
  toggleTabPassthrough,
  ungroup,
  type Tab,
  type TabGroup,
} from "../stores/tabs";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  onNew: () => void;
}

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
  { name: "Robot", value: "🤖" },
  { name: "Rocket", value: "🚀" },
  { name: "Linux", value: "🐧" },
  { name: "Tool", value: "🔧" },
  { name: "Box", value: "📦" },
  { name: "Star", value: "⭐" },
  { name: "Fire", value: "🔥" },
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

  /** The colour picker, shared by the tab and group menus: a swatch per row,
   *  a ✓ on the current one. "Default" is the ringed transparent dot. */
  function colorSubmenu(current: string | null | undefined, apply: (v: string | null) => void): MenuItem[] {
    return COLORS.map((c) => ({
      label: c.name,
      swatch: c.value ?? "transparent",
      checked: current === c.value,
      onClick: () => apply(c.value),
    }));
  }

  function buildMenu(tab: Tab): MenuItem[] {
    return [
      { icon: "pencil", label: "Rename", shortcut: "F2", onClick: () => setRenamingId(tab.id) },
      {
        icon: "map-pin",
        label: tab.cwd ? "Edit cwd" : "Mark cwd…",
        sublabel: tab.cwd ? shortCwd(tab.cwd) : undefined,
        onClick: () => openMarkCwd(tab.id),
      },
      {
        icon: "bot",
        label: tab.passthrough ? "Disable passthrough" : "Enable passthrough",
        checked: tab.passthrough,
        onClick: () => toggleTabPassthrough(tab.id),
      },
      {
        label: "Color",
        swatch: tab.color ?? "transparent",
        submenu: colorSubmenu(tab.color, (v) => setTabColor(tab.id, v)),
      },
      {
        label: "Icon",
        icon: "image",
        emoji: tab.icon ?? undefined,
        // The one menu that keeps emoji: these ARE the user's content.
        submenu: ICONS.map((ic) => ({
          label: ic.name,
          emoji: ic.value ?? undefined,
          checked: tab.icon === ic.value,
          onClick: () => setTabIcon(tab.id, ic.value),
        })),
      },
      ...(tab.groupId
        ? [{ icon: "minus", label: "Remove from group", onClick: () => removeTabFromGroup(tab.id) } as MenuItem]
        : []),
      { separator: true, label: "" },
      { icon: "x", label: "Close", danger: true, onClick: () => closeTab(tab.id) },
    ];
  }

  function buildGroupMenu(group: TabGroup): MenuItem[] {
    return [
      { icon: "pencil", label: "Rename group", onClick: () => setRenamingGroupId(group.id) },
      {
        icon: group.collapsed ? "chevron-right" : "chevron-down",
        label: group.collapsed ? "Expand" : "Collapse",
        onClick: () => toggleGroupCollapsed(group.id),
      },
      {
        label: "Color",
        swatch: group.color ?? "transparent",
        submenu: colorSubmenu(group.color, (v) => setGroupColor(group.id, v)),
      },
      { separator: true, label: "" },
      { icon: "minus", label: "Ungroup", danger: true, onClick: () => ungroup(group.id) },
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

  /** Focus and select a freshly mounted rename field. queueMicrotask because a
   *  Solid ref fires before the node is in the document. */
  function focusRename(el: HTMLInputElement) {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  }

  /** Render a single tab row. `inGroup` indents members under their header. */
  function renderTab(t: Tab, inGroup: boolean) {
    const intent = () => dropIntent();
    const isActive = () => t.id === activeTabId();
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
        class="bs-row bs-tabrow"
        data-tab-slot={t.id}
        aria-selected={isActive()}
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
          ...rowStyle,
          height: t.cwd ? "40px" : H.row,
          "margin-left": inGroup ? "10px" : "0",
          // Background and foreground are class-driven; only slots go inline.
          "--btn-bg": isGroupMerge() ? C.accentBg : "transparent",
          "--btn-fg": isActive() ? C.text : C.text2,
          "--btn-fg-hover": C.text,
          // A coloured tab tints its own selected fill. base.css falls back to
          // --fill-selected where color-mix() is unsupported.
          "--btn-bg-selected": t.color
            ? `color-mix(in srgb, ${t.color} 18%, transparent)`
            : C.bgSelected,
          "font-weight": isActive() ? 500 : 400,
          "box-shadow": isGroupMerge() ? `inset 0 0 0 1.5px ${C.accent}` : "none",
          opacity: draggingId() === t.id ? 0.35 : 1,
        }}
        title={t.errorMessage ?? t.name}
      >
        <Show when={isBefore()}>
          <div style={dropBarStyle} />
        </Show>
        <Show when={t.color}>
          <div style={{ ...railStyle, background: t.color! }} />
        </Show>
        <div style={tabTopRowStyle}>
          <div style={leadSlotStyle} title={t.status}>
            <Show when={t.icon} fallback={<StatusDot state={t.status} />}>
              {(ic) => (
                <>
                  <span style={leadIconStyle}>{ic()}</span>
                  <div style={leadDotStyle}>
                    <StatusDot state={t.status} size={6} />
                  </div>
                </>
              )}
            </Show>
          </div>
          <Show when={renamingId() === t.id} fallback={<span style={nameStyle}>{t.name}</span>}>
            <input
              value={t.name}
              autofocus
              ref={focusRename}
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
          <div style={trailStyle}>
            <Show when={t.passthrough || t.cwd}>
              <div class="bs-tab-meta" style={metaStyle}>
                <Show when={t.passthrough}>
                  <span title="AI passthrough on" style={{ display: "flex", color: C.purple }}>
                    <Icon name="bot" size={12} />
                  </span>
                </Show>
                <Show when={t.cwd}>
                  <span title={`cwd: ${t.cwd}`} style={{ display: "flex" }}>
                    <Icon name="map-pin" size={12} />
                  </span>
                </Show>
              </div>
            </Show>
            <button
              class="bs-iconbtn bs-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              style={closeBtnStyle}
              title="Close (Ctrl+Shift+W)"
            >
              <CloseGlyph size="sm" />
            </button>
          </div>
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
          class="bs-row"
          data-group-slot={group.id}
          onClick={() => toggleGroupCollapsed(group.id)}
          onDblClick={(e) => {
            e.stopPropagation();
            setRenamingGroupId(group.id);
          }}
          onContextMenu={(e) => openGroupMenu(e, group)}
          style={{
            ...groupHeaderStyle,
            "--btn-bg": isHeaderTarget() ? C.accentBg : "transparent",
            "--btn-fg": C.text3,
            "--btn-fg-hover": C.text2,
            "box-shadow": isHeaderTarget() ? `inset 0 0 0 1.5px ${C.accent}` : "none",
          }}
          title={group.collapsed ? "Click to expand" : "Click to collapse"}
        >
          <Show when={group.color}>
            <div style={{ ...railStyle, background: group.color! }} />
          </Show>
          <div style={leadSlotStyle}>
            <Icon
              name="chevron-right"
              size={12}
              style={{
                transform: group.collapsed ? "none" : "rotate(90deg)",
                transition: `transform ${M.d2} ${M.ease}`,
              }}
            />
          </div>
          <Show
            when={renamingGroupId() === group.id}
            fallback={
              <span
                style={{
                  ...groupNameStyle,
                  ...(activeInside() && group.collapsed ? { color: C.accent } : {}),
                }}
              >
                {group.name}
              </span>
            }
          >
            <input
              value={group.name}
              autofocus
              ref={focusRename}
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
          <span style={countPillStyle}>{members.length}</span>
        </div>
        <Show when={!group.collapsed}>
          <For each={members}>{(m) => renderTab(m, true)}</For>
        </Show>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: `${tabBarWidth()}px`, "flex-shrink": 0 }}>
      <div style={columnStyle}>
        <div class="bs-scroll-fade" style={scrollStyle}>
          <For each={rows()}>
            {(row) =>
              row.kind === "group"
                ? renderGroup(row.group, row.members)
                : renderTab(row.tab, false)
            }
          </For>
          <div data-tab-slot="__end__" style={endSlotStyle}>
            <Show when={dropIntent()?.kind === "end" && draggingId()}>
              <div style={{ ...dropBarStyle, top: "4px" }} />
            </Show>
          </div>
        </div>

        {/* Pinned below the scroller: the one creating action never scrolls out
         *  of reach, and its shortcut chip fades in on hover. */}
        <button class="bs-row bs-kbd-reveal" onClick={props.onNew} style={newBtnStyle}>
          <div style={leadSlotStyle}>
            <Icon name="plus" size={14} />
          </div>
          <span style={{ flex: 1, "text-align": "left" }}>New tab</span>
          <Kbd>Ctrl+Shift+T</Kbd>
        </button>
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
          transition: `background ${M.d2} ${M.ease}`,
        }}
        title="Drag to resize"
      />

      {/* The menus live outside the masked scroller: a mask clips its subtree
       *  and opens a stacking context, which would swallow a fixed popover. */}
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
  );
}

const columnStyle = {
  flex: 1,
  background: C.bg2,
  display: "flex",
  "flex-direction": "column",
  "min-width": 0,
  "min-height": 0,
} as const;

/** The scrolling list. Its 12px vertical padding matches the .bs-scroll-fade
 *  mask, so the first and last rows only dissolve once the list really
 *  scrolls under it. */
const scrollStyle = {
  flex: 1,
  display: "flex",
  "flex-direction": "column",
  gap: "1px",
  padding: `${S[3]} ${S[1]}`,
  "overflow-y": "auto",
  "min-height": 0,
} as const;

/** One anatomy for every entry: [16px leading slot][name][trailing meta], so
 *  a name starts at the same x whatever the row happens to carry. */
const rowStyle = {
  position: "relative",
  display: "flex",
  "flex-direction": "column",
  "justify-content": "center",
  padding: "0 8px 0 6px",
  "border-radius": R.sm,
  cursor: "grab",
  ...T[13],
  "user-select": "none",
} as const;

const groupHeaderStyle = {
  position: "relative",
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.row,
  padding: "0 8px 0 6px",
  "border-radius": R.sm,
  cursor: "pointer",
  "user-select": "none",
} as const;

const tabTopRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.row,
  width: "100%",
} as const;

/** The fixed leading slot — a status dot, a custom icon, or a chevron. */
const leadSlotStyle = {
  position: "relative",
  width: "16px",
  height: "16px",
  "flex-shrink": 0,
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
} as const;

const leadIconStyle = {
  ...T[12],
  "line-height": "1",
} as const;

/** When a custom icon owns the slot, status shrinks into its corner. */
const leadDotStyle = {
  position: "absolute",
  right: "-2px",
  bottom: "-1px",
} as const;

const nameStyle = {
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const trailStyle = {
  position: "relative",
  display: "flex",
  "align-items": "center",
  gap: S[1],
  "flex-shrink": 0,
} as const;

const metaStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1],
  color: C.text3,
} as const;

/** 3px colour rail, parked inside the row's left padding so it can never push
 *  the leading slot around the way the old border-left did. */
const railStyle = {
  position: "absolute",
  left: "2px",
  top: "50%",
  width: "3px",
  height: "14px",
  "margin-top": "-7px",
  "border-radius": R.full,
  "pointer-events": "none",
} as const;

/** Standalone insert marker; rows no longer carry a permanent border-top. */
const dropBarStyle = {
  position: "absolute",
  left: "0",
  right: "0",
  top: "-1px",
  height: "2px",
  "border-radius": R.full,
  background: C.accent,
  "pointer-events": "none",
} as const;

const cwdRowStyle = {
  ...T[10],
  "font-family": FONT.mono,
  color: C.text3,
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "padding-left": "22px",
  "line-height": "12px",
} as const;

const groupNameStyle = {
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  ...T[11],
  "font-weight": 600,
  "text-transform": "uppercase",
  "letter-spacing": "0.06em",
} as const;

const countPillStyle = {
  ...T[10],
  "font-weight": 500,
  "font-variant-numeric": "tabular-nums",
  color: C.text3,
  background: C.bg3,
  height: "14px",
  padding: `0 ${S[1.5]}`,
  "border-radius": R.full,
  display: "inline-flex",
  "align-items": "center",
  "flex-shrink": 0,
} as const;

const renameInputStyle = {
  flex: 1,
  "min-width": 0,
  height: "20px",
  background: C.bg3,
  color: C.text,
  border: "none",
  outline: "none",
  "border-radius": R.xs,
  padding: `0 ${S[1.5]}`,
  ...T[13],
  "box-shadow": `0 0 0 2px ${C.accentBdr}`,
} as const;

const closeBtnStyle = {
  width: "18px",
  height: "18px",
  padding: "0",
  border: "none",
  cursor: "pointer",
  "border-radius": R.xs,
  "--btn-bg": "transparent",
  "--btn-bg-hover": C.bgHover,
  "--btn-fg": C.text4,
  "--btn-fg-hover": C.text,
} as const;

/** Drop target for "move out of every group, to the bottom". */
const endSlotStyle = {
  position: "relative",
  "min-height": S[3],
  "flex-shrink": 0,
} as const;

const newBtnStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  width: "100%",
  height: H.row,
  // 10px, not 6px: the scroller above adds 4px of its own padding, so this is
  // what puts the leading slot on the same x as a tab row's.
  padding: "0 12px 0 10px",
  border: "none",
  "border-top": `1px solid ${C.borderSub}`,
  cursor: "pointer",
  "flex-shrink": 0,
  ...T[12],
  "--btn-bg": "transparent",
  "--btn-fg": C.text3,
  "--btn-fg-hover": C.text,
} as const;
