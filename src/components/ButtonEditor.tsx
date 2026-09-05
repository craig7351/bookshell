import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CloseX } from "./CloseX";
import {
  C,
  FONT,
  R,
  RAW,
  btnDanger,
  btnPrimary,
  btnSecondary,
  dialogStyle as baseDialog,
  inputStyle,
  overlayStyle as baseOverlay,
} from "../theme";
import {
  buttons,
  loadButtons,
  moveButton,
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

  // ESC closes the dialog (or backs out of the edit form).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing()) {
        e.preventDefault();
        setEditing(null);
      } else {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

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
          <strong style={{ "font-size": "15px" }}>Command Buttons</strong>
          <button onClick={startNew} style={{ ...btnPrimary, "margin-left": "auto" }}>+ New</button>
        </div>

        <Show when={!editing()}>
          <Show when={buttons().length > 0} fallback={<div style={{ opacity: 0.6, padding: "20px", "text-align": "center" }}>No buttons. Click + New.</div>}>
            <For each={buttons()}>
              {(b, i) => (
                <div style={row}>
                  <div style={reorderCol}>
                    <button
                      onClick={() => moveButton(b.id, -1)}
                      disabled={i() === 0}
                      style={{ ...arrowBtn, opacity: i() === 0 ? 0.3 : 0.7 }}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveButton(b.id, 1)}
                      disabled={i() === buttons().length - 1}
                      style={{ ...arrowBtn, opacity: i() === buttons().length - 1 ? 0.3 : 0.7 }}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": 600 }}>
                      {b.icon ? `${b.icon} ` : ""}
                      {b.label}
                    </div>
                    <div style={{ "font-size": "12px", opacity: 0.7, "font-family": FONT.mono }}>
                      {b.command.length > 60 ? b.command.slice(0, 60) + "…" : b.command}
                      {b.send_enter && <span style={{ opacity: 0.5 }}> ⏎</span>}
                      {b.confirm && <span style={{ color: C.orange, "margin-left": "6px" }}>⚠ confirm</span>}
                    </div>
                  </div>
                  <button onClick={() => startEdit(b)} style={btnSecondary}>Edit</button>
                  <button onClick={() => removeButton(b.id)} style={btnDanger}>×</button>
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
                style={{ ...input, "font-family": FONT.mono, "min-height": "60px", resize: "vertical" }}
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
              <input style={input} placeholder={RAW.orange} value={c().color ?? ""} onInput={(e) => setEditing({ ...c(), color: e.currentTarget.value || null })} />
              <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
                <button onClick={() => setEditing(null)} style={btnSecondary}>Cancel</button>
                <button onClick={save} style={btnPrimary}>Save</button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

const overlay = baseOverlay;

const dialog = {
  ...baseDialog,
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
  "border-radius": R.sm,
  background: C.bg,
  "margin-bottom": "6px",
} as const;

const input = {
  ...inputStyle,
  width: "100%",
  "box-sizing": "border-box",
} as const;

const reorderCol = {
  display: "flex",
  "flex-direction": "column",
  gap: "1px",
  "margin-right": "4px",
} as const;

const arrowBtn = {
  background: "transparent",
  color: C.text2,
  border: `1px solid ${C.border}`,
  "border-radius": R.xs,
  padding: "1px 6px",
  "font-size": "10px",
  "line-height": "1",
  cursor: "pointer",
} as const;
