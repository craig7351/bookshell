import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { C } from "../theme";

export interface MenuItem {
  label: string;
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
          "min-width": "172px",
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
                  padding: "5px 14px",
                  cursor: "default",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  position: "relative",
                  color: item.danger ? C.red : C.text,
                  "border-radius": "6px",
                  margin: "0 4px",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = C.bgHover)}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
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
                          style={{ padding: "5px 14px", cursor: "default", "border-radius": "6px", margin: "0 4px" }}
                          onMouseOver={(e) => (e.currentTarget.style.background = C.bgHover)}
                          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          {sub.label}
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
