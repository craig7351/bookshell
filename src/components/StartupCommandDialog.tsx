import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { saveTabStartupCommand, type Tab } from "../stores/tabs";
import { button, C, FONT, H, S, T } from "../theme";
import { DialogFrame } from "./ui/DialogFrame";
import { Notice } from "./ui/Notice";

export function StartupCommandDialog(props: { tab: Tab; onClose: () => void }) {
  const [value, setValue] = createSignal(props.tab.startupCommand ?? "");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let input!: HTMLInputElement;

  function close() {
    if (!saving()) props.onClose();
  }

  onMount(() => {
    input.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", escape);
    onCleanup(() => document.removeEventListener("keydown", escape));
  });

  async function save() {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      await saveTabStartupCommand(props.tab.id, value());
      props.onClose();
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      title="Startup command"
      onClose={close}
      width="520px"
      overlay={{ "z-index": "150" }}
      footer={
        <>
          <button class="bs-btn" disabled={saving()} onClick={close} style={button("secondary", "roomy")}>Cancel</button>
          <button class="bs-btn" disabled={saving()} onClick={save} style={button("primary", "roomy")}>Save</button>
        </>
      }
    >
      <label for="tab-startup-command" style={{ display: "block", ...T[13], "font-weight": 500 }}>
        {props.tab.name}
      </label>
      <p id="tab-startup-help" style={{ ...T[12], color: C.text2, margin: `${S[1]} 0 ${S[3]}` }}>
        Starting with the next launch, BOOKSHELL sends this command once per launch, 3 seconds
        after this tab connects. Leave it blank to disable it.
      </p>
      <input
        id="tab-startup-command"
        ref={input}
        class="bs-input"
        aria-label="Startup command"
        aria-describedby="tab-startup-help"
        value={value()}
        placeholder="telnet hostname"
        spellcheck={false}
        autocomplete="off"
        disabled={saving()}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          void save();
        }}
        style={{
          ...T[13],
          "font-family": FONT.mono,
          width: "100%",
          height: H.roomy,
          padding: `0 ${S[2]}`,
          "box-sizing": "border-box",
        }}
      />
      <Show when={error()}>
        {(message) => (
          <div role="alert" style={{ "margin-top": S[2] }}>
            <Notice tone="error">{message()}</Notice>
          </div>
        )}
      </Show>
    </DialogFrame>
  );
}
