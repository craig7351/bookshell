import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { button, C, H, R, S, T } from "../theme";
import { Icon, type IconName } from "../icons";
import { DialogFrame } from "./ui/DialogFrame";
import { EmptyState } from "./ui/EmptyState";
import { ConnectionForm } from "./ConnectionForm";
import {
  connections,
  connectionDescription,
  connectionUnavailable,
  deleteConnection,
  moveConnection,
  newConnection,
} from "../stores/connections";
import type { Connection } from "../ipc/api";

interface Props {
  onConnect: (conn: Connection, password: string) => void;
  onClose: () => void;
}

export function ConnectionDialog(props: Props) {
  const [editing, setEditing] = createSignal<Connection | null>(null);
  const [pwPrompt, setPwPrompt] = createSignal<{ conn: Connection; pw: string } | null>(null);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  let dialogRef: HTMLDivElement | undefined;

  // Keyboard for the list view: ESC closes the dialog (or backs out of a
  // sub-state); Up/Down moves the selection; Enter opens the selected
  // connection. Edit form / password prompt have their own inputs and
  // are skipped here.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing()) {
          e.preventDefault();
          setEditing(null);
        } else if (pwPrompt()) {
          e.preventDefault();
          setPwPrompt(null);
        } else {
          e.preventDefault();
          props.onClose();
        }
        return;
      }
      if (editing() || pwPrompt()) return;
      const list = connections();
      if (list.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const idx = Math.min(selectedIdx(), list.length - 1);
        pickConnection(list[idx]);
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus to the dialog so the hidden xterm textarea stops
    // receiving keystrokes — otherwise typing in the dialog leaks
    // through to the background console.
    dialogRef?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // Keep the highlighted row visible when the list is long enough to scroll.
  createEffect(() => {
    const idx = selectedIdx();
    if (editing() || pwPrompt()) return;
    const row = dialogRef?.querySelector(`[data-conn-idx="${idx}"]`) as HTMLElement | null;
    row?.scrollIntoView({ block: "nearest" });
  });

  function startEdit(c: Connection) {
    setEditing({ ...c });
  }
  function startNew() {
    setEditing(newConnection());
  }

  function pickConnection(c: Connection) {
    if (connectionUnavailable(c)) return;
    if (c.kind !== "ssh") {
      props.onConnect(c, "");
      return;
    }
    if (c.password && c.password.length > 0) {
      props.onConnect(c, c.password);
    } else {
      setPwPrompt({ conn: c, pw: "" });
    }
  }

  const title = () => {
    if (editing()) return "Edit connection";
    if (pwPrompt()) return "Password";
    return "Connections";
  };

  return (
    <DialogFrame
      ref={(el) => (dialogRef = el)}
      title={title()}
      label="Connections"
      onClose={props.onClose}
      width="600px"
      dismissOnScrim={false}
      actions={
        <Show when={!editing() && !pwPrompt()}>
          <button class="bs-btn" onClick={startNew} style={button("primary", "default")}>
            <Icon name="plus" size={12} stroke={2} />
            New
          </button>
        </Show>
      }
    >
      <Show when={!editing() && !pwPrompt()}>
        <Show
          when={connections().length > 0}
          fallback={
            <EmptyState
              icon="plug"
              title="No saved connections"
              description="Create one and it stays a keystroke away."
              action={
                <button class="bs-btn" onClick={startNew} style={button("primary", "roomy")}>
                  <Icon name="plus" size={14} stroke={2} />
                  New connection
                </button>
              }
            />
          }
        >
          <div role="listbox" aria-label="Saved connections" style={listStyle}>
            <For each={connections()}>
              {(c, i) => (
                <div
                  class="bs-row"
                  role="option"
                  tabindex="0"
                  data-conn-idx={i()}
                  aria-selected={i() === selectedIdx()}
                  aria-disabled={connectionUnavailable(c) || undefined}
                  onFocus={() => setSelectedIdx(i())}
                  onMouseDown={() => setSelectedIdx(i())}
                  onClick={() => pickConnection(c)}
                  style={rowStyle}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={rowTitleStyle}>{c.name}</div>
                    <div style={rowMetaStyle}>
                      {connectionDescription(c)}
                    </div>
                  </div>
                  {/* Reorder keeps ▲▼ semantics deliberately: there is no drag
                      implementation behind these rows, so a grip handle would
                      promise something the list cannot do. */}
                  <div class="bs-row-actions">
                    <RowIconButton
                      icon="arrow-up"
                      label="Move up"
                      disabled={i() === 0}
                      onClick={() => moveConnection(c.id, -1)}
                    />
                    <RowIconButton
                      icon="arrow-down"
                      label="Move down"
                      disabled={i() === connections().length - 1}
                      onClick={() => moveConnection(c.id, 1)}
                    />
                    <RowIconButton
                      icon="plug"
                      label="Connect"
                      tone="accent"
                      disabled={connectionUnavailable(c)}
                      onClick={() => pickConnection(c)}
                    />
                    <RowIconButton icon="pencil" label="Edit" onClick={() => startEdit(c)} />
                    <RowIconButton
                      icon="x"
                      label="Delete"
                      tone="danger"
                      onClick={() => deleteConnection(c.id)}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={editing()} keyed>
        {(connection) => <ConnectionForm initial={connection} onClose={() => setEditing(null)} />}
      </Show>

      <Show when={pwPrompt()}>
        {(p) => (
          <div style={formStyle}>
            <div style={{ "grid-column": "1 / -1", ...T[13], color: C.text2 }}>
              Password for <strong style={{ "font-weight": 600, color: C.text }}>{p().conn.user}@{p().conn.host}</strong>
            </div>
            <label style={labelStyle}>Password</label>
            <input
              class="bs-input"
              type="password"
              style={input}
              autofocus
              value={p().pw}
              onInput={(e) => setPwPrompt({ conn: p().conn, pw: e.currentTarget.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  props.onConnect(p().conn, p().pw);
                  setPwPrompt(null);
                }
              }}
            />
            <div style={formActionsStyle}>
              <button class="bs-btn" onClick={() => setPwPrompt(null)} style={button("secondary", "roomy")}>Cancel</button>
              <button
                class="bs-btn"
                onClick={() => { props.onConnect(p().conn, p().pw); setPwPrompt(null); }}
                style={button("primary", "roomy")}
              >
                Connect
              </button>
            </div>
          </div>
        )}
      </Show>
    </DialogFrame>
  );
}

/** A ghost icon button revealed by `.bs-row-actions` when its row is hovered
 *  or holds focus. Never a filled block at idle — a list of saved hosts is
 *  text first. */
function RowIconButton(props: {
  icon: IconName;
  label: string;
  tone?: "danger" | "accent";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="bs-iconbtn"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      style={{
        width: H.default,
        height: H.default,
        padding: "0",
        border: "1px solid transparent",
        cursor: "pointer",
        "--btn-bg": "transparent",
        "--btn-fg": C.text3,
        "--btn-bg-hover":
          props.tone === "danger" ? C.redBg : props.tone === "accent" ? C.accentBg : C.bgHover,
        "--btn-fg-hover":
          props.tone === "danger" ? C.red : props.tone === "accent" ? C.accent : C.text,
      }}
    >
      <Icon name={props.icon} size={14} stroke={props.icon === "x" ? 2 : 1.75} />
    </button>
  );
}

const listStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: "2px",
  "min-width": 0,
};

const rowStyle: JSX.CSSProperties = {
  display: "flex",
  gap: S[2],
  "align-items": "center",
  padding: `${S[1.5]} ${S[2]}`,
  "border-radius": R.sm,
  "min-width": 0,
  cursor: "pointer",
  "user-select": "none",
  "--btn-bg": "transparent",
};

const rowTitleStyle: JSX.CSSProperties = {
  ...T[13],
  "font-weight": 500,
  color: C.text,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const rowMetaStyle: JSX.CSSProperties = {
  ...T[11],
  color: C.text3,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const formStyle: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "110px 1fr",
  gap: S[2],
  "align-items": "center",
};

const labelStyle: JSX.CSSProperties = {
  ...T[12],
  color: C.text2,
};

const formActionsStyle: JSX.CSSProperties = {
  "grid-column": "1 / -1",
  display: "flex",
  "justify-content": "flex-end",
  gap: S[2],
  "margin-top": S[2],
};

/** Geometry only — `.bs-input` owns surface, border and focus ring. */
const input: JSX.CSSProperties = {
  height: H.roomy,
  padding: `0 ${S[2]}`,
  ...T[13],
  width: "100%",
  "box-sizing": "border-box",
  "font-family": "inherit",
};
