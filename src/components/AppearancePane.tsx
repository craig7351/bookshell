import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { api, type GeneralSettings } from "../ipc/api";
import { defaultTerminalAppearance, general, updateGeneral } from "../stores/general";
import { button, C, FONT, R, S, T } from "../theme";
import {
  terminalColor, terminalFontFamily, terminalFontName,
  terminalPalette, terminalPalettes, terminalTheme,
} from "../themes/terminal";
import { Notice } from "./ui/Notice";
import { settingsField, SettingsGroup, SettingsRow } from "./ui/SettingsGroup";

function appearanceOf(settings: GeneralSettings) {
  const palette = terminalPalette(settings.terminal_palette);
  return {
    font_size: settings.font_size,
    side_font_size: settings.side_font_size,
    terminal_font_family: terminalFontName(settings.terminal_font_family),
    terminal_palette: palette === "macos-dark" ? null : palette,
    terminal_foreground: terminalColor(settings.terminal_foreground),
    terminal_background: terminalColor(settings.terminal_background),
  };
}

type Appearance = ReturnType<typeof appearanceOf>;

function toDraft(appearance: Appearance) {
  return {
    ...appearance,
    font_size: String(appearance.font_size),
    side_font_size: String(appearance.side_font_size),
  };
}

function hasChanges(next: Appearance, current: Appearance): boolean {
  return (Object.keys(next) as (keyof Appearance)[]).some((key) => next[key] !== current[key]);
}

type SizeKey = "font_size" | "side_font_size";
const minSize = 8;
const maxSize = 32;

function previewFontSize(value: string, fallback: number) {
  const size = Number(value);
  return (Number.isInteger(size) && size >= minSize && size <= maxSize ? size : fallback) + "px";
}

export function AppearancePane() {
  const saved = createMemo(() => appearanceOf(general()));
  const [draft, setDraft] = createStore(toDraft(saved()));
  const [saving, setSaving] = createSignal(false);
  const [status, setStatus] = createSignal<"saved" | "error" | null>(null);
  const [systemFonts] = createResource(() => api.listTerminalFonts().catch((error) => {
    console.warn("listTerminalFonts", error);
    return null;
  }));
  const theme = createMemo(() => terminalTheme(draft));
  const palette = () => terminalPalette(draft.terminal_palette);
  const previouslySavedFont = createMemo(() => {
    const family = saved().terminal_font_family;
    return family && !systemFonts()?.includes(family) ? family : null;
  });

  const appearance = (): Appearance => ({
    font_size: Number(draft.font_size),
    side_font_size: Number(draft.side_font_size),
    terminal_font_family: terminalFontName(draft.terminal_font_family),
    terminal_palette: draft.terminal_palette,
    terminal_foreground: draft.terminal_foreground,
    terminal_background: draft.terminal_background,
  });
  const dirty = createMemo(() => hasChanges(appearance(), saved()));

  // Loading or finishing a save from another pane can update the stored values.
  createEffect(on(saved, (current, previous) => {
    if (previous && !hasChanges(appearance(), previous)) setDraft(toDraft(current));
  }));

  async function apply(event: SubmitEvent) {
    event.preventDefault();
    if (!dirty() || saving()) return;
    setSaving(true);
    const ok = await updateGeneral(appearance());
    setStatus(ok ? "saved" : "error");
    setSaving(false);
  }

  function changePalette(value: string) {
    const next = terminalPalette(value);
    if (next === "custom") {
      const colors = theme();
      setDraft({
        terminal_palette: next,
        terminal_foreground: draft.terminal_foreground ?? colors.foreground,
        terminal_background: draft.terminal_background ?? colors.background,
      });
    } else {
      setDraft("terminal_palette", next === "macos-dark" ? null : next);
    }
    setStatus(null);
  }

  function changeSize(field: SizeKey, value: string) {
    setDraft(field, value);
    setStatus(null);
  }

  return (
    <form onSubmit={apply} style={{ display: "flex", "flex-direction": "column", gap: S[4], "min-width": 0 }}>
      <SettingsGroup label="Text">
        <SettingsRow
          label={<label for="appearance-font">Terminal font</label>}
          hint={systemFonts.loading ? "Loading installed fonts…" : systemFonts() === null
            ? "System font list unavailable."
            : systemFonts()?.length === 0 ? "No installed fixed-width fonts found." : "Fixed-width fonts on this device."}
        >
          <select
            id="appearance-font"
            class="bs-input"
            disabled={saving()}
            onChange={(event) => {
              setDraft("terminal_font_family", event.currentTarget.value || null);
              setStatus(null);
            }}
            style={settingsField()}
          >
            <option value="" selected={draft.terminal_font_family === null}>Default font stack</option>
            <For each={systemFonts()}>
              {(font) => <option value={font} selected={draft.terminal_font_family === font}>{font}</option>}
            </For>
            <Show when={previouslySavedFont()}>
              {(font) => <option value={font()} selected={draft.terminal_font_family === font()}>{font()} (saved)</option>}
            </Show>
          </select>
        </SettingsRow>
        <SettingsRow label="Font size" hint="Pixels per terminal.">
          <SizeField label="Main terminal" field="font_size" value={draft.font_size} disabled={saving()} onInput={changeSize} />
          <SizeField label="Side terminal" field="side_font_size" value={draft.side_font_size} disabled={saving()} onInput={changeSize} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Colors">
        <SettingsRow label={<label for="appearance-palette">Color scheme</label>}>
          <select
            id="appearance-palette"
            class="bs-input"
            disabled={saving()}
            onChange={(event) => changePalette(event.currentTarget.value)}
            style={settingsField("200px")}
          >
            <For each={terminalPalettes}>
              {(item) => <option value={item.id} selected={palette() === item.id}>{item.label}</option>}
            </For>
          </select>
        </SettingsRow>
        <SettingsRow label="Terminal colors" hint="Select Custom to edit.">
          <ColorField label="Text color" value={theme().foreground} disabled={saving() || palette() !== "custom"} onInput={(color) => {
            setDraft("terminal_foreground", color);
            setStatus(null);
          }} />
          <ColorField label="Background color" value={theme().background} disabled={saving() || palette() !== "custom"} onInput={(color) => {
            setDraft("terminal_background", color);
            setStatus(null);
          }} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Preview">
        <div style={{
          background: theme().background,
          color: theme().foreground,
          "font-family": terminalFontFamily(draft.terminal_font_family),
          padding: `${S[2]} ${S[3]}`,
          "line-height": 1.2,
          "overflow-x": "auto",
          "white-space": "pre",
        }}>
          <div style={{ "font-size": previewFontSize(draft.font_size, saved().font_size) }}>Main │ $ git status 0123</div>
          <div style={{ "font-size": previewFontSize(draft.side_font_size, saved().side_font_size) }}>Side │ 終端機預覽 ── AaBb</div>
        </div>
      </SettingsGroup>

      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: S[2], "flex-wrap": "wrap" }}>
        <button
          type="button"
          class="bs-btn"
          style={button("secondary", "roomy")}
          disabled={saving()}
          onClick={() => {
            setDraft(toDraft(defaultTerminalAppearance));
            setStatus(null);
          }}
        >
          Restore defaults
        </button>
        <button type="submit" class="bs-btn" style={button("primary", "roomy")} disabled={saving() || !dirty()}>
          {saving() ? "Applying…" : "Apply"}
        </button>
      </div>
      <Show when={status() === "saved" && !dirty()}>
        <div role="status"><Notice tone="success">Appearance saved.</Notice></div>
      </Show>
      <Show when={status() === "error"}>
        <div role="alert"><Notice tone="error">Could not save appearance settings. Try applying again.</Notice></div>
      </Show>
    </form>
  );
}

const fieldLabelStyle = { ...T[11], color: C.text2, display: "flex", "flex-direction": "column", gap: S[1] } as const;

function SizeField(props: { label: string; field: SizeKey; value: string; disabled: boolean; onInput: (field: SizeKey, value: string) => void }) {
  return (
    <label style={{ ...fieldLabelStyle, "min-width": "96px" }}>
      {props.label}
      <input
        class="bs-input"
        type="number"
        min={minSize}
        max={maxSize}
        required
        disabled={props.disabled}
        value={props.value}
        onInput={(event) => props.onInput(props.field, event.currentTarget.value)}
        style={settingsField("84px")}
      />
    </label>
  );
}

function ColorField(props: { label: string; value: string; disabled: boolean; onInput: (value: string) => void }) {
  return (
    <label style={{ ...fieldLabelStyle, "min-width": "125px" }}>
      {props.label}
      <span style={{ display: "inline-flex", "align-items": "center", gap: S[2] }}>
        <input
          class="bs-input"
          type="color"
          value={props.value}
          disabled={props.disabled}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          style={{ ...settingsField("42px"), padding: `0 ${S[1]}`, "border-radius": R.sm }}
        />
        <span aria-hidden="true" style={{ "font-family": FONT.mono }}>{props.value.toUpperCase()}</span>
      </span>
    </label>
  );
}
