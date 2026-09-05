import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { C, FONT, M, R, S, SH, T } from "../theme";
import { Icon, type IconName } from "../icons";
import { usePopoverPosition } from "./ui/usePopoverPosition";

/**
 * The app's one context menu.
 *
 * A row carries four optional visual fields beyond its label — a leading glyph
 * (SVG, emoji or colour swatch), a trailing ✓, a trailing shortcut chip and a
 * submenu arrow — so a menu can say "this is the current value" and "this has
 * a key" without inventing per-call markup. Interaction state belongs to the
 * `.bs-menu-item` class: this file only fills the --btn-* slots.
 */

export interface MenuItem {
  label: string;
  /** Leading 14px monochrome glyph. */
  icon?: IconName;
  /**
   * Leading emoji. Only for user content — the tab-icon picker is the one
   * menu that legitimately shows emoji (section 3.7).
   */
  emoji?: string;
  /**
   * Leading colour swatch: a 10px dot, always ringed, so `"transparent"`
   * reads as "no colour" rather than as a hole.
   */
  swatch?: string;
  /** Trailing accent ✓ — this row is the current value of its group. */
  checked?: boolean;
  /** Trailing key cap, e.g. `F2`. Never part of the label. */
  shortcut?: string;
  /** Optional muted second line below the label — used for long secondary
   *  context (a path, a hint, the current value) that would otherwise blow
   *  out the menu width. */
  sublabel?: string;
  onClick?: () => void;
  separator?: boolean;
  danger?: boolean;
  /** Visible and hoverable, just inert — never `pointer-events: none`. */
  disabled?: boolean;
  submenu?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: Props) {
  const [submenuFor, setSubmenuFor] = createSignal<number | null>(null);
  const [anchor, setAnchor] = createSignal<DOMRect | null>(null);

  const menu = usePopoverPosition(() => ({
    x: props.x,
    y: props.y,
    flipRightTo: props.x,
    flipBottomTo: props.y,
  }));

  function handleGlobalClick(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest("[data-context-menu]")) {
      props.onClose();
    }
  }
  function handleEsc(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }

  onMount(() => {
    setTimeout(() => document.addEventListener("mousedown", handleGlobalClick), 0);
    document.addEventListener("keydown", handleEsc);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", handleGlobalClick);
    document.removeEventListener("keydown", handleEsc);
  });

  return (
    <Portal>
      <div
        data-context-menu
        role="menu"
        ref={menu.ref}
        style={{ ...surfaceStyle, ...menu.style(), "min-width": "200px", "max-width": "320px" }}
      >
        <For each={props.items}>
          {(item, i) => (
            <Show when={!item.separator} fallback={<div role="separator" style={separatorStyle} />}>
              <div
                class="bs-menu-item"
                role="menuitem"
                aria-disabled={item.disabled ? "true" : undefined}
                aria-haspopup={item.submenu ? "true" : undefined}
                aria-expanded={item.submenu ? submenuFor() === i() : undefined}
                onClick={() => {
                  if (item.disabled || item.submenu) return;
                  item.onClick?.();
                  props.onClose();
                }}
                onMouseEnter={(e) => {
                  if (item.submenu && !item.disabled) {
                    setAnchor(e.currentTarget.getBoundingClientRect());
                    setSubmenuFor(i());
                  } else {
                    setSubmenuFor(null);
                  }
                }}
                style={rowStyle(item)}
              >
                <Leading item={item} />
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={labelStyle}>{item.label}</div>
                  <Show when={item.sublabel}>
                    <div style={sublabelStyle}>{item.sublabel}</div>
                  </Show>
                </div>
                <Show when={item.shortcut}>
                  <kbd>{item.shortcut}</kbd>
                </Show>
                <Show when={item.checked}>
                  <span style={{ color: C.accent, display: "flex" }}>
                    <Icon name="check" size={12} stroke={2} />
                  </span>
                </Show>
                <Show when={item.submenu}>
                  <span style={{ color: C.text3, display: "flex" }}>
                    <Icon name="chevron-right" size={12} />
                  </span>
                </Show>
                <Show when={item.submenu && submenuFor() === i() && anchor()}>
                  {(rect) => (
                    <Submenu items={item.submenu!} anchor={rect()} onClose={props.onClose} />
                  )}
                </Show>
              </div>
            </Show>
          )}
        </For>
      </div>
    </Portal>
  );
}

/** How far a submenu overlaps its parent row, in px — the pointer must never
 *  cross a gap on its way in. Matches S[1]. */
const OVERLAP = 4;

/**
 * A second level, anchored on its parent row. It renders through its own
 * Portal: the parent menu animates with a transform, and a transformed
 * ancestor becomes the containing block of any `position: fixed` descendant,
 * which would turn the submenu's viewport coordinates into an offset from the
 * menu and throw it into the bottom-right corner. Hover is not affected — the
 * row only ever *opens* a submenu on mouseenter and never closes it on leave,
 * so the pointer can cross the 4px overlap into the portaled surface freely.
 * `data-context-menu` keeps the global outside-click handler from treating a
 * click inside the submenu as "outside".
 */
function Submenu(props: { items: MenuItem[]; anchor: DOMRect; onClose: () => void }) {
  const pop = usePopoverPosition(() => ({
    // Overlap the parent edge by 4px so the pointer never crosses a gap.
    x: props.anchor.right - OVERLAP,
    y: props.anchor.top - OVERLAP,
    flipRightTo: props.anchor.left + OVERLAP,
  }));

  return (
    <Portal>
    <div
      data-context-menu
      role="menu"
      ref={pop.ref}
      style={{
        ...surfaceStyle,
        ...pop.style(),
        "min-width": "150px",
        "max-width": "260px",
        animation: `bs-pop-in ${M.d1} ${M.easePop} both`,
      }}
    >
      <For each={props.items}>
        {(sub) => (
          <div
            class="bs-menu-item"
            role="menuitem"
            aria-disabled={sub.disabled ? "true" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (sub.disabled) return;
              sub.onClick?.();
              props.onClose();
            }}
            style={rowStyle(sub)}
          >
            <Leading item={sub} />
            <div style={{ ...labelStyle, flex: 1, "min-width": 0 }}>{sub.label}</div>
            <Show when={sub.checked}>
              <span style={{ color: C.accent, display: "flex" }}>
                <Icon name="check" size={12} stroke={2} />
              </span>
            </Show>
          </div>
        )}
      </For>
    </div>
    </Portal>
  );
}

/** Fixed-width leading column, reserved even when empty so every label in a
 *  menu starts on the same x. Holds a swatch, an emoji or an SVG glyph. */
function Leading(props: { item: MenuItem }) {
  return (
    <span style={leadingStyle}>
      <Show when={props.item.swatch !== undefined}>
        <span style={{ ...swatchStyle, background: props.item.swatch! }} />
      </Show>
      <Show when={props.item.emoji}>
        <span style={emojiStyle}>{props.item.emoji}</span>
      </Show>
      <Show when={!props.item.swatch && !props.item.emoji && props.item.icon}>
        {(name) => <Icon name={name()} size={14} />}
      </Show>
    </span>
  );
}

/** Colour is a slot, not a property: `.bs-menu-item` owns hover / active. */
function rowStyle(item: MenuItem) {
  return {
    display: "flex",
    "align-items": "center",
    gap: S[2],
    position: "relative" as const,
    "min-height": "24px",
    padding: `${S[0.5]} ${S[2]}`,
    margin: `0 ${S[1]}`,
    cursor: "default",
    "--btn-fg": item.danger ? C.red : C.text,
    "--btn-bg-hover": item.danger ? C.redBg : C.bgActive,
    "--btn-bg-active": item.danger ? C.redBg : C.bgSelected,
  };
}

const surfaceStyle = {
  background: C.overlay,
  border: `1px solid ${C.border}`,
  "border-radius": R.lg,
  padding: `${S[1]} 0`,
  "box-shadow": `${SH.e2}, ${SH.hlTop}`,
  "z-index": "200",
  ...T[12],
  color: C.text,
  "transform-origin": "top left",
  animation: `bs-pop-in ${M.d2} ${M.easePop} both`,
} as const;

const separatorStyle = {
  height: "1px",
  background: C.borderSub,
  margin: `${S[1]} 0`,
} as const;

const leadingStyle = {
  width: "16px",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "flex-shrink": 0,
} as const;

const swatchStyle = {
  width: "10px",
  height: "10px",
  "border-radius": R.full,
  border: `1px solid ${C.border}`,
  "box-sizing": "border-box",
} as const;

const emojiStyle = {
  ...T[12],
  "line-height": "1",
} as const;

const labelStyle = {
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const sublabelStyle = {
  ...T[11],
  color: C.text3,
  "font-family": FONT.mono,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;
