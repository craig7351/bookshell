import { createSignal, onMount, Show } from "solid-js";
import { captureCwdViaPty, setTabCwd, tabs as allTabs } from "../stores/tabs";
import { CloseX } from "./CloseX";
import { C, FONT, overlayStyle as baseOverlay, dialogStyle as baseDialog, inputStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";

interface Props {
  tabId: string;
  onClose: () => void;
}

export function MarkCwdDialog(props: Props) {
  const tab = () => allTabs().find((t) => t.id === props.tabId);
  const [value, setValue] = createSignal(tab()?.cwd ?? "");
  const [detecting, setDetecting] = createSignal(false);
  const [detectError, setDetectError] = createSignal<string | null>(null);

  const canAutoDetect = () => tab()?.status === "connected";

  async function autoDetect() {
    if (!canAutoDetect()) {
      setDetectError("Tab is not connected.");
      return;
    }
    setDetecting(true);
    setDetectError(null);
    try {
      const path = await captureCwdViaPty(props.tabId);
      if (path) {
        setValue(path);
      } else {
        setDetectError("No response from the shell. Make sure it's idle at a prompt (no command running) and try again.");
      }
    } finally {
      setDetecting(false);
    }
  }

  // Auto-try once on open if the tab is connected and there's no saved cwd yet.
  onMount(() => {
    if (canAutoDetect() && !tab()?.cwd) {
      autoDetect();
    }
  });

  function save() {
    const v = value().trim();
    setTabCwd(props.tabId, v.length > 0 ? v : null);
    props.onClose();
  }

  function clear() {
    setTabCwd(props.tabId, null);
    setValue("");
    props.onClose();
  }

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <strong style={{ "font-size": "15px", "padding-right": "32px", display: "block" }}>📍 Mark working directory</strong>
        <div style={{ "font-size": "12px", opacity: 0.7, "margin": "8px 0 12px" }}>
          BOOKSHELL will run <code>cd '&lt;path&gt;'</code> on this tab right after the next reconnect.
        </div>
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <input
            autofocus
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") props.onClose();
            }}
            placeholder="/home/jason/projects/foo"
            style={{ ...input, flex: 1 }}
            disabled={detecting()}
          />
          <button
            onClick={autoDetect}
            disabled={!canAutoDetect() || detecting()}
            title={canAutoDetect() ? "Run pwd on the remote and fill the path" : "Tab must be connected"}
            style={{ ...btnSecondary, "white-space": "nowrap" }}
          >
            {detecting() ? "Detecting…" : "🔍 Auto-detect"}
          </button>
        </div>
        <Show when={detectError()}>
          <div style={{ "font-size": "12px", color: C.yellow, "margin-top": "6px" }}>{detectError()}</div>
        </Show>
        <Show when={tab()?.cwd}>
          <div style={{ "font-size": "12px", opacity: 0.6, "margin-top": "8px" }}>
            Currently saved: <code>{tab()!.cwd}</code>
          </div>
        </Show>
        <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "16px" }}>
          <Show when={tab()?.cwd}>
            <button onClick={clear} style={btnDanger}>Clear</button>
          </Show>
          <button onClick={save} style={btnPrimary}>Save</button>
        </div>
        <CloseX onClose={props.onClose} />
      </div>
    </div>
  );
}

const overlay = { ...baseOverlay, "z-index": "150" } as const;

const dialog = {
  ...baseDialog,
  "min-width": "440px",
  "max-width": "560px",
} as const;

const input = {
  ...inputStyle,
  width: "100%",
  "font-family": FONT.mono,
  "box-sizing": "border-box",
} as const;
