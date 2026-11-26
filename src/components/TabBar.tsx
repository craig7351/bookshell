import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

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
  reorderGroup,
  renameGroup,
  renameTab,
  setActiveTab,
  setGroupColor,
  setTabColor,
  setTabIcon,
  supportsShellTools,
  tabs,
  toggleGroupCollapsed,
  toggleTabPassthrough,
  ungroup,
  type Tab,
  type TabGroup,
} from "../stores/tabs";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { StartupCommandDialog } from "./StartupCommandDialog";

interface Props {
  onNew: () => void;
  /** "vertical" (default): the resizable sidebar. "horizontal": a strip that
   *  lives inside the header. Fixed for the lifetime of the instance; App
   *  remounts the bar when the setting changes. */
  orientation?: "vertical" | "horizontal";
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

type DragSource = { kind: "tab" | "group"; id: string };
type DropEdge = "before" | "after";

/** Where a dragged tab will land. `before` inserts above the target tab (same
 *  group as target); `group` merges into the target tab (creating a group if
 *  needed); `group-header` joins the hit group; `end` moves out to the bottom
 *  ungrouped. A dragged group uses the edge of a top-level row. */
type DropIntent =
  | { kind: "before" | "group"; id: string }
  | { kind: "group-header"; id: string }
  | { kind: "reorder-group"; target: DragSource; edge: DropEdge }
  | { kind: "end"; id: "__end__" };

/** One render row: either a group (with its members) or a lone ungrouped tab.
 *  Groups cluster their members at the group's first-appearance position. */
type Row =
  | { kind: "group"; group: TabGroup; members: Tab[] }
  | { kind: "tab"; tab: Tab };

export function TabBar(props: Props) {
  const horiz = props.orientation === "horizontal";
  const [menu, setMenu] = createSignal<{ x: number; y: number; tab: Tab } | null>(null);
  const [groupMenu, setGroupMenu] = createSignal<{ x: number; y: number; group: TabGroup } | null>(null);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [startupCommandTabId, setStartupCommandTabId] = createSignal<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = createSignal<string | null>(null);
  const [dragging, setDragging] = createSignal<DragSource | null>(null);
  const [resizing, setResizing] = createSignal(false);
  /** Live drop intent while dragging; null when not over any valid target. */
  const [dropIntent, setDropIntent] = createSignal<DropIntent | null>(null);
  let stopDrag: (() => void) | undefined;
  let suppressGroupClick: string | undefined;
  onCleanup(() => stopDrag?.());

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

  /** 0..1 position of the pointer along the bar's main axis within `rect`. */
  function along(event: MouseEvent, rect: DOMRect): number {
    return horiz ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
  }

  function locateDrop(source: DragSource, event: MouseEvent): DropIntent | null {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const slot = el?.closest<HTMLElement>("[data-tab-slot]");
    const tabId = slot?.dataset.tabSlot;
    if (tabId === "__end__") return { kind: "end", id: "__end__" };

    const header = el?.closest<HTMLElement>("[data-group-slot]");
    if (source.kind === "group") {
      const block = el?.closest<HTMLElement>("[data-group-block]");
      const groupId = block?.dataset.groupBlock;
      if (groupId === source.id) return null;
      const reference = groupId ? header ?? block : slot;
      const target: DragSource | undefined = groupId ? { kind: "group", id: groupId }
        : tabId ? { kind: "tab", id: tabId } : undefined;
      if (!reference || !target) return null;
      const rect = reference.getBoundingClientRect();
      return { kind: "reorder-group", target, edge: along(event, rect) < 0.5 ? "before" : "after" };
    }

    if (header?.dataset.groupSlot) return { kind: "group-header", id: header.dataset.groupSlot };
    if (!slot || !tabId || tabId === source.id) return null;
    return { kind: along(event, slot.getBoundingClientRect()) < 0.4 ? "before" : "group", id: tabId };
  }

  function moveGroup(groupId: string, intent: Extract<DropIntent, { kind: "reorder-group" | "end" }>) {
    const visibleRows = rows();
    const from = visibleRows.findIndex((row) => row.kind === "group" && row.group.id === groupId);
    if (from < 0) return;
    let before = visibleRows.length;
    if (intent.kind === "reorder-group") {
      before = visibleRows.findIndex((row) => row.kind === intent.target.kind
        && (row.kind === "group" ? row.group.id : row.tab.id) === intent.target.id);
      if (before < 0) return;
      if (intent.edge === "after") before++;
    }
    if (before === from || before === from + 1) return;
    // The next visible row provides the anchor even if existing group members
    // are interleaved in the persisted flat tab list.
    const anchor = visibleRows[before];
    reorderGroup(groupId, anchor ? (anchor.kind === "group" ? anchor.members[0].id : anchor.tab.id) : null);
  }

  /** Use mouse events for both reorder gestures in WebView2. */
  function startDrag(ev: MouseEvent, source: DragSource) {
    if (ev.button !== 0) return;
    if (source.kind === "group") suppressGroupClick = undefined;
    if ((source.kind === "tab" ? renamingId() : renamingGroupId()) === source.id) return;
    if (ev.target instanceof Element && ev.target.closest("button, input")) return;
    stopDrag?.();

    const startX = ev.clientX;
    const startY = ev.clientY;
    let active = false; // becomes true after threshold

    const onMove = (e: MouseEvent) => {
      if (!active) {
        // 4px threshold so quick clicks aren't misread as drags
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        active = true;
        setDragging(source);
        if (source.kind === "group") suppressGroupClick = source.id;
      }
      setDropIntent(locateDrop(source, e));
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", cleanup);
      stopDrag = undefined;
      setDragging(null);
      setDropIntent(null);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const intent = active ? locateDrop(source, e) : null;
      cleanup();
      if (!intent) return;
      if (source.kind === "group") {
        if (intent.kind === "reorder-group" || intent.kind === "end") moveGroup(source.id, intent);
      } else if (intent.kind !== "reorder-group") {
        dropTab(source.id, { kind: intent.kind, targetId: intent.kind === "end" ? null : intent.id });
      }
    };

    stopDrag = cleanup;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("blur", cleanup);
  }

  function groupDropEdge(kind: DragSource["kind"], id: string): DropEdge | undefined {
    const intent = dropIntent();
    if (intent?.kind === "reorder-group" && intent.target.kind === kind && intent.target.id === id) return intent.edge;
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
        disabled: !supportsShellTools(tab),
        sublabel: tab.cwd ? shortCwd(tab.cwd) : undefined,
        onClick: () => openMarkCwd(tab.id),
      },
      {
        icon: "terminal",
        label: "Startup command…",
        checked: !!tab.startupCommand,
        onClick: () => setStartupCommandTabId(tab.id),
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

  /** Render a single tab row. Group members share their group's drop boundary. */
  function renderTab(t: Tab, inGroup: boolean) {
    const intent = () => dropIntent();
    const isActive = () => t.id === activeTabId();
    const isBefore = () => {
      const i = intent();
      return i?.kind === "before" && i.id === t.id;
    };
    const groupEdge = () => inGroup ? undefined : groupDropEdge("tab", t.id);
    const isGroupMerge = () => {
      const i = intent();
      return i?.kind === "group" && i.id === t.id;
    };
    return (
      <div
        class="bs-row bs-tabrow"
        data-tab-slot={t.id}
        aria-selected={isActive()}
        onMouseDown={(e) => startDrag(e, { kind: "tab", id: t.id })}
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
          ...(horiz ? hTabStyle : {}),
          height: horiz ? H.roomy : t.cwd ? "40px" : H.row,
          // Give the rename field room; a horizontal tab otherwise hugs its name.
          "min-width": horiz && renamingId() === t.id ? "140px" : undefined,
          // Background and foreground are class-driven; only slots go inline.
          "--btn-bg": isGroupMerge() ? C.accentBg : "transparent",
          "--btn-fg": isActive() ? C.text : C.text2,
          "--btn-fg-hover": C.text,
          // A coloured tab tints its own selected fill. base.css falls back to
          // --fill-selected where color-mix() is unsupported.
          // The active tab gets an accent (or its own colour) tint + outline,
          // plus the indicator bar below, so it stands out from its siblings.
          "--btn-bg-selected": `color-mix(in srgb, ${t.color ?? C.accent} 22%, transparent)`,
          "font-weight": isActive() ? 600 : 400,
          "box-shadow": isGroupMerge()
            ? `inset 0 0 0 1.5px ${C.accent}`
            : isActive()
              ? `inset 0 0 0 1px color-mix(in srgb, ${t.color ?? C.accent} 55%, transparent)`
              : "none",
          opacity: dragging()?.kind === "tab" && dragging()?.id === t.id ? 0.35 : 1,
        }}
        title={t.errorMessage ?? (horiz && t.cwd ? `${t.name}\n${t.cwd}` : t.name)}
      >
        <Show when={isBefore()}>
          <div style={horiz ? vDropBarStyle : dropBarStyle} />
        </Show>
        <Show when={groupEdge()}>{(edge) => <div style={groupDropBarStyle(edge(), horiz)} />}</Show>
        <Show when={t.color && !isActive()}>
          <div style={{ ...railStyle, background: t.color! }} />
        </Show>
        {/* Indicator: underline in the horizontal strip, left bar in the sidebar. */}
        <Show when={isActive()}>
          <div style={{ ...(horiz ? activeUnderlineStyle : activeSideBarStyle), background: t.color ?? C.accent }} />
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
        {/* Horizontal tabs are one line; the cwd moves into the tooltip. */}
        <Show when={t.cwd && !horiz}>
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
    const activeInside = () => group.collapsed && members.some((m) => m.id === activeTabId());
    const groupEdge = () => groupDropEdge("group", group.id);
    const beingMoved = () => dragging()?.kind === "group" && dragging()?.id === group.id;
    const editingName = () => renamingGroupId() === group.id;
    const headerFill = () => group.color
      ? `color-mix(in srgb, ${group.color} 12%, ${C.bg3})`
      : C.bg3;
    const groupLabel = () => `${group.name}, ${members.length} ${members.length === 1 ? "tab" : "tabs"}`
      + (activeInside() ? ", contains the active tab" : "");
    return (
      <div
        data-group-block={group.id}
        style={{
          ...(horiz ? hGroupBlockStyle : groupBlockStyle),
          // Horizontal groups read as one tinted island in the strip.
          background: horiz ? `color-mix(in srgb, ${group.color ?? C.text} 7%, transparent)` : undefined,
          opacity: beingMoved() ? 0.35 : 1,
        }}
      >
        <Show when={groupEdge()}>{(edge) => <div style={groupDropBarStyle(edge(), horiz)} />}</Show>
        <div
          class="bs-row"
          data-group-slot={group.id}
          role={editingName() ? undefined : "button"}
          tabindex={editingName() ? -1 : 0}
          aria-expanded={editingName() ? undefined : !group.collapsed}
          aria-label={editingName() ? undefined : groupLabel()}
          onMouseDown={(e) => startDrag(e, { kind: "group", id: group.id })}
          onClick={(e) => {
            if (e.detail === 0 || suppressGroupClick !== group.id) toggleGroupCollapsed(group.id);
          }}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              toggleGroupCollapsed(group.id);
            }
          }}
          onDblClick={(e) => {
            e.stopPropagation();
            if (suppressGroupClick !== group.id) setRenamingGroupId(group.id);
          }}
          onContextMenu={(e) => openGroupMenu(e, group)}
          style={{
            ...groupHeaderStyle,
            ...(horiz ? { height: H.default } : {}),
            cursor: beingMoved() ? "grabbing" : "grab",
            "--btn-bg": isHeaderTarget() ? C.accentBg : headerFill(),
            "--btn-bg-hover": isHeaderTarget() ? C.accentBg : `color-mix(in srgb, ${headerFill()} 94%, ${C.text})`,
            "--btn-fg": C.text,
            "box-shadow": isHeaderTarget() ? `inset 0 0 0 1.5px ${C.accent}` : "none",
          }}
          title={`${group.name} · ${group.collapsed ? "Click to expand" : "Click to collapse"}. Drag to reorder.`}
        >
          <div style={groupIconsStyle}>
            <Icon
              name="chevron-right"
              size={12}
              style={{
                color: C.text2,
                transform: group.collapsed ? "none" : "rotate(90deg)",
                transition: `transform ${M.d2} ${M.ease}`,
              }}
            />
            <Icon name={group.collapsed ? "folder" : "folder-open"} size={14} style={{ color: group.color ?? C.text2 }} />
          </div>
          <Show
            when={editingName()}
            fallback={<span style={horiz ? { ...groupNameStyle, "max-width": "120px" } : groupNameStyle}>{group.name}</span>}
          >
            <input
              value={group.name}
              aria-label="Group name"
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
          <Show when={activeInside()}>
            <span aria-hidden="true" title="Contains the active tab" style={activeGroupDotStyle} />
          </Show>
          <span aria-hidden="true" style={countPillStyle}>{members.length}</span>
        </div>
        <Show when={!group.collapsed}>
          <div style={horiz ? hGroupMembersStyle : groupMembersStyle}>
            <For each={members}>{(m) => renderTab(m, true)}</For>
          </div>
        </Show>
      </div>
    );
  }

  /** The menus live outside the (masked / scrolling) list: a mask clips its
   *  subtree and opens a stacking context, which would swallow a fixed popover. */
  const overlays = () => (
    <>
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
      <Show when={tabs().find((tab) => tab.id === startupCommandTabId())} keyed>
        {(tab) => <StartupCommandDialog tab={tab} onClose={() => setStartupCommandTabId(null)} />}
      </Show>
    </>
  );

  const renderRows = () => (
    <For each={rows()}>
      {(row) =>
        row.kind === "group"
          ? renderGroup(row.group, row.members)
          : renderTab(row.tab, false)
      }
    </For>
  );

  if (horiz) {
    let scroller: HTMLDivElement | undefined;
    // Keep the active tab visible when it changes (Ctrl+Tab, new tab, ...).
    createEffect(() => {
      const id = activeTabId();
      if (!id) return;
      queueMicrotask(() => {
        scroller
          ?.querySelector<HTMLElement>(`[data-tab-slot="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });

    // Overflow arrows: shown only when the strip overflows, each disabled at
    // its end. Re-measured on scroll, on resize and whenever the rows change.
    const [canLeft, setCanLeft] = createSignal(false);
    const [canRight, setCanRight] = createSignal(false);
    const measure = () => {
      if (!scroller) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      setCanLeft(scroller.scrollLeft > 1);
      setCanRight(scroller.scrollLeft < max - 1);
    };
    const resizeObserver = new ResizeObserver(measure);
    onCleanup(() => resizeObserver.disconnect());
    createEffect(() => {
      rows();
      renamingId();
      requestAnimationFrame(measure);
    });
    const scrollByPage = (dir: -1 | 1) =>
      scroller?.scrollBy({ left: dir * Math.max(120, scroller.clientWidth * 0.7), behavior: "smooth" });

    return (
      <div style={hBarStyle}>
        <Show when={canLeft() || canRight()}>
          <button
            class="bs-iconbtn bs-tip"
            data-tip="Scroll tabs left"
            aria-label="Scroll tabs left"
            disabled={!canLeft()}
            onClick={() => scrollByPage(-1)}
            style={hArrowBtnStyle}
          >
            <Icon name="chevron-left" size={16} stroke={2.5} />
          </button>
        </Show>
        <div
          ref={(el) => {
            scroller = el;
            resizeObserver.observe(el);
          }}
          class="bs-hscroll"
          style={hScrollStyle}
          onScroll={measure}
          // A plain mouse wheel scrolls the strip sideways.
          onWheel={(e) => {
            if (!scroller || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            scroller.scrollLeft += e.deltaY;
            e.preventDefault();
          }}
        >
          {renderRows()}
          <div data-tab-slot="__end__" style={hEndSlotStyle}>
            <Show when={dropIntent()?.kind === "end" && dragging()}>
              <div style={{ ...vDropBarStyle, left: "4px" }} />
            </Show>
          </div>
        </div>
        <Show when={canLeft() || canRight()}>
          <button
            class="bs-iconbtn bs-tip"
            data-tip="Scroll tabs right"
            aria-label="Scroll tabs right"
            disabled={!canRight()}
            onClick={() => scrollByPage(1)}
            style={hArrowBtnStyle}
          >
            <Icon name="chevron-right" size={16} stroke={2.5} />
          </button>
        </Show>
        <button
          class="bs-iconbtn bs-tip"
          data-tip="New tab (Ctrl+Shift+T)"
          aria-label="New tab"
          onClick={props.onNew}
          style={hNewBtnStyle}
        >
          <Icon name="plus" size={16} />
        </button>
        {overlays()}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: `${tabBarWidth()}px`, "flex-shrink": 0 }}>
      <div style={columnStyle}>
        <div class="bs-scroll-fade" style={scrollStyle}>
          {renderRows()}
          <div data-tab-slot="__end__" style={{ ...endSlotStyle, "flex-grow": dragging()?.kind === "group" ? 1 : 0 }}>
            <Show when={dropIntent()?.kind === "end" && dragging()}>
              <div style={{ ...dropBarStyle, top: "4px" }} />
            </Show>
          </div>
        </div>

        {/* Pinned below the scroller: the one creating action never scrolls out
         *  of reach, and its shortcut chip fades in on hover. */}
        <button class="bs-row bs-kbd-reveal" onClick={props.onNew} style={newBtnStyle}>
          <div style={leadSlotStyle}>
            <Icon name="plus" size={16} />
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

      {overlays()}
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

/** Tabs share a 16px leading slot, a name and trailing controls. */
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

const groupBlockStyle = {
  position: "relative",
  display: "flex",
  "flex-direction": "column",
  "flex-shrink": 0,
  gap: S[0.5],
  "padding-block": S[0.5],
} as const;

const groupHeaderStyle = {
  position: "relative",
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.row,
  padding: "0 8px 0 6px",
  "border-radius": R.sm,
  "user-select": "none",
} as const;

const groupIconsStyle = {
  display: "flex",
  "align-items": "center",
  "flex-shrink": 0,
  gap: S[1],
} as const;

const groupMembersStyle = {
  display: "flex",
  "flex-direction": "column",
  gap: "1px",
  "margin-left": S[3],
  "padding-left": S[2],
  "border-left": `1px solid ${C.border}`,
} as const;

const tabTopRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.row,
  width: "100%",
} as const;

/** The fixed leading slot for tab status dots and custom icons. */
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

function groupDropBarStyle(edge: DropEdge, horizontal = false) {
  if (horizontal) {
    return { ...vDropBarStyle, left: edge === "before" ? "-2px" : undefined, right: edge === "after" ? "-2px" : undefined, "z-index": 1 } as const;
  }
  return { ...dropBarStyle, top: edge === "before" ? "-1px" : undefined, bottom: edge === "after" ? "-1px" : undefined, "z-index": 1 } as const;
}

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
  ...T[12],
  "font-weight": 600,
} as const;

const activeGroupDotStyle = {
  width: S[1.5],
  height: S[1.5],
  "flex-shrink": 0,
  "border-radius": R.full,
  background: C.accent,
} as const;

const countPillStyle = {
  ...T[11],
  "font-weight": 500,
  "font-variant-numeric": "tabular-nums",
  color: C.text2,
  background: C.bg2,
  "min-width": "16px",
  height: "16px",
  padding: `0 ${S[1]}`,
  "border-radius": R.full,
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
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

/** Drop target for moving a tab or group to the bottom. */
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
  // Same height / border / fill as the CommandBar dock, so the two bottom
  // strips read as one continuous bar across the window.
  height: H.dock,
  // 10px, not 6px: the scroller above adds 4px of its own padding, so this is
  // what puts the leading slot on the same x as a tab row's.
  padding: "0 12px 0 10px",
  border: "none",
  "border-top": `1px solid ${C.border}`,
  cursor: "pointer",
  "flex-shrink": 0,
  ...T[13],
  "font-weight": 500,
  "--btn-bg": C.bg2,
  "--btn-bg-hover": C.accentBg,
  "--btn-fg": C.accent,
  "--btn-fg-hover": C.accentHover,
} as const;

/* ---------------------------------------------------------- horizontal */

/** The strip fills the header's free space; the list hugs its tabs so the
 *  "+" button sits right after the last one, browser-style. */
const hBarStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1],
  flex: "1 1 0",
  "min-width": 0,
  height: "100%",
} as const;

const hScrollStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[0.5],
  flex: "0 1 auto",
  "min-width": 0,
  height: "100%",
  "overflow-x": "auto",
  "overflow-y": "hidden",
} as const;

/** One-line tab that hugs its name, capped so a long name ellipsizes. */
const hTabStyle = {
  "flex-shrink": 0,
  "max-width": "200px",
  padding: "0 6px 0 8px",
} as const;

const hGroupBlockStyle = {
  position: "relative",
  display: "flex",
  "align-items": "center",
  "flex-shrink": 0,
  gap: S[0.5],
  padding: S[0.5],
  "border-radius": R.md,
} as const;

const hGroupMembersStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[0.5],
} as const;

/** Vertical insert marker for the horizontal strip. */
const vDropBarStyle = {
  position: "absolute",
  top: "4px",
  bottom: "4px",
  left: "-2px",
  width: "2px",
  "border-radius": R.full,
  background: C.accent,
  "pointer-events": "none",
} as const;

/** Drop target for moving a tab or group to the end of the strip. */
const hEndSlotStyle = {
  position: "relative",
  "align-self": "stretch",
  "min-width": S[3],
  "flex-shrink": 0,
} as const;

const hNewBtnStyle = {
  width: H.default,
  height: H.default,
  padding: "0",
  border: "none",
  cursor: "pointer",
  "flex-shrink": 0,
  "border-radius": R.sm,
  "--btn-fg": C.accent,
  "--btn-fg-hover": C.accentHover,
} as const;

/** Overflow scroll arrows either side of the strip. */
const hArrowBtnStyle = {
  width: H.roomy,
  height: H.roomy,
  padding: "0",
  border: `1px solid ${C.border}`,
  cursor: "pointer",
  "flex-shrink": 0,
  "border-radius": R.sm,
  "--btn-bg": C.bg3,
  "--btn-bg-hover": C.accentBg,
  "--btn-fg": C.accent,
  "--btn-fg-hover": C.accentHover,
} as const;

/** Accent underline marking the active tab in the horizontal strip. */
const activeUnderlineStyle = {
  position: "absolute",
  left: "8px",
  right: "8px",
  bottom: "0",
  height: "3px",
  "border-radius": R.full,
  "pointer-events": "none",
} as const;

/** Accent bar marking the active tab in the vertical sidebar. */
const activeSideBarStyle = {
  position: "absolute",
  left: "0",
  top: "6px",
  bottom: "6px",
  width: "3px",
  "border-radius": R.full,
  "pointer-events": "none",
} as const;
