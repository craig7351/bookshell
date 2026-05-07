import { createSignal, For, Show } from "solid-js";
import { api, type CommandButton } from "../ipc/api";
import { buttons, loadButtons } from "../stores/buttons";
import { activeTab } from "../stores/tabs";
import { C, overlayStyle, dialogStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";

interface Props {
  onEdit: () => void;
}

export function CommandBar(props: Props) {
  const [pendingConfirm, setPendingConfirm] = createSignal<CommandButton | null>(null);

  loadButtons();

  async function send(b: CommandButton) {
    const t = activeTab();
    if (!t || !t.sessionId) {
      alert("No active connected tab");
      return;
    }
    let payload = b.command;
    if (payload.includes("\n")) {
      // multi-line: send each line followed by CR (if send_enter)
      const lines = payload.split("\n");
      for (const line of lines) {
        await api.sshWrite(t.sessionId, line);
        await api.sshWrite(t.sessionId, "\r");
      }
      return;
    }
    await api.sshWrite(t.sessionId, payload);
    if (b.send_enter) await api.sshWrite(t.sessionId, "\r");
  }

  function handleClick(b: CommandButton) {
    if (b.confirm) {
      setPendingConfirm(b);
    } else {
      send(b);
    }
  }

  return (
    <div style={barStyle}>
      <For each={buttons()}>
        {(b) => (
          <button
            onClick={() => handleClick(b)}
            style={{
              ...btnStyle,
              background: b.color ?? C.bg3,
              color: b.color ? "#fff" : C.text,
            }}
            title={b.command}
          >
            {b.icon ? `${b.icon} ` : ""}
            {b.label}
          </button>
        )}
      </For>
      <button onClick={props.onEdit} style={editBtnStyle} title="Edit buttons">
        ⚙
      </button>

      <Show when={pendingConfirm()}>
        {(b) => (
          <div style={confirmOverlayStyle}>
            <div style={confirmDialogStyle}>
              <div style={{ "margin-bottom": "12px" }}>
                {b().confirm_text || `Run "${b().label}"?`}
              </div>
              <div
                style={{
                  background: C.bg,
                  border: `1px solid ${C.borderSub}`,
                  padding: "8px 10px",
                  "border-radius": "6px",
                  "font-family": "monospace",
                  "font-size": "12px",
                  color: C.text2,
                  "margin-bottom": "16px",
                  "white-space": "pre-wrap",
                  "word-break": "break-all",
                }}
              >
                {b().command}
              </div>
              <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px" }}>
                <button onClick={() => setPendingConfirm(null)} style={btnSecondary}>Cancel</button>
                <button
                  onClick={() => {
                    send(b());
                    setPendingConfirm(null);
                  }}
                  style={btnDanger}
                >
                  Run
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

const barStyle = {
  display: "flex",
  "flex-wrap": "wrap",
  gap: "5px",
  padding: "5px 8px",
  background: C.bg2,
  "border-top": `1px solid ${C.border}`,
  "align-items": "center",
} as const;

const btnStyle = {
  border: `1px solid ${C.border}`,
  "border-radius": "6px",
  padding: "3px 10px",
  "font-size": "12px",
  cursor: "pointer",
  "white-space": "nowrap",
  "max-width": "240px",
  overflow: "hidden",
  "text-overflow": "ellipsis",
} as const;

const editBtnStyle = {
  background: "transparent",
  color: C.text3,
  border: `1px dashed ${C.borderSub}`,
  "border-radius": "6px",
  padding: "3px 10px",
  cursor: "pointer",
  "font-size": "12px",
  "margin-left": "auto",
} as const;

const confirmOverlayStyle = overlayStyle;

const confirmDialogStyle = {
  ...dialogStyle,
  "min-width": "360px",
  "max-width": "500px",
} as const;
