import { createSignal, For, Show } from "solid-js";
import { api, type CommandButton } from "../ipc/api";
import { buttons, loadButtons } from "../stores/buttons";
import { activeTab, bumpFit } from "../stores/tabs";
import { C, FONT, R, overlayStyle, dialogStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";

interface Props {
  onEdit: () => void;
}

export function CommandBar(props: Props) {
  const [pendingConfirm, setPendingConfirm] = createSignal<CommandButton | null>(null);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);

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
    } else {
      await api.sshWrite(t.sessionId, payload);
      if (b.send_enter) await api.sshWrite(t.sessionId, "\r");
    }
    // Return focus to the terminal so the user can keep typing without an
    // extra click. fitTick effect in Terminal.tsx handles the actual focus.
    bumpFit(t.id);
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
        {(b) => {
          // Ghost style: transparent background, colored border/text when the
          // user set a color, neutral chrome otherwise. Hover fills with a
          // subtle wash so the button still gives tactile feedback without
          // shouting at idle.
          const colored = !!b.color;
          const hovered = () => hoveredId() === b.id;
          return (
            <button
              onClick={() => handleClick(b)}
              onMouseEnter={() => setHoveredId(b.id)}
              onMouseLeave={() => setHoveredId((id) => (id === b.id ? null : id))}
              style={{
                ...btnStyle,
                background: hovered() ? C.bgHover : "transparent",
                color: colored ? (b.color as string) : C.text2,
                "border-color": colored ? (b.color as string) : C.border,
              }}
              title={b.command}
            >
              {b.icon ? `${b.icon} ` : ""}
              {b.label}
            </button>
          );
        }}
      </For>
      <div style={editSepStyle} />
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
                  "border-radius": R.sm,
                  "font-family": FONT.mono,
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
  gap: "6px",
  padding: "6px 10px",
  background: C.bg2,
  "border-top": `1px solid ${C.border}`,
  "align-items": "center",
} as const;

const btnStyle = {
  border: `1px solid ${C.border}`,
  "border-radius": R.sm,
  padding: "3px 10px",
  "font-size": "12px",
  cursor: "pointer",
  "white-space": "nowrap",
  "max-width": "240px",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "font-weight": 500,
  transition: "background 0.08s",
} as const;

/** Visual divider before the Edit button, so the ⚙ reads as a separate
 *  configuration affordance instead of "just another command button". */
const editSepStyle = {
  "margin-left": "auto",
  width: "1px",
  height: "16px",
  background: C.border,
} as const;

const editBtnStyle = {
  background: "transparent",
  color: C.text3,
  border: `1px solid ${C.borderSub}`,
  "border-radius": R.sm,
  padding: "3px 9px",
  cursor: "pointer",
  "font-size": "12px",
} as const;

const confirmOverlayStyle = overlayStyle;

const confirmDialogStyle = {
  ...dialogStyle,
  "min-width": "360px",
  "max-width": "500px",
} as const;
