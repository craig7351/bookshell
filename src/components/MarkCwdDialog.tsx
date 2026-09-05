import { createSignal, onMount, Show, type JSX } from "solid-js";
import { captureCwdViaPty, setTabCwd, tabs as allTabs } from "../stores/tabs";
import { DialogFrame } from "./ui/DialogFrame";
import { Icon } from "../icons";
import { button, C, FONT, H, S, T } from "../theme";

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
    <DialogFrame
      title="Mark working directory"
      onClose={props.onClose}
      width="520px"
      overlay={{ "z-index": "150" }}
      footer={
        <>
          <Show when={tab()?.cwd}>
            <button class="bs-btn" onClick={clear} style={{ ...button("ghost", "roomy"), color: C.red }}>
              Clear
            </button>
          </Show>
          <button class="bs-btn" onClick={props.onClose} style={button("secondary", "roomy")}>Cancel</button>
          <button class="bs-btn" onClick={save} style={button("primary", "roomy")}>Save</button>
        </>
      }
    >
      <div style={{ ...T[12], color: C.text2, "margin-bottom": S[3] }}>
        BOOKSHELL will run <code style={{ "font-family": FONT.mono }}>cd '&lt;path&gt;'</code> on this
        tab right after the next reconnect.
      </div>
      <div style={{ display: "flex", gap: S[1.5], "align-items": "center" }}>
        <input
          class="bs-input"
          autofocus
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") props.onClose();
          }}
          placeholder="/home/jason/projects/foo"
          style={{ ...inputStyle, flex: 1 }}
          disabled={detecting()}
        />
        <button
          class="bs-btn"
          onClick={autoDetect}
          disabled={!canAutoDetect() || detecting()}
          title={canAutoDetect() ? "Run pwd on the remote and fill the path" : "Tab must be connected"}
          style={button("secondary", "roomy")}
        >
          <Icon name="search" size={12} stroke={2} class={detecting() ? "bs-spin" : undefined} />
          {detecting() ? "Detecting…" : "Auto-detect"}
        </button>
      </div>
      <Show when={detectError()}>
        <div style={{ ...T[11], color: C.yellow, "margin-top": S[1.5] }}>{detectError()}</div>
      </Show>
      <Show when={tab()?.cwd}>
        <div style={{ ...T[11], color: C.text3, "margin-top": S[2] }}>
          Currently saved: <code style={{ "font-family": FONT.mono, color: C.text2 }}>{tab()!.cwd}</code>
        </div>
      </Show>
    </DialogFrame>
  );
}

/** Geometry only — `.bs-input` owns surface, border and focus ring. */
const inputStyle: JSX.CSSProperties = {
  height: H.roomy,
  padding: `0 ${S[2]}`,
  ...T[13],
  "font-family": FONT.mono,
  width: "100%",
  "box-sizing": "border-box",
};
