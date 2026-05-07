import { createSignal, For, Show } from "solid-js";
import { CloseX } from "./CloseX";
import {
  buttons,
  loadButtons,
  newButtonId,
  removeButton,
  saveButton,
} from "../stores/buttons";
import type { CommandButton } from "../ipc/api";

interface Props {
  onClose: () => void;
}

const empty = (): CommandButton => ({
  id: newButtonId(),
  label: "",
  command: "",
  send_enter: true,
  confirm: false,
  confirm_text: null,
  hotkey: null,
  color: null,
  icon: null,
});

export function ButtonEditor(props: Props) {
  const [editing, setEditing] = createSignal<CommandButton | null>(null);

  loadButtons();

  function startEdit(b: CommandButton) {
    setEditing({ ...b });
  }
  function startNew() {
    setEditing(empty());
  }

  async function save() {
    const b = editing();
    if (!b) return;
    if (!b.label.trim() || !b.command.trim()) return;
    await saveButton(b);
    setEditing(null);
  }

  return (
    <div style={overlay}>
      <div style={dialog}>
        <CloseX onClose={props.onClose} />
        <div style={{ display: "flex", "align-items": "center", "margin-bottom": "12px", "padding-right": "32px" }}>
          <strong style={{ "font-size": "16px" }}>Command Buttons</strong>
          <button onClick={startNew} style={{ ...btn, "margin-left": "auto" }}>+ New</button>
        </div>

        <Show when={!editing()}>
          <Show when={buttons().length > 0} fallback={<div style={{ opacity: 0.6, padding: "20px", "text-align": "center" }}>No buttons. Click + New.</div>}>
            <For each={buttons()}>
              {(b) => (
                <div style={row}>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": 600 }}>
                      {b.icon ? `${b.icon} ` : ""}
                      {b.label}
                    </div>
                    <div style={{ "font-size": "12px", opacity: 0.7, "font-family": "monospace" }}>
                      {b.command.length > 60 ? b.command.slice(0, 60) + "…" : b.command}
                      {b.send_enter && <span style={{ opacity: 0.5 }}> ⏎</span>}
                      {b.confirm && <span style={{ color: "#fab387", "margin-left": "6px" }}>⚠ confirm</span>}
                    </div>
                  </div>
                  <button onClick={() => startEdit(b)} style={{ ...btn, background: "#45475a" }}>Edit</button>
                  <button onClick={() => removeButton(b.id)} style={{ ...btn, background: "#f38ba8" }}>×</button>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <Show when={editing()}>
          {(c) => (
            <div style={{ display: "grid", "grid-template-columns": "120px 1fr", gap: "8px", "align-items": "center" }}>
              <label>Label</label>
              <input style={input} value={c().label} onInput={(e) => setEditing({ ...c(), label: e.currentTarget.value })} />
              <label>Icon (emoji)</label>
              <input style={input} placeholder="optional, e.g. 🚀" value={c().icon ?? ""} onInput={(e) => setEditing({ ...c(), icon: e.currentTarget.value || null })} />
              <label>Command</label>
              <textarea
                style={{ ...input, "font-family": "monospace", "min-height": "60px", resize: "vertical" }}
                value={c().command}
                onInput={(e) => setEditing({ ...c(), command: e.currentTarget.value })}
                placeholder="e.g. git status&#10;Multi-line commands send each line."
              />
              <label>Send Enter</label>
              <label style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                <input type="checkbox" checked={c().send_enter} onChange={(e) => setEditing({ ...c(), send_enter: e.currentTarget.checked })} />
                <span style={{ opacity: 0.7, "font-size": "12px" }}>Append \r so the shell executes it</span>
              </label>
              <label>Confirm</label>
              <label style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                <input type="checkbox" checked={c().confirm} onChange={(e) => setEditing({ ...c(), confirm: e.currentTarget.checked })} />
                <span style={{ opacity: 0.7, "font-size": "12px" }}>Show confirm dialog before sending</span>
              </label>
              <Show when={c().confirm}>
                <label>Confirm text</label>
                <input style={input} placeholder="Are you sure?" value={c().confirm_text ?? ""} onInput={(e) => setEditing({ ...c(), confirm_text: e.currentTarget.value || null })} />
              </Show>
              <label>Color (hex)</label>
              <input style={input} placeholder="#cba6f7" value={c().color ?? ""} onInput={(e) => setEditing({ ...c(), color: e.currentTarget.value || null })} />
              <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
                <button onClick={() => setEditing(null)} style={{ ...btn, background: "#45475a" }}>Cancel</button>
                <button onClick={save} style={btn}>Save</button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: "0",
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "z-index": "100",
} as const;

const dialog = {
  position: "relative",
  background: "#1e1e2e",
  color: "#cdd6f4",
  border: "1px solid #45475a",
  "border-radius": "6px",
  padding: "16px",
  "min-width": "520px",
  "max-width": "720px",
  "max-height": "85vh",
  "overflow-y": "auto",
} as const;

const row = {
  display: "flex",
  gap: "8px",
  "align-items": "center",
  padding: "8px",
  "border-radius": "4px",
  background: "#181825",
  "margin-bottom": "6px",
} as const;

const input = {
  background: "#313244",
  color: "#cdd6f4",
  border: "1px solid #45475a",
  padding: "6px 8px",
  "border-radius": "4px",
  "font-size": "13px",
  outline: "none",
} as const;

const btn = {
  background: "#89b4fa",
  color: "#1e1e2e",
  border: "none",
  padding: "5px 12px",
  "border-radius": "4px",
  "font-size": "13px",
  cursor: "pointer",
  "font-weight": 600,
} as const;
