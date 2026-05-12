import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { api, type Connection, type CommandButton, type TabState } from "../ipc/api";
import { C, overlayStyle as baseOverlay, inputStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";
import { CloseX } from "./CloseX";
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
  newButtonId,
  removeButton,
  saveButton,
} from "../stores/buttons";

interface Props {
  onClose: () => void;
}

interface Category {
  id: string;
  label: string;
  icon: string;
  render: () => JSX.Element;
}

export function SettingsDialog(props: Props) {
  const [active, setActive] = createSignal("general");
  const [logDir, setLogDir] = createSignal<string>("");

  api.loggerDirPath().then(setLogDir).catch(() => {});

  const categories: Category[] = [
    { id: "general", label: "General", icon: "⚙", render: () => <GeneralPane /> },
    { id: "connections", label: "Connections", icon: "🔌", render: () => <ConnectionsPane /> },
    { id: "buttons", label: "Command Buttons", icon: "🔘", render: () => <ButtonsPane /> },
    { id: "logging", label: "Logging", icon: "📝", render: () => <LoggingPane logDir={logDir()} /> },
    { id: "hotkeys", label: "Hotkeys", icon: "⌨", render: () => <HotkeysPane /> },
    { id: "backup", label: "Backup", icon: "💾", render: () => <BackupPane /> },
    { id: "about", label: "About", icon: "ℹ", render: () => <AboutPane /> },
  ];

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={sidebar}>
          <div style={{ "font-weight": 600, padding: "4px 8px 10px 10px", "font-size": "11px", color: C.text3, "letter-spacing": "0.06em" }}>
            SETTINGS
          </div>
          <For each={categories}>
            {(c) => (
              <div
                onClick={() => setActive(c.id)}
                style={{
                  ...sidebarItem,
                  background: active() === c.id ? C.bgActive : "transparent",
                  color: active() === c.id ? C.text : C.text2,
                }}
              >
                <span style={{ width: "20px" }}>{c.icon}</span>
                <span>{c.label}</span>
              </div>
            )}
          </For>
        </div>
        <div style={content}>
          <div style={{ display: "flex", "align-items": "center", "margin-bottom": "12px", "padding-right": "32px" }}>
            <strong style={{ "font-size": "16px" }}>
              {categories.find((c) => c.id === active())?.label}
            </strong>
          </div>
          {categories.find((c) => c.id === active())?.render()}
        </div>
        <CloseX onClose={props.onClose} />
      </div>
    </div>
  );
}

function GeneralPane() {
  return (
    <div style={{ display: "grid", "grid-template-columns": "160px 1fr", gap: "12px", "align-items": "center" }}>
      <label>Scrollback</label>
      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
        <input
          type="number"
          min="100"
          max="200000"
          step="1000"
          value={general().scrollback}
          onChange={(e) => {
            const v = Math.max(100, Math.min(200000, parseInt(e.currentTarget.value) || 10000));
            updateGeneral({ scrollback: v });
          }}
          style={{ ...input, width: "120px" }}
        />
        <span style={{ "font-size": "12px", opacity: 0.7 }}>lines per terminal (applies live)</span>
      </div>

      <label>Font size</label>
      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
        <input
          type="number"
          min="8"
          max="32"
          value={general().font_size}
          onChange={(e) => {
            const v = Math.max(8, Math.min(32, parseInt(e.currentTarget.value) || 14));
            updateGeneral({ font_size: v });
          }}
          style={{ ...input, width: "80px" }}
        />
        <span style={{ "font-size": "12px", opacity: 0.7 }}>px</span>
      </div>

      <label>Side terminal font</label>
      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
        <input
          type="number"
          min="8"
          max="32"
          value={general().side_font_size}
          onChange={(e) => {
            const v = Math.max(8, Math.min(32, parseInt(e.currentTarget.value) || 14));
            updateGeneral({ side_font_size: v });
          }}
          style={{ ...input, width: "80px" }}
        />
        <span style={{ "font-size": "12px", opacity: 0.7 }}>px（右側 side terminal）</span>
      </div>

      <label>Git auto-refresh</label>
      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
        <input
          type="number"
          min="1"
          max="300"
          value={general().git_poll_secs}
          onChange={(e) => {
            const v = Math.max(1, Math.min(300, parseInt(e.currentTarget.value) || 5));
            updateGeneral({ git_poll_secs: v });
          }}
          style={{ ...input, width: "80px" }}
        />
        <span style={{ "font-size": "12px", opacity: 0.7 }}>秒（SSH polling 間隔；local 使用 FS watch 無視此值）</span>
      </div>

      <div style={{ "grid-column": "1 / -1", "margin-top": "16px", opacity: 0.6, "font-size": "12px" }}>
        Theme picker, font family, configurable hotkeys and tab session restore will land here later.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hotkeys pane — read-only reference of all keyboard shortcuts
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
      { keys: ["Shift", "↑ / ↓"], desc: "Previous / next tab (capture phase)" },
      { keys: ["Ctrl", "PageUp / PageDown"], desc: "Previous / next tab (capture phase)" },
      { keys: ["Ctrl", "F"], desc: "Open / close terminal search" },
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

function Kbd(p: { label: string }) {
  return (
    <kbd style={{
      display: "inline-block",
      padding: "2px 7px",
      background: "rgba(255,255,255,0.07)",
      border: `1px solid rgba(255,255,255,0.18)`,
      "border-radius": "5px",
      "font-family": "monospace",
      "font-size": "11px",
      "line-height": "1.6",
      "white-space": "nowrap",
    }}>{p.label}</kbd>
  );
}

function HotkeysPane() {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <For each={HOTKEY_GROUPS}>
        {(group) => (
          <div>
            <div style={{
              "font-size": "11px",
              "font-weight": 600,
              color: C.text3,
              "letter-spacing": "0.06em",
              "text-transform": "uppercase",
              "margin-bottom": "8px",
            }}>
              {group.title}
            </div>
            <div style={{
              background: C.bg3,
              border: `1px solid ${C.borderSub}`,
              "border-radius": "8px",
              overflow: "hidden",
            }}>
              <For each={group.rows}>
                {(row, i) => (
                  <div style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "12px",
                    padding: "8px 14px",
                    "border-top": i() === 0 ? "none" : `1px solid ${C.borderSub}`,
                  }}>
                    <div style={{ display: "flex", gap: "4px", "align-items": "center", "min-width": "210px", "flex-shrink": 0 }}>
                      <For each={row.keys}>
                        {(k, ki) => (
                          <>
                            {ki() > 0 && <span style={{ opacity: 0.4, "font-size": "11px" }}>+</span>}
                            <Kbd label={k} />
                          </>
                        )}
                      </For>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ "font-size": "13px" }}>{row.desc}</span>
                      {row.note && (
                        <span style={{ "font-size": "11px", opacity: 0.5, "margin-left": "8px" }}>
                          ({row.note})
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function LoggingPane(p: { logDir: string }) {
  return (
    <div>
      <div style={{ "margin-bottom": "12px" }}>
        Logs are written automatically for every SSH session.
      </div>
      <div style={{ display: "grid", "grid-template-columns": "120px 1fr", gap: "8px", "align-items": "center" }}>
        <label style={{ opacity: 0.7 }}>Directory</label>
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <code style={{ background: C.bg, border: `1px solid ${C.borderSub}`, padding: "4px 8px", "border-radius": "6px", "font-size": "12px", flex: 1, "word-break": "break-all", color: C.text2 }}>
            {p.logDir || "(loading…)"}
          </code>
          <button onClick={() => api.loggerOpenDir().catch(console.error)} style={btnPrimary}>Open</button>
        </div>
      </div>
      <div style={{ "margin-top": "16px", opacity: 0.6, "font-size": "12px" }}>
        Future: strip-ANSI toggle, timestamp lines, log rotation, retention period (TODO 2-7 / Q-10 / Q-11).
      </div>
    </div>
  );
}

function AboutPane() {
  const [version] = createResource(getVersion);
  return (
    <div>
      <div style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "4px" }}>BOOKSHELL</div>
      <div style={{ opacity: 0.7, "margin-bottom": "16px" }}>v{version() ?? "…"} — Phase 1</div>
      <div style={{ "font-size": "13px", "line-height": 1.6, opacity: 0.8 }}>
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
    <div>
      <div style={{ "margin-bottom": "16px" }}>
        Export your tabs, saved connections and command buttons to a JSON file you can move
        to another machine or check into a dotfiles repo.
      </div>

      <div style={{ background: C.bg3, border: `1px solid ${C.borderSub}`, padding: "12px", "border-radius": "8px", "margin-bottom": "12px" }}>
        <div style={{ "font-weight": 600, "margin-bottom": "8px" }}>Export</div>
        <label style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "10px" }}>
          <input
            type="checkbox"
            checked={includePasswords()}
            onChange={(e) => setIncludePasswords(e.currentTarget.checked)}
          />
          <span style={{ "font-size": "12px", opacity: 0.85 }}>
            Include connection passwords (⚠ saved as plaintext in the JSON file)
          </span>
        </label>
        <button onClick={doExport} style={btnPrimary}>⬇ Download backup</button>
      </div>

      <div style={{ background: C.bg3, border: `1px solid ${C.borderSub}`, padding: "12px", "border-radius": "8px", "margin-bottom": "12px" }}>
        <div style={{ "font-weight": 600, "margin-bottom": "8px" }}>Import</div>
        <div style={{ "font-size": "12px", opacity: 0.7, "margin-bottom": "8px" }}>
          Merges by id: existing entries with the same id are overwritten, new ones added.
          Imported tabs appear after the next restart.
        </div>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) {
              doImport(f);
              e.currentTarget.value = "";
            }
          }}
          style={{ "font-size": "12px" }}
        />
      </div>

      <Show when={status()}>
        {(s) => (
          <div
            style={{
              padding: "10px 12px",
              "border-radius": "4px",
              background: s().kind === "ok" ? C.greenBg : C.redBg,
              border: `1px solid ${s().kind === "ok" ? C.green : C.red}`,
              color: s().kind === "ok" ? C.green : C.red,
              "font-size": "13px",
            }}
          >
            {s().msg}
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
    <div>
      <Show when={!editing()}>
        <div style={{ display: "flex", "margin-bottom": "8px" }}>
          <button onClick={startNew} style={{ ...btnPrimary, "margin-left": "auto" }}>+ New</button>
        </div>
        <Show
          when={connections().length > 0}
          fallback={<div style={{ opacity: 0.6, padding: "20px", "text-align": "center" }}>No saved connections.</div>}
        >
          <For each={connections()}>
            {(c) => (
              <div style={row}>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ "font-weight": 600 }}>{c.name}</div>
                  <div style={{ "font-size": "12px", opacity: 0.7 }}>
                    {c.user}@{c.host}:{c.port}
                  </div>
                </div>
                <button onClick={() => startEdit(c)} style={btnSecondary}>Edit</button>
                <button onClick={() => deleteConnection(c.id)} style={btnDanger}>×</button>
              </div>
            )}
          </For>
        </Show>
      </Show>

      <Show when={editing()}>
        {(c) => (
          <div style={{ display: "grid", "grid-template-columns": "100px 1fr", gap: "8px", "align-items": "center" }}>
            <label>Name</label>
            <input style={input} value={c().name} onInput={(e) => setEditing({ ...c(), name: e.currentTarget.value })} />
            <label>Host</label>
            <input style={input} value={c().host} onInput={(e) => setEditing({ ...c(), host: e.currentTarget.value })} />
            <label>Port</label>
            <input type="number" style={input} value={c().port} onInput={(e) => setEditing({ ...c(), port: parseInt(e.currentTarget.value) || 22 })} />
            <label>User</label>
            <input style={input} value={c().user} onInput={(e) => setEditing({ ...c(), user: e.currentTarget.value })} />
            <label>Password</label>
            <input type="password" style={input} placeholder="(leave empty to prompt each time)" value={c().password ?? ""} onInput={(e) => setEditing({ ...c(), password: e.currentTarget.value })} />
            <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
              <button onClick={() => setEditing(null)} style={btnSecondary}>Cancel</button>
              <button onClick={save} style={btnPrimary}>Save</button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Buttons pane — list / edit / delete
// ──────────────────────────────────────────────────────────────────────

function ButtonsPane() {
  const [editing, setEditing] = createSignal<CommandButton | null>(null);
  loadButtons();

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
    <div>
      <Show when={!editing()}>
        <div style={{ display: "flex", "margin-bottom": "8px" }}>
          <button onClick={startNew} style={{ ...btnPrimary, "margin-left": "auto" }}>+ New</button>
        </div>
        <Show
          when={buttons().length > 0}
          fallback={<div style={{ opacity: 0.6, padding: "20px", "text-align": "center" }}>No buttons.</div>}
        >
          <For each={buttons()}>
            {(b) => (
              <div style={row}>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ "font-weight": 600 }}>
                    {b.icon ? `${b.icon} ` : ""}
                    {b.label}
                  </div>
                  <div style={{ "font-size": "12px", opacity: 0.7, "font-family": "monospace" }}>
                    {b.command.length > 80 ? b.command.slice(0, 80) + "…" : b.command}
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
            <input style={input} placeholder="optional" value={c().icon ?? ""} onInput={(e) => setEditing({ ...c(), icon: e.currentTarget.value || null })} />
            <label>Command</label>
            <textarea
              style={{ ...input, "font-family": "monospace", "min-height": "60px", resize: "vertical" }}
              value={c().command}
              onInput={(e) => setEditing({ ...c(), command: e.currentTarget.value })}
            />
            <label>Send Enter</label>
            <label style={{ display: "flex", "align-items": "center", gap: "6px" }}>
              <input type="checkbox" checked={c().send_enter} onChange={(e) => setEditing({ ...c(), send_enter: e.currentTarget.checked })} />
              <span style={{ opacity: 0.7, "font-size": "12px" }}>Append \r so the shell executes it</span>
            </label>
            <label>Confirm</label>
            <label style={{ display: "flex", "align-items": "center", gap: "6px" }}>
              <input type="checkbox" checked={c().confirm} onChange={(e) => setEditing({ ...c(), confirm: e.currentTarget.checked })} />
              <span style={{ opacity: 0.7, "font-size": "12px" }}>Show confirm dialog</span>
            </label>
            <Show when={c().confirm}>
              <label>Confirm text</label>
              <input style={input} value={c().confirm_text ?? ""} onInput={(e) => setEditing({ ...c(), confirm_text: e.currentTarget.value || null })} />
            </Show>
            <label>Color (hex)</label>
            <input style={input} placeholder="#cba6f7" value={c().color ?? ""} onInput={(e) => setEditing({ ...c(), color: e.currentTarget.value || null })} />
            <div style={{ "grid-column": "1 / -1", display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "8px" }}>
              <button onClick={() => setEditing(null)} style={btnSecondary}>Cancel</button>
              <button onClick={save} style={btnPrimary}>Save</button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────

const overlay = baseOverlay;

const dialog = {
  position: "relative",
  background: "rgba(28,28,30,0.97)",
  "backdrop-filter": "blur(40px) saturate(180%)",
  color: C.text,
  border: `1px solid ${C.border}`,
  "border-radius": "14px",
  "box-shadow": "0 24px 64px rgba(0,0,0,0.75)",
  display: "flex",
  width: "800px",
  "max-width": "92vw",
  height: "570px",
  "max-height": "85vh",
  overflow: "hidden",
} as const;

const sidebar = {
  width: "180px",
  background: "rgba(0,0,0,0.15)",
  "border-right": `1px solid ${C.border}`,
  padding: "10px 6px",
  display: "flex",
  "flex-direction": "column",
  gap: "1px",
  "flex-shrink": "0",
} as const;

const sidebarItem = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  padding: "7px 10px",
  "border-radius": "7px",
  cursor: "pointer",
  "font-size": "13px",
  "user-select": "none",
  transition: "background 0.1s",
} as const;

const content = {
  flex: 1,
  padding: "18px 20px",
  overflow: "auto",
  "min-width": 0,
} as const;

const row = {
  display: "flex",
  gap: "8px",
  "align-items": "center",
  padding: "9px 12px",
  "border-radius": "8px",
  background: C.bg3,
  "margin-bottom": "5px",
} as const;

const input = inputStyle;
