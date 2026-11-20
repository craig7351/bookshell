import { createSignal, For, Show, type JSX } from "solid-js";
import { importButtons } from "../stores/buttons";
import { button, C, FONT, S, T } from "../theme";
import { parseXshellQuickCommands } from "../xshellQuickCommands";
import { Icon } from "../icons";
import { Notice } from "./ui/Notice";
import { SettingsGroup, SettingsRow } from "./ui/SettingsGroup";

type Preview = ReturnType<typeof parseXshellQuickCommands> & { filename: string };

export function XshellImport() {
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [selected, setSelected] = createSignal(new Set<number>());
  const [busy, setBusy] = createSignal<"reading" | "saving" | null>(null);
  const [status, setStatus] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  let fileInput: HTMLInputElement | undefined;

  function toggle(index: number, checked: boolean) {
    setSelected((selection) => {
      const next = new Set(selection);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  async function read(file: File) {
    setPreview(null);
    setStatus(null);
    setBusy("reading");
    try {
      const result = parseXshellQuickCommands(await file.arrayBuffer());
      if (!result.buttons.length) throw new Error("No supported text commands were found in this file.");
      setSelected(new Set(result.buttons.filter((entry) => entry.visible).map((entry) => entry.index)));
      setPreview({ filename: file.name, ...result });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const current = preview();
    if (!current || busy() || !selected().size) return;
    const buttons = current.buttons
      .filter((entry) => selected().has(entry.index))
      .map(({ label, command, send_enter }) => ({ label, command, send_enter }));
    setStatus(null);
    setBusy("saving");
    try {
      const { added, duplicates } = await importButtons(buttons);
      setPreview(null);
      setStatus({
        kind: "success",
        text: `Imported ${added} ${added === 1 ? "button" : "buttons"}.`
          + (duplicates ? ` Skipped ${duplicates} ${duplicates === 1 ? "duplicate" : "duplicates"}.` : ""),
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Could not save commands. ${String(error)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup label="Xshell Quick Commands">
      <SettingsRow stacked hint="Add commands from a .qbl file to your command buttons.">
        <input
          ref={fileInput}
          type="file"
          accept=".qbl"
          aria-label="Xshell Quick Commands file"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file && !busy()) void read(file);
          }}
        />
        <button type="button" class="bs-btn" onClick={() => fileInput?.click()} disabled={!!busy()} style={button("secondary", "roomy")}>
          <Icon name="upload" size={14} />
          {busy() === "reading" ? "Reading…" : "Import Xshell Quick Commands…"}
        </button>
      </SettingsRow>

      <Show when={preview()}>
        {(draft) => (
          <SettingsRow stacked>
            <div style={toolbarStyle}>
              <div style={{ "min-width": 0, "overflow-wrap": "anywhere" }}>
                <div style={{ ...T[13], color: C.text }}>{draft().filename}</div>
                <div style={metaStyle} role="status">{selected().size} of {draft().buttons.length} selected</div>
              </div>
              <button
                type="button"
                class="bs-btn"
                disabled={!!busy()}
                style={button("ghost", "default")}
                onClick={() => setSelected(new Set(selected().size === draft().buttons.length ? [] : draft().buttons.map((entry) => entry.index)))}
              >
                {selected().size === draft().buttons.length ? "Clear selection" : "Select all"}
              </button>
            </div>
            <ul aria-label="Quick Command preview" style={listStyle}>
              <For each={draft().buttons}>
                {(entry) => (
                  <li>
                    <label style={rowStyle}>
                      <input type="checkbox" checked={selected().has(entry.index)} disabled={!!busy()} onChange={(event) => toggle(entry.index, event.currentTarget.checked)} />
                      <span style={{ flex: 1, "min-width": 0, "overflow-wrap": "anywhere" }}>
                        <span style={{ ...T[13], "font-weight": 500, color: C.text }}>{entry.label}</span>
                        <span style={{ ...metaStyle, "margin-left": S[2] }}>
                          {entry.send_enter ? "Send Enter" : "Text only"}{entry.visible ? "" : " · Hidden in Xshell"}
                        </span>
                        <code style={{ ...T[12], "font-family": FONT.mono, color: C.text2, display: "block", "white-space": "pre-wrap" }}>{entry.command}</code>
                      </span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
            <Show when={draft().skipped > 0}>
              <Notice tone="warn">Skipped {draft().skipped} unsupported or incomplete entries.</Notice>
            </Show>
            <div style={{ display: "flex", "justify-content": "flex-end", gap: S[2], "margin-top": S[2], "flex-wrap": "wrap" }}>
              <button type="button" class="bs-btn" disabled={!!busy()} style={button("secondary", "roomy")} onClick={() => { setPreview(null); setStatus(null); }}>Cancel</button>
              <button type="button" class="bs-btn" disabled={!!busy() || !selected().size} style={button("primary", "roomy")} onClick={save}>
                {busy() === "saving" ? "Importing…" : "Import selected"}
              </button>
            </div>
          </SettingsRow>
        )}
      </Show>

      <Show when={status()}>
        {(message) => (
          <div role={message().kind === "error" ? "alert" : "status"}>
            <Notice tone={message().kind}>{message().text}</Notice>
          </div>
        )}
      </Show>
    </SettingsGroup>
  );
}

const metaStyle = { ...T[11], color: C.text3 } as const;

const toolbarStyle: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "space-between",
  "align-items": "center",
  gap: S[2],
};

const listStyle: JSX.CSSProperties = {
  "list-style": "none",
  padding: "0",
  margin: "0",
  "max-height": "240px",
  overflow: "auto",
};

const rowStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "flex-start",
  gap: S[2],
  cursor: "pointer",
  padding: `${S[1.5]} ${S[1]}`,
  "border-top": `1px solid ${C.borderSub}`,
};
