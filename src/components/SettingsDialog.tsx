import { createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { api, type Connection, type CommandButton, type TabState } from "../ipc/api";
import {
  button,
  C,
  FONT,
  H,
  R,
  RAW,
  S,
  T,
  TYPO,
  type TerminalPalette,
} from "../theme";
import { Icon, type IconName } from "../icons";
import { DialogFrame } from "./ui/DialogFrame";
import { SettingsGroup, SettingsRow } from "./ui/SettingsGroup";
import { EmptyState } from "./ui/EmptyState";
import { Notice } from "./ui/Notice";
import { general, updateGeneral } from "../stores/general";
import {
  activeTabId,
  flushPersistedState,
  tabs as allTabs,
} from "../stores/tabs";
import {
  connections,
  deleteConnection,
  loadConnections,
  newConnectionId,
  upsertConnection,
} from "../stores/connections";
import {
  buttons,
  loadButtons,
  moveButton,
  newButtonId,
  removeButton,
  saveButton,
} from "../stores/buttons";
import {
  ACTIONS,
  type Binding,
  bindingFromEvent,
  formatBinding,
  resetAction,
  resetAll,
  setBindings,
  shortcuts,
} from "../stores/shortcuts";

export type PaneId = "general" | "connections" | "buttons" | "hotkeys" | "backup" | "about";

interface Props {
  onClose: () => void;
  /** Pane to open on. Defaults to "general". The CommandBar pencil opens
   *  straight onto "buttons" — that route used to be its own dialog. */
  initialPane?: PaneId;
}

interface Category {
  id: PaneId;
  label: string;
  icon: IconName;
  render: () => JSX.Element;
}

// ──────────────────────────────────────────────────────────────────────
// Escape handling. The dialog owns one document listener; a pane that has
// a sub-state (an open edit form) pushes a handler that gets first refusal,
// so Esc backs out of the form before it closes the whole dialog. This is
// the behaviour the deleted ButtonEditor had and it must not be lost.
// ──────────────────────────────────────────────────────────────────────

const escStack: (() => boolean)[] = [];

function useEscape(fn: () => boolean) {
  escStack.push(fn);
  onCleanup(() => {
    const i = escStack.indexOf(fn);
    if (i >= 0) escStack.splice(i, 1);
  });
}

export function SettingsDialog(props: Props) {
  const [active, setActive] = createSignal<PaneId>(props.initialPane ?? "general");

  const categories: Category[] = [
    { id: "general", label: "General", icon: "sliders-horizontal", render: () => <GeneralPane /> },
    { id: "connections", label: "Connections", icon: "plug", render: () => <ConnectionsPane /> },
    { id: "buttons", label: "Command Buttons", icon: "terminal", render: () => <ButtonsPane /> },
    { id: "hotkeys", label: "Hotkeys", icon: "keyboard", render: () => <HotkeysPane /> },
    { id: "backup", label: "Backup", icon: "hard-drive", render: () => <BackupPane /> },
    { id: "about", label: "About", icon: "info", render: () => <AboutPane /> },
  ];

  const current = () => categories.find((c) => c.id === active());

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      for (let i = escStack.length - 1; i >= 0; i--) {
        if (escStack[i]()) return;
      }
      props.onClose();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <DialogFrame
      title={current()?.label ?? "Settings"}
      label="Settings"
      onClose={props.onClose}
      width="800px"
      height="570px"
      sidebar={
        <div style={sidebarStyle}>
          <div style={{ ...TYPO.section, padding: `${S[1]} ${S[2]} ${S[2]} ${S[2]}` }}>Settings</div>
          <For each={categories}>
            {(c) => (
              <button
                class="bs-row"
                onClick={() => setActive(c.id)}
                aria-current={active() === c.id ? "page" : undefined}
                style={sidebarItemStyle}
              >
                <Icon name={c.icon} size={16} />
                <span style={{ "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis" }}>
                  {c.label}
                </span>
              </button>
            )}
          </For>
        </div>
      }
    >
      {current()?.render()}
    </DialogFrame>
  );
}

// ──────────────────────────────────────────────────────────────────────
// General pane
// ──────────────────────────────────────────────────────────────────────

const PALETTES: { id: TerminalPalette; label: string }[] = [
  { id: "macos-dark", label: "macOS Dark" },
  { id: "legacy", label: "Legacy" },
];

function GeneralPane() {
  return (
    <div style={paneStackStyle}>
      <SettingsGroup label="Terminal">
        <SettingsRow label="Scrollback" hint="Lines kept per terminal. Applies live.">
          <input
            class="bs-input"
            type="number"
            min="100"
            max="200000"
            step="1000"
            value={general().scrollback}
            onChange={(e) => {
              const v = Math.max(100, Math.min(200000, parseInt(e.currentTarget.value) || 10000));
              updateGeneral({ scrollback: v });
            }}
            style={field("120px")}
          />
        </SettingsRow>

        <SettingsRow label="Font size" hint="Main terminal, in pixels.">
          <input
            class="bs-input"
            type="number"
            min="8"
            max="32"
            value={general().font_size}
            onChange={(e) => {
              const v = Math.max(8, Math.min(32, parseInt(e.currentTarget.value) || 14));
              updateGeneral({ font_size: v });
            }}
            style={field("80px")}
          />
        </SettingsRow>

        <SettingsRow label="Side terminal font" hint="The right-column terminal, in pixels.">
          <input
            class="bs-input"
            type="number"
            min="8"
            max="32"
            value={general().side_font_size}
            onChange={(e) => {
              const v = Math.max(8, Math.min(32, parseInt(e.currentTarget.value) || 14));
              updateGeneral({ side_font_size: v });
            }}
            style={field("80px")}
          />
        </SettingsRow>

        <SettingsRow
          label="Terminal palette"
          hint="ANSI colours. Legacy restores the pre-1.3 table."
        >
          <select
            class="bs-input"
            value={general().terminal_palette ?? "macos-dark"}
            onChange={(e) => updateGeneral({ terminal_palette: e.currentTarget.value })}
            style={field("160px")}
          >
            <For each={PALETTES}>{(p) => <option value={p.id}>{p.label}</option>}</For>
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Git">
        <SettingsRow
          label="Auto-refresh"
          hint="Seconds between SSH polls. Local repos use an FS watch and ignore this."
        >
          <input
            class="bs-input"
            type="number"
            min="1"
            max="300"
            value={general().git_poll_secs}
            onChange={(e) => {
              const v = Math.max(1, Math.min(300, parseInt(e.currentTarget.value) || 5));
              updateGeneral({ git_poll_secs: v });
            }}
            style={field("80px")}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hotkeys pane — editable tab-navigation bindings + read-only reference
// for the remaining (hardcoded) shortcuts.
// ──────────────────────────────────────────────────────────────────────

interface HotkeyGroup {
  title: string;
  rows: { keys: string[]; desc: string; note?: string }[];
}

const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    title: "Global — always active",
    rows: [
      { keys: ["Ctrl", "Shift", "P"], desc: "Toggle AI Passthrough mode", note: "only hotkey captured in Passthrough ON" },
    ],
  },
  {
    title: "Global — active when Passthrough OFF",
    rows: [
      { keys: ["Ctrl", "Shift", "T"], desc: "New tab (open Connection dialog)" },
      { keys: ["Ctrl", "Shift", "W"], desc: "Close active tab" },
      { keys: ["Ctrl", "Tab"], desc: "Next tab" },
      { keys: ["Ctrl", "Shift", "Tab"], desc: "Previous tab" },
      { keys: ["Ctrl", "1–9"], desc: "Jump to tab by index" },
      { keys: ["Ctrl", "F"], desc: "Open / close terminal search" },
      { keys: ["Ctrl", "Shift", "F"], desc: "Open / close terminal search" },
    ],
  },
  {
    title: "Terminal",
    rows: [
      { keys: ["Ctrl", "Shift", "C"], desc: "Copy selected text" },
      { keys: ["Ctrl", "Shift", "V"], desc: "Paste (image if available, otherwise text)" },
    ],
  },
  {
    title: "Dialogs & panels",
    rows: [
      { keys: ["Escape"], desc: "Close dialog / panel (or back out of sub-state)" },
    ],
  },
];

function BindingPill(p: { binding: Binding; onRemove: () => void }) {
  return (
    <span style={bindingPillStyle}>
      <span>{formatBinding(p.binding)}</span>
      <button
        class="bs-iconbtn"
        onClick={p.onRemove}
        title="Remove binding"
        aria-label="Remove binding"
        style={{
          width: "16px",
          height: "16px",
          padding: "0",
          border: "none",
          cursor: "pointer",
          "--btn-bg": "transparent",
          "--btn-fg": C.text3,
          "--btn-bg-hover": C.redBg,
          "--btn-fg-hover": C.red,
        }}
      >
        <Icon name="x" size={12} stroke={2} />
      </button>
    </span>
  );
}

function CapturePill(p: { onCommit: (b: Binding) => void; onCancel: () => void }) {
  let ref: HTMLDivElement | undefined;
  onMount(() => ref?.focus());
  return (
    <div
      ref={ref}
      tabIndex={0}
      onBlur={p.onCancel}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") { p.onCancel(); return; }
        const b = bindingFromEvent(e);
        if (b) p.onCommit(b);
      }}
      style={{
        display: "inline-flex",
        "align-items": "center",
        height: H.compact,
        padding: `0 ${S[2]}`,
        background: C.accentBg,
        border: `1px dashed ${C.accentBdr}`,
        "border-radius": R.sm,
        color: C.accent,
        ...T[11],
        outline: "none",
        cursor: "text",
      }}
    >
      Press keys… (Esc to cancel)
    </div>
  );
}

function ShortcutRow(p: { action: typeof ACTIONS[number] }) {
  const [capturing, setCapturing] = createSignal(false);
  const bindings = () => shortcuts()[p.action.id];

  function commit(b: Binding) {
    setBindings(p.action.id, [...bindings(), b]);
    setCapturing(false);
  }
  function removeAt(i: number) {
    const next = bindings().slice();
    next.splice(i, 1);
    setBindings(p.action.id, next);
  }

  return (
    <SettingsRow label={p.action.label} hint={p.action.desc} labelWidth="150px">
      <For each={bindings()}>
        {(b, i) => <BindingPill binding={b} onRemove={() => removeAt(i())} />}
      </For>
      <Show
        when={capturing()}
        fallback={
          <button class="bs-btn" onClick={() => setCapturing(true)} style={button("secondary", "compact")}>
            <Icon name="plus" size={12} stroke={2} />
            Add
          </button>
        }
      >
        <CapturePill onCommit={commit} onCancel={() => setCapturing(false)} />
      </Show>
      <button
        class="bs-btn"
        onClick={() => resetAction(p.action.id)}
        title="Reset to default"
        style={{ ...button("ghost", "compact"), "margin-left": "auto" }}
      >
        Reset
      </button>
    </SettingsRow>
  );
}

function HotkeysPane() {
  return (
    <div style={paneStackStyle}>
      <SettingsGroup
        label="Tab navigation (customizable)"
        actions={
          <button class="bs-btn" onClick={resetAll} style={button("secondary", "compact")}>
            Reset all
          </button>
        }
      >
        <SettingsRow stacked>
          <span style={{ ...T[11], color: C.text3 }}>
            Click <b style={{ "font-weight": 600 }}>Add</b> then press the key combination.
            Multiple bindings per action are allowed.
          </span>
        </SettingsRow>
        <For each={ACTIONS}>{(a) => <ShortcutRow action={a} />}</For>
      </SettingsGroup>

      <For each={HOTKEY_GROUPS}>
        {(group) => (
          <SettingsGroup label={group.title}>
            <For each={group.rows}>
              {(row) => (
                <SettingsRow>
                  <div style={{ display: "flex", gap: S[1], "align-items": "center", "min-width": "210px", "flex-shrink": 0 }}>
                    <For each={row.keys}>
                      {(k, ki) => (
                        <>
                          {ki() > 0 && <span style={{ color: C.text4, ...T[11] }}>+</span>}
                          <kbd>{k}</kbd>
                        </>
                      )}
                    </For>
                  </div>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <span style={{ ...T[13], color: C.text2 }}>{row.desc}</span>
                    {row.note && (
                      <span style={{ ...T[11], color: C.text3, "margin-left": S[2] }}>
                        ({row.note})
                      </span>
                    )}
                  </div>
                </SettingsRow>
              )}
            </For>
          </SettingsGroup>
        )}
      </For>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// About
// ──────────────────────────────────────────────────────────────────────

const RELEASES_API = "https://api.github.com/repos/craig7351/bookshell/releases/latest";
const RELEASES_PAGE = "https://github.com/craig7351/bookshell/releases/latest";

/** Compare two dotted version strings. Returns >0 if a>b, <0 if a<b, 0 equal.
 *  Non-numeric/short parts are treated as 0 so "1.1" vs "1.1.5" works. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".");
  const pb = b.replace(/^v/, "").split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const na = parseInt(pa[i] ?? "0", 10) || 0;
    const nb = parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "update"; tag: string }
  | { kind: "error"; message: string };

function AboutPane() {
  const [version] = createResource(getVersion);
  const [update, setUpdate] = createSignal<UpdateState>({ kind: "idle" });

  async function checkForUpdates() {
    if (update().kind === "checking") return;
    const current = version();
    if (!current) return;
    setUpdate({ kind: "checking" });
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const tag: string = (data.tag_name ?? "").toString();
      if (!tag) throw new Error("no release tag found");
      if (compareVersions(tag, current) > 0) {
        setUpdate({ kind: "update", tag });
      } else {
        setUpdate({ kind: "latest" });
      }
    } catch (e) {
      setUpdate({ kind: "error", message: String(e) });
    }
  }

  return (
    <div>
      <div style={{ ...T[20], "font-weight": 600, "letter-spacing": "0.08em", "margin-bottom": S[1] }}>
        BOOKSHELL
      </div>
      <div style={{ display: "flex", "align-items": "center", gap: S[3], "margin-bottom": S[4], "flex-wrap": "wrap" }}>
        <span style={{ ...T[12], color: C.text3, "font-variant-numeric": "tabular-nums" }}>
          v{version() ?? "…"}
        </span>
        <button
          class="bs-btn"
          onClick={checkForUpdates}
          disabled={update().kind === "checking" || !version()}
          style={button("secondary", "default")}
        >
          {update().kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
        <Show when={update().kind === "latest"}>
          <span style={{ ...T[12], color: C.green, display: "flex", "align-items": "center", gap: S[1] }}>
            <Icon name="check" size={12} stroke={2} />
            You're on the latest version
          </span>
        </Show>
        <Show when={update().kind === "update" ? update() : null} keyed>
          {(u) => (
            <span style={{ display: "flex", "align-items": "center", gap: S[2], ...T[12] }}>
              <span style={{ color: C.accent, "font-weight": 600 }}>
                New version {(u as { kind: "update"; tag: string }).tag} available
              </span>
              <button
                class="bs-btn"
                onClick={() => api.urlOpen(RELEASES_PAGE).catch(() => {})}
                style={button("primary", "default")}
              >
                Download
              </button>
            </span>
          )}
        </Show>
        <Show when={update().kind === "error" ? update() : null} keyed>
          {(u) => (
            <span style={{ ...T[12], color: C.red }}>
              Update check failed: {(u as { kind: "error"; message: string }).message}
            </span>
          )}
        </Show>
      </div>
      <div style={{ ...T[13], color: C.text2 }}>
        SSH terminal optimized for Claude Code and other AI agents.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Backup pane — export / import tabs + connections + buttons as JSON
// ──────────────────────────────────────────────────────────────────────

interface BackupFile {
  version: 1;
  app: "BOOKSHELL";
  exported_at: string;
  tabs: TabState[];
  active_tab_id: string | null;
  connections: Connection[];
  buttons: CommandButton[];
}

function BackupPane() {
  const [includePasswords, setIncludePasswords] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: "ok" | "err"; msg: string } | null>(null);
  // The native file input is a browser control we cannot style; it is hidden
  // and driven by a real button instead. No drop zone: nothing behind this
  // pane implements dropping, and a dashed rectangle that ignores a drop is
  // worse than no rectangle.
  let fileInput: HTMLInputElement | undefined;

  async function doExport() {
    setStatus(null);
    try {
      // Persist current tab state synchronously before snapshotting.
      flushPersistedState();
      const file: BackupFile = {
        version: 1,
        app: "BOOKSHELL",
        exported_at: new Date().toISOString(),
        tabs: allTabs().map((t) => ({
          id: t.id,
          name: t.name,
          connection_id: t.connectionId,
          color: t.color ?? null,
          icon: t.icon ?? null,
          passthrough: t.passthrough,
          cwd: t.cwd ?? null,
        })),
        active_tab_id: activeTabId(),
        connections: (await api.listConnections()).map((c) => ({
          ...c,
          password: includePasswords() ? c.password ?? null : null,
        })),
        buttons: await api.buttonsList(),
      };
      const json = JSON.stringify(file, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `bookshell-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({
        kind: "ok",
        msg: `Exported ${file.tabs.length} tabs, ${file.connections.length} connections, ${file.buttons.length} buttons`,
      });
    } catch (e: any) {
      setStatus({ kind: "err", msg: `Export failed: ${e}` });
    }
  }

  async function doImport(file: File) {
    setStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<BackupFile>;
      if (data.app !== "BOOKSHELL" || data.version !== 1) {
        throw new Error("Not a BOOKSHELL backup file (or unsupported version).");
      }
      let added = 0;

      // Connections first so tab.connection_id refs resolve on next reconnect.
      if (Array.isArray(data.connections)) {
        for (const c of data.connections) {
          await api.saveConnection(c);
          added++;
        }
      }
      let connCount = added;
      if (Array.isArray(data.buttons)) {
        for (const b of data.buttons) await api.buttonsSave(b);
      }

      // Tabs: merge into the persisted tabs.toml directly. We don't mutate
      // the live in-memory tab list — user must restart to pick up imported
      // tabs (avoids tearing down active SSH sessions).
      if (Array.isArray(data.tabs) && data.tabs.length > 0) {
        const current = await api.tabsLoadState();
        const existing = new Map((current.tabs ?? []).map((t) => [t.id, t]));
        for (const t of data.tabs) existing.set(t.id, t);
        await api.tabsSaveState({
          tabs: Array.from(existing.values()),
          active_tab_id: data.active_tab_id ?? current.active_tab_id ?? null,
        });
      }

      setStatus({
        kind: "ok",
        msg: `Imported ${data.connections?.length ?? 0} connections, ${data.buttons?.length ?? 0} buttons, ${data.tabs?.length ?? 0} tabs. Restart BOOKSHELL to see imported tabs.`,
      });
    } catch (e: any) {
      setStatus({ kind: "err", msg: `Import failed: ${e?.message ?? e}` });
    }
  }

  return (
    <div style={paneStackStyle}>
      <div style={{ ...T[12], color: C.text2 }}>
        Export your tabs, saved connections and command buttons to a JSON file you can move
        to another machine or check into a dotfiles repo.
      </div>

      <SettingsGroup label="Export">
        <SettingsRow stacked>
          <label style={{ display: "flex", "align-items": "center", gap: S[1.5], cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includePasswords()}
              onChange={(e) => setIncludePasswords(e.currentTarget.checked)}
            />
            <span style={{ ...T[12], color: C.text2 }}>
              Include connection passwords (saved as plaintext in the JSON file)
            </span>
          </label>
          <button class="bs-btn" onClick={doExport} style={button("primary", "roomy")}>
            <Icon name="download" size={14} />
            Download backup
          </button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Import">
        <SettingsRow stacked>
          <span style={{ ...T[12], color: C.text3 }}>
            Merges by id: existing entries with the same id are overwritten, new ones added.
            Imported tabs appear after the next restart.
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) {
                doImport(f);
                e.currentTarget.value = "";
              }
            }}
            style={{ display: "none" }}
          />
          <button
            class="bs-btn"
            onClick={() => fileInput?.click()}
            style={button("secondary", "roomy")}
          >
            <Icon name="upload" size={14} />
            Import backup…
          </button>
        </SettingsRow>
      </SettingsGroup>

      <Show when={status()}>
        {(s) => (
          <div style={noticeWrapStyle}>
            <Notice tone={s().kind === "ok" ? "success" : "error"}>{s().msg}</Notice>
          </div>
        )}
      </Show>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Connections pane — list / edit / delete (no connect launcher; that
// stays on the "+ Connect" button in the header).
// ──────────────────────────────────────────────────────────────────────

function ConnectionsPane() {
  const [editing, setEditing] = createSignal<Connection | null>(null);
  loadConnections();

  useEscape(() => {
    if (!editing()) return false;
    setEditing(null);
    return true;
  });

  function startEdit(c: Connection) {
    setEditing({ ...c });
  }
  function startNew() {
    setEditing({
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
  }
  async function save() {
    const c = editing();
    if (!c) return;
    if (!c.name.trim()) c.name = c.host;
    await upsertConnection(c);
    setEditing(null);
  }

  return (
    <div style={paneStackStyle}>
      <Show when={!editing()}>
        <div style={paneToolbarStyle}>
          <button class="bs-btn" onClick={startNew} style={button("primary", "default")}>
            <Icon name="plus" size={12} stroke={2} />
            New
          </button>
        </div>
        <Show
          when={connections().length > 0}
          fallback={
            <EmptyState
              icon="plug"
              title="No saved connections"
              description="Add one and it shows up in the connection picker."
            />
          }
        >
          <div style={listStyle}>
            <For each={connections()}>
              {(c) => (
                <div
                  class="bs-row"
                  role="button"
                  tabindex="0"
                  onClick={() => startEdit(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      startEdit(c);
                    }
                  }}
                  style={listRowStyle}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={rowTitleStyle}>{c.name}</div>
                    <div style={rowMetaStyle}>
                      {c.user}@{c.host}:{c.port}
                    </div>
                  </div>
                  <div class="bs-row-actions">
                    <RowIconButton
                      icon="pencil"
                      label="Edit connection"
                      onClick={() => startEdit(c)}
                    />
                    <RowIconButton
                      icon="x"
                      label="Delete connection"
                      tone="danger"
                      onClick={() => deleteConnection(c.id)}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={editing()}>
        {(c) => (
          <SettingsGroup label="Connection">
            <SettingsRow label="Name">
              <input class="bs-input" style={field()} value={c().name} onInput={(e) => setEditing({ ...c(), name: e.currentTarget.value })} />
            </SettingsRow>
            <SettingsRow label="Host">
              <input class="bs-input" style={field()} value={c().host} onInput={(e) => setEditing({ ...c(), host: e.currentTarget.value })} />
            </SettingsRow>
            <SettingsRow label="Port">
              <input class="bs-input" type="number" style={field("100px")} value={c().port} onInput={(e) => setEditing({ ...c(), port: parseInt(e.currentTarget.value) || 22 })} />
            </SettingsRow>
            <SettingsRow label="User">
              <input class="bs-input" style={field()} value={c().user} onInput={(e) => setEditing({ ...c(), user: e.currentTarget.value })} />
            </SettingsRow>
            <SettingsRow label="Password">
              <input class="bs-input" type="password" style={field()} placeholder="(leave empty to prompt each time)" value={c().password ?? ""} onInput={(e) => setEditing({ ...c(), password: e.currentTarget.value })} />
            </SettingsRow>
            <SettingsRow>
              <div style={formActionsStyle}>
                <button class="bs-btn" onClick={() => setEditing(null)} style={button("secondary", "roomy")}>Cancel</button>
                <button class="bs-btn" onClick={save} style={button("primary", "roomy")}>Save</button>
              </div>
            </SettingsRow>
          </SettingsGroup>
        )}
      </Show>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Buttons pane — list / reorder / edit / delete. This pane absorbed the
// old standalone ButtonEditor dialog, ordering arrows included.
// ──────────────────────────────────────────────────────────────────────

/** Seven swatches: the five Terminal highlight colours plus cyan and orange.
 *  Pure hex on purpose — the values reach <input type="color"> and are stored
 *  verbatim on the button, neither of which understands a var(). */
const SWATCHES: string[] = [...RAW.highlight, RAW.cyan, RAW.orange];

/** A 6x3 grid of glyphs that read at 12px on a dark pill. Emoji are user
 *  content here (the button's own icon), which is the one place §3.7 allows
 *  them. */
const EMOJI = [
  "🚀", "🔧", "🧹", "📦", "🔍", "🧪",
  "🐛", "⚡", "🔁", "📋", "🗂", "🌿",
  "🧠", "💾", "🖥", "⏱", "✅", "❌",
];

function ButtonsPane() {
  const [editing, setEditing] = createSignal<CommandButton | null>(null);
  let colorInput: HTMLInputElement | undefined;
  loadButtons();

  useEscape(() => {
    if (!editing()) return false;
    setEditing(null);
    return true;
  });

  function startEdit(b: CommandButton) {
    setEditing({ ...b });
  }
  function startNew() {
    setEditing({
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
  }
  async function save() {
    const b = editing();
    if (!b) return;
    if (!b.label.trim() || !b.command.trim()) return;
    await saveButton(b);
    setEditing(null);
  }

  return (
    <div style={paneStackStyle}>
      <Show when={!editing()}>
        <div style={paneToolbarStyle}>
          <button class="bs-btn" onClick={startNew} style={button("primary", "default")}>
            <Icon name="plus" size={12} stroke={2} />
            New
          </button>
        </div>
        <Show
          when={buttons().length > 0}
          fallback={
            <EmptyState
              icon="terminal"
              title="No command buttons"
              description="A button sends a command to the active terminal in one click."
            />
          }
        >
          <div style={listStyle}>
            <For each={buttons()}>
              {(b, i) => (
                <div
                  class="bs-row"
                  role="button"
                  tabindex="0"
                  onClick={() => startEdit(b)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      startEdit(b);
                    }
                  }}
                  style={listRowStyle}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={rowTitleStyle}>
                      {b.icon ? `${b.icon} ` : ""}
                      {b.label}
                    </div>
                    <div style={{ ...rowMetaStyle, "font-family": FONT.mono }}>
                      {b.command.length > 80 ? b.command.slice(0, 80) + "…" : b.command}
                      {b.send_enter && <span style={{ color: C.text4 }}> ⏎</span>}
                      {b.confirm && <span style={{ color: C.orange, "margin-left": S[1.5] }}>confirm</span>}
                    </div>
                  </div>
                  <div class="bs-row-actions">
                    <RowIconButton
                      icon="arrow-up"
                      label="Move up"
                      disabled={i() === 0}
                      onClick={() => moveButton(b.id, -1)}
                    />
                    <RowIconButton
                      icon="arrow-down"
                      label="Move down"
                      disabled={i() === buttons().length - 1}
                      onClick={() => moveButton(b.id, 1)}
                    />
                    <RowIconButton icon="pencil" label="Edit button" onClick={() => startEdit(b)} />
                    <RowIconButton
                      icon="x"
                      label="Delete button"
                      tone="danger"
                      onClick={() => removeButton(b.id)}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={editing()}>
        {(c) => (
          <>
            <SettingsGroup label="Preview">
              <SettingsRow stacked>
                <ButtonPreview button={c()} />
              </SettingsRow>
            </SettingsGroup>

            <SettingsGroup label="Button">
              <SettingsRow label="Label">
                <input class="bs-input" style={field()} value={c().label} onInput={(e) => setEditing({ ...c(), label: e.currentTarget.value })} />
              </SettingsRow>

              <SettingsRow label="Icon" hint="Optional. Shown before the label.">
                <div style={{ display: "flex", "flex-direction": "column", gap: S[1.5], "min-width": 0 }}>
                  <div style={emojiGridStyle}>
                    <For each={EMOJI}>
                      {(g) => (
                        <button
                          class="bs-btn"
                          aria-pressed={c().icon === g}
                          onClick={() => setEditing({ ...c(), icon: c().icon === g ? null : g })}
                          style={emojiCellStyle}
                          title={`Use ${g}`}
                        >
                          {g}
                        </button>
                      )}
                    </For>
                  </div>
                  <input
                    class="bs-input"
                    style={field("120px")}
                    placeholder="or paste one"
                    value={c().icon ?? ""}
                    onInput={(e) => setEditing({ ...c(), icon: e.currentTarget.value || null })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow label="Command" hint="Multi-line commands send each line.">
                <textarea
                  class="bs-input"
                  style={{ ...field(), "font-family": FONT.mono, height: "auto", "min-height": "64px", padding: `${S[1.5]} ${S[2]}`, resize: "vertical" }}
                  value={c().command}
                  onInput={(e) => setEditing({ ...c(), command: e.currentTarget.value })}
                />
              </SettingsRow>

              <SettingsRow label="Send Enter" hint="Append \r so the shell executes it.">
                <input
                  type="checkbox"
                  checked={c().send_enter}
                  onChange={(e) => setEditing({ ...c(), send_enter: e.currentTarget.checked })}
                />
              </SettingsRow>

              <SettingsRow label="Confirm" hint="Ask before sending.">
                <input
                  type="checkbox"
                  checked={c().confirm}
                  onChange={(e) => setEditing({ ...c(), confirm: e.currentTarget.checked })}
                />
              </SettingsRow>

              <Show when={c().confirm}>
                <SettingsRow label="Confirm text">
                  <input class="bs-input" style={field()} placeholder="Are you sure?" value={c().confirm_text ?? ""} onInput={(e) => setEditing({ ...c(), confirm_text: e.currentTarget.value || null })} />
                </SettingsRow>
              </Show>

              <SettingsRow label="Colour" hint="Tints the pill's border and label.">
                <div style={{ display: "flex", "align-items": "center", gap: S[1.5], "flex-wrap": "wrap" }}>
                  <Swatch
                    colour={null}
                    selected={!c().color}
                    onPick={() => setEditing({ ...c(), color: null })}
                  />
                  <For each={SWATCHES}>
                    {(hex) => (
                      <Swatch
                        colour={hex}
                        selected={(c().color ?? "").toLowerCase() === hex.toLowerCase()}
                        onPick={() => setEditing({ ...c(), color: hex })}
                      />
                    )}
                  </For>
                  {/* Off-palette pick. The native swatch popover is the OS's,
                      so the control itself is hidden and driven by a button. */}
                  <input
                    ref={colorInput}
                    type="color"
                    value={c().color ?? RAW.accent}
                    onInput={(e) => setEditing({ ...c(), color: e.currentTarget.value })}
                    style={hiddenColorStyle}
                    tabindex="-1"
                    aria-hidden="true"
                  />
                  <button
                    class="bs-btn"
                    onClick={() => colorInput?.click()}
                    style={button("ghost", "compact")}
                  >
                    Custom…
                  </button>
                </div>
              </SettingsRow>

              <SettingsRow>
                <div style={formActionsStyle}>
                  <button class="bs-btn" onClick={() => setEditing(null)} style={button("secondary", "roomy")}>Cancel</button>
                  <button class="bs-btn" onClick={save} style={button("primary", "roomy")}>Save</button>
                </div>
              </SettingsRow>
            </SettingsGroup>
          </>
        )}
      </Show>
    </div>
  );
}

/** The command pill exactly as CommandBar draws it, so the editor answers
 *  "what will this look like?" without a save-and-look round trip. */
function ButtonPreview(props: { button: CommandButton }) {
  const colour = () => props.button.color || null;
  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        height: H.default,
        padding: "0 10px",
        "border-radius": R.sm,
        border: `1px solid ${colour() ?? C.border}`,
        color: colour() ?? C.text2,
        ...T[12],
        "font-weight": 500,
        "white-space": "nowrap",
        "max-width": "240px",
        overflow: "hidden",
        "text-overflow": "ellipsis",
      }}
    >
      {props.button.icon ? `${props.button.icon} ` : ""}
      {props.button.label || "Label"}
    </span>
  );
}

function Swatch(props: { colour: string | null; selected: boolean; onPick: () => void }) {
  return (
    <button
      onClick={props.onPick}
      aria-label={props.colour ?? "No colour"}
      title={props.colour ?? "No colour"}
      style={{
        width: "20px",
        height: "20px",
        "border-radius": R.full,
        padding: "0",
        cursor: "pointer",
        "flex-shrink": 0,
        background: props.colour ?? "transparent",
        border: props.colour ? "1px solid transparent" : `1px dashed ${C.border}`,
        "box-shadow": props.selected ? `0 0 0 2px ${C.overlay}, 0 0 0 4px ${C.accent}` : "none",
      }}
    />
  );
}

/** A ghost icon button that only exists while its row is hovered or focused —
 *  the reveal itself is `.bs-row-actions` in base.css. */
function RowIconButton(props: {
  icon: IconName;
  label: string;
  tone?: "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="bs-iconbtn"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      style={{
        width: H.default,
        height: H.default,
        padding: "0",
        border: "1px solid transparent",
        cursor: "pointer",
        "--btn-bg": "transparent",
        "--btn-fg": C.text3,
        "--btn-bg-hover": props.tone === "danger" ? C.redBg : C.bgHover,
        "--btn-fg-hover": props.tone === "danger" ? C.red : C.text,
      }}
    >
      <Icon name={props.icon} size={14} stroke={props.icon === "x" ? 2 : 1.75} />
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────

const sidebarStyle: JSX.CSSProperties = {
  width: "180px",
  padding: `${S[3]} ${S[1.5]}`,
  display: "flex",
  "flex-direction": "column",
  gap: "2px",
  "min-height": 0,
  overflow: "auto",
};

/** Nav item. Background / foreground are slots — `.bs-row[aria-current]`
 *  paints the fill-selected state, exactly like an active TabBar row. */
const sidebarItemStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  height: H.roomy,
  padding: `0 ${S[2]}`,
  border: "none",
  "border-radius": R.sm,
  cursor: "pointer",
  ...T[13],
  "text-align": "left",
  "user-select": "none",
  "--btn-bg": "transparent",
  "--btn-fg": C.text2,
  "--btn-fg-hover": C.text,
};

/** Notice is a flush band; inside a pane stack it wants the card radius. */
const noticeWrapStyle: JSX.CSSProperties = {
  "border-radius": R.sm,
  overflow: "hidden",
};

const paneStackStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: S[5],
  "min-width": 0,
};

const paneToolbarStyle: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "flex-end",
};

const listStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: "2px",
  "min-width": 0,
};

const listRowStyle: JSX.CSSProperties = {
  display: "flex",
  gap: S[2],
  "align-items": "center",
  padding: `${S[1.5]} ${S[2]}`,
  "border-radius": R.sm,
  "min-width": 0,
  cursor: "pointer",
  "text-align": "left",
  border: "none",
  "--btn-bg": "transparent",
};

const rowTitleStyle: JSX.CSSProperties = {
  ...T[13],
  "font-weight": 500,
  color: C.text,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const rowMetaStyle: JSX.CSSProperties = {
  ...T[11],
  color: C.text3,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const bindingPillStyle: JSX.CSSProperties = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[1],
  height: H.compact,
  padding: `0 ${S[1]} 0 ${S[2]}`,
  background: C.bg3,
  border: `1px solid ${C.border}`,
  "border-radius": R.sm,
  "font-family": FONT.mono,
  ...T[11],
  color: C.text2,
};

const formActionsStyle: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "flex-end",
  gap: S[2],
  flex: 1,
};

const emojiGridStyle: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "repeat(6, 26px)",
  gap: S[1],
};

const emojiCellStyle: JSX.CSSProperties = {
  width: "26px",
  height: "26px",
  padding: "0",
  border: "1px solid transparent",
  cursor: "pointer",
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  ...T[13],
  "--btn-bg": "transparent",
};

/** Visually gone but still a real control: the OS colour popover anchors to
 *  it, so it cannot be display:none. */
const hiddenColorStyle: JSX.CSSProperties = {
  width: "1px",
  height: "1px",
  padding: "0",
  border: "none",
  opacity: 0,
  "pointer-events": "none",
  position: "absolute",
};

/** Form field geometry. Surface, border and focus ring belong to `.bs-input`,
 *  so nothing here sets background, colour or border. */
function field(width?: string): JSX.CSSProperties {
  return {
    height: H.roomy,
    padding: `0 ${S[2]}`,
    ...T[13],
    width: width ?? "100%",
    "max-width": "100%",
    "box-sizing": "border-box",
    "font-family": "inherit",
  };
}
