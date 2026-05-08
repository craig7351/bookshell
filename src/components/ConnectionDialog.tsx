import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { C, overlayStyle as baseOverlay, dialogStyle as baseDialog, inputStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";
import { CloseX } from "./CloseX";
import {
  connections,
  defaultLocalShell,
  deleteConnection,
  moveConnection,
  newConnectionId,
  upsertConnection,
} from "../stores/connections";
import type { Connection } from "../ipc/api";

interface Props {
  onConnect: (conn: Connection, password: string) => void;
  onClose: () => void;
}

const empty = (): Connection => ({
  id: newConnectionId(),
  name: "",
  kind: "ssh",
  host: "",
  port: 22,
  user: "",
  auth: "password",
  password: "",
  shell: null,
  cwd: null,
});

export function ConnectionDialog(props: Props) {
  const [editing, setEditing] = createSignal<Connection | null>(null);
  const [pwPrompt, setPwPrompt] = createSignal<{ conn: Connection; pw: string } | null>(null);

  // ESC closes the dialog. When a sub-state (edit form / password prompt)
  // is open, ESC backs out of that state first instead of closing outright.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  function startEdit(c: Connection) {
    setEditing({ ...c });
  }
  function startNew() {
    setEditing(empty());
  }

  async function save() {
    const c = editing();
    if (!c) return;
    if (!c.name.trim()) c.name = c.host;
    await upsertConnection(c);
    setEditing(null);
  }

  function pickConnection(c: Connection) {
    if (c.kind === "local") {
      // Local connections need no credentials; just hand back to caller.
      props.onConnect(c, "");
      return;
    }
    if (c.password && c.password.length > 0) {
      props.onConnect(c, c.password);
    } else {
      setPwPrompt({ conn: c, pw: "" });
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <CloseX onClose={props.onClose} />
        <div style={{ display: "flex", "align-items": "center", "margin-bottom": "12px", "padding-right": "32px" }}>
          <strong style={{ "font-size": "16px" }}>Connections</strong>
          <button onClick={startNew} style={{ ...btnPrimary, "margin-left": "auto" }}>+ New</button>
        </div>

        <Show when={!editing() && !pwPrompt()}>
          <Show
            when={connections().length > 0}
            fallback={<div style={{ opacity: 0.6, padding: "20px", "text-align": "center" }}>No saved connections. Click + New.</div>}
          >
            <For each={connections()}>
              {(c, i) => (
                <div style={rowStyle}>
                  <div style={reorderColStyle}>
                    <button
                      onClick={() => moveConnection(c.id, -1)}
                      disabled={i() === 0}
                      style={{ ...arrowBtn, opacity: i() === 0 ? 0.3 : 0.7 }}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveConnection(c.id, 1)}
                      disabled={i() === connections().length - 1}
                      style={{ ...arrowBtn, opacity: i() === connections().length - 1 ? 0.3 : 0.7 }}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": 600 }}>{c.name}</div>
                    <div style={{ "font-size": "12px", opacity: 0.7 }}>
                      {c.kind === "local"
                        ? `📟 local · ${c.shell ?? defaultLocalShell()}`
                        : `${c.user}@${c.host}:${c.port}`}
                    </div>
                  </div>
                  <button onClick={() => pickConnection(c)} style={btnPrimary}>Connect</button>
                  <button onClick={() => startEdit(c)} style={btnSecondary}>Edit</button>
                  <button onClick={() => deleteConnection(c.id)} style={btnDanger}>×</button>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <Show when={editing()}>
          {(c) => (
            <div style={{ display: "grid", "grid-template-columns": "100px 1fr", gap: "8px", "align-items": "center" }}>
              <label>Type</label>
              <div style={{ display: "flex", gap: "12px" }}>
                <label style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="kind"
                    checked={c().kind === "ssh"}
                    onChange={() => setEditing({ ...c(), kind: "ssh" })}
                  />
                  SSH (remote)
                </label>
                <label style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="kind"
                    checked={c().kind === "local"}
                    onChange={() => setEditing({ ...c(), kind: "local", shell: c().shell || defaultLocalShell() })}
                  />
                  Local (shell on this machine)
                </label>
              </div>

              <label>Name</label>
              <input style={input} value={c().name} onInput={(e) => setEditing({ ...c(), name: e.currentTarget.value })} />

              <Show when={c().kind === "ssh"}>
                <label>Host</label>
                <input style={input} value={c().host} onInput={(e) => setEditing({ ...c(), host: e.currentTarget.value })} />
                <label>Port</label>
                <input type="number" style={input} value={c().port} onInput={(e) => setEditing({ ...c(), port: parseInt(e.currentTarget.value) || 22 })} />
                <label>User</label>
                <input style={input} value={c().user} onInput={(e) => setEditing({ ...c(), user: e.currentTarget.value })} />
                <label>Password</label>
                <input type="password" style={input} placeholder="(leave empty to prompt each time)" value={c().password ?? ""} onInput={(e) => setEditing({ ...c(), password: e.currentTarget.value })} />
              </Show>

              <Show when={c().kind === "local"}>
                <label>Shell</label>
                <input
                  style={input}
                  placeholder={defaultLocalShell()}
                  value={c().shell ?? ""}
                  onInput={(e) => setEditing({ ...c(), shell: e.currentTarget.value || null })}
                />
                <label>Working dir</label>
                <input
                  style={input}
                  placeholder="(default: home directory)"
                  value={c().cwd ?? ""}
                  onInput={(e) => setEditing({ ...c(), cwd: e.currentTarget.value || null })}
                />
              </Show>

              <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
                <button onClick={() => setEditing(null)} style={btnSecondary}>Cancel</button>
                <button onClick={save} style={btnPrimary}>Save</button>
              </div>
            </div>
          )}
        </Show>

        <Show when={pwPrompt()}>
          {(p) => (
            <div style={{ display: "grid", "grid-template-columns": "100px 1fr", gap: "8px" }}>
              <div style={{ "grid-column": "1 / -1", "margin-bottom": "8px" }}>
                Password for <strong>{p().conn.user}@{p().conn.host}</strong>:
              </div>
              <label>Password</label>
              <input
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
              <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
                <button onClick={() => setPwPrompt(null)} style={btnSecondary}>Cancel</button>
                <button onClick={() => { props.onConnect(p().conn, p().pw); setPwPrompt(null); }} style={btnPrimary}>Connect</button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

const overlayStyle = baseOverlay;

const dialogStyle = {
  ...baseDialog,
  "min-width": "480px",
  "max-width": "640px",
  "max-height": "80vh",
  "overflow-y": "auto",
} as const;

const rowStyle = {
  display: "flex",
  gap: "8px",
  "align-items": "center",
  padding: "10px 12px",
  "border-radius": "8px",
  background: C.bg3,
  "margin-bottom": "6px",
  "user-select": "none",
} as const;

const reorderColStyle = {
  display: "flex",
  "flex-direction": "column",
  gap: "1px",
  "margin-right": "4px",
} as const;

const arrowBtn = {
  background: "transparent",
  color: C.text2,
  border: `1px solid ${C.border}`,
  "border-radius": "4px",
  padding: "1px 6px",
  "font-size": "9px",
  "line-height": "1",
  cursor: "pointer",
} as const;

const input = inputStyle;
