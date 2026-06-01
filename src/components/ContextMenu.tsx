import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { C } from "../theme";

export interface MenuItem {
  label: string;
  /** Optional leading glyph (emoji or unicode). Rendered in a fixed-width
   *  column so labels align across rows whether an icon is set or not. */
  icon?: string;
  /** Optional muted second line below the label — used for long secondary
   *  context (a path, a hint, the current value) that would otherwise blow
   *  out the menu width. */
  sublabel?: string;
  onClick?: () => void;
  separator?: boolean;
  danger?: boolean;
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
        style={{
          position: "fixed",
          left: `${props.x}px`,
          top: `${props.y}px`,
          background: "rgba(38,38,40,0.95)",
          "backdrop-filter": "blur(20px) saturate(180%)",
          border: `1px solid ${C.border}`,
          "border-radius": "10px",
          padding: "5px 0",
          "min-width": "200px",
          "max-width": "320px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)",
          "z-index": "200",
          "font-size": "13px",
          color: C.text,
        }}
      >
        <For each={props.items}>
          {(item, i) => (
            <Show
              when={!item.separator}
              fallback={<div style={{ height: "1px", background: C.borderSub, margin: "4px 0" }} />}
            >
              <div
                onClick={() => {
                  if (item.submenu) return;
                  item.onClick?.();
                  props.onClose();
                }}
                onMouseEnter={() => setSubmenuFor(item.submenu ? i() : null)}
                style={{
                  padding: "5px 12px",
                  cursor: "default",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  position: "relative",
                  color: item.danger ? C.red : C.text,
                  "border-radius": "6px",
                  margin: "0 4px",
                }}
                onMouseOver={(e) =>
                  (e.currentTarget.style.background = item.danger ? C.redBg : C.bgHover)
                }
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={iconColStyle}>{item.icon ?? ""}</span>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={labelStyle}>{item.label}</div>
                  <Show when={item.sublabel}>
                    <div style={sublabelStyle}>{item.sublabel}</div>
                  </Show>
                </div>
                {item.submenu && <span style={{ opacity: 0.5, "font-size": "11px" }}>▸</span>}
                <Show when={item.submenu && submenuFor() === i()}>
                  <div
                    style={{
                      position: "absolute",
                      left: "100%",
                      top: "0",
                      background: "rgba(38,38,40,0.95)",
                      "backdrop-filter": "blur(20px) saturate(180%)",
                      border: `1px solid ${C.border}`,
                      "border-radius": "10px",
                      padding: "5px 0",
                      "min-width": "130px",
                      "box-shadow": "0 8px 32px rgba(0,0,0,0.55)",
                    }}
                  >
                    <For each={item.submenu}>
                      {(sub) => (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            sub.onClick?.();
                            props.onClose();
                          }}
                          style={{
                            padding: "5px 12px",
                            cursor: "default",
                            "border-radius": "6px",
                            margin: "0 4px",
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            color: sub.danger ? C.red : C.text,
                          }}
                          onMouseOver={(e) =>
                            (e.currentTarget.style.background = sub.danger ? C.redBg : C.bgHover)
                          }
                          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <span style={iconColStyle}>{sub.icon ?? ""}</span>
                          <span>{sub.label}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          )}
        </For>
      </div>
    </Portal>
  );
}

/** Fixed-width column for the leading icon. Reserved even when empty so
 *  labels in the same menu stay vertically aligned. */
const iconColStyle = {
  width: "16px",
  "text-align": "center",
  "flex-shrink": 0,
  "font-size": "13px",
  "line-height": "1",
} as const;

const labelStyle = {
  "line-height": "1.3",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const sublabelStyle = {
  "font-size": "11px",
  color: C.text3,
  "font-family": "monospace",
  "line-height": "1.3",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "margin-top": "1px",
} as const;
