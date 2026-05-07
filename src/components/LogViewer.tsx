import { createSignal, For, onCleanup, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { api, type LogEntry } from "../ipc/api";
import { C, xtermTheme } from "../theme";

interface Props {
  onClose: () => void;
}

/** Convert raw PTY bytes (with full ANSI control sequences) into the plain
 *  text that a real terminal would render. Done by feeding bytes through an
 *  off-DOM xterm.js instance and walking its buffer once parsing settles.
 *
 *  cols/rows + scrollback are sized large so reflow doesn't truncate long
 *  conversations from Claude CLI etc. */
async function renderLogToText(bytes: Uint8Array): Promise<string> {
  // Hidden host: xterm.write requires the renderer to be initialized, which
  // requires open() on a real DOM element. We park it offscreen and dispose
  // immediately after dumping the buffer.
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "-99999px";
  host.style.width = "1600px";
  host.style.height = "400px";
  host.style.visibility = "hidden";
  document.body.appendChild(host);

  const term = new Terminal({
    cols: 200,
    rows: 50,
    scrollback: 100000,
    allowProposedApi: true,
    theme: xtermTheme,
  });
  term.open(host);

  try {
    // write() is async-batched. Wait for the callback so the buffer reflects
    // every byte before we walk it.
    await new Promise<void>((resolve) => term.write(bytes, () => resolve()));

    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const out: string[] = [];
    let blankRun = 0;
    for (const l of lines) {
      if (l === "") {
        blankRun++;
        if (blankRun <= 2) out.push(l);
      } else {
        blankRun = 0;
        out.push(l);
      }
    }
    return out.join("\n");
  } finally {
    term.dispose();
    host.remove();
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

export function LogViewer(props: Props) {
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [content, setContent] = createSignal<string>("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showRaw, setShowRaw] = createSignal(false);
  const [rawCache, setRawCache] = createSignal<Uint8Array | null>(null);

  void (async () => {
    try {
      setEntries(await api.logsList());
    } catch (e: any) {
      setError(`list logs: ${e}`);
    }
  })();

  async function selectLog(name: string) {
    setSelected(name);
    setLoading(true);
    setError(null);
    setContent("");
    setRawCache(null);
    try {
      const bytes = await api.logsRead(name);
      setRawCache(bytes);
      if (showRaw()) {
        setContent(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      } else {
        setContent(await renderLogToText(bytes));
      }
    } catch (e: any) {
      setError(`read ${name}: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggleRaw() {
    const next = !showRaw();
    setShowRaw(next);
    const bytes = rawCache();
    if (!bytes) return;
    setLoading(true);
    try {
      if (next) {
        setContent(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      } else {
        setContent(await renderLogToText(bytes));
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content());
    } catch (e) {
      console.warn("clipboard write", e);
    }
  }

  async function saveAs() {
    const name = selected();
    if (!name) return;
    const suggested = name.replace(/\.log$/, showRaw() ? ".raw.log" : ".txt");
    try {
      await api.transcriptSaveDialog(suggested, content());
    } catch (e) {
      console.warn("save", e);
    }
  }

  // Esc closes
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={headerRow}>
          <div style={{ "font-size": "14px", "font-weight": 600 }}>📜 Log Viewer</div>
          <div style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
            <button
              onClick={() => api.loggerOpenDir().catch(console.error)}
              style={btn}
              title="Open logs folder in OS file manager"
            >
              📂 Open folder
            </button>
            <button onClick={props.onClose} style={btn}>×</button>
          </div>
        </div>

        <div style={bodyRow}>
          {/* Left: file list */}
          <div style={listPane}>
            <Show
              when={entries().length > 0}
              fallback={
                <div style={{ padding: "20px", opacity: 0.6, "font-size": "12px", "text-align": "center" }}>
                  No log files yet.
                </div>
              }
            >
              <For each={entries()}>
                {(e) => (
                  <div
                    onClick={() => selectLog(e.name)}
                    style={{
                      ...listItem,
                      background: selected() === e.name ? C.accentBg : "transparent",
                      color: selected() === e.name ? C.accent : C.text,
                    }}
                    title={e.name}
                  >
                    <div style={{ "font-size": "12px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                      {e.name}
                    </div>
                    <div style={{ "font-size": "10px", opacity: 0.6, display: "flex", "justify-content": "space-between" }}>
                      <span>{fmtDate(e.modified_unix_ms)}</span>
                      <span>{fmtSize(e.size)}</span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>

          {/* Right: viewer */}
          <div style={viewerPane}>
            <div style={viewerToolbar}>
              <Show when={selected()} fallback={<span style={{ opacity: 0.5, "font-size": "12px" }}>Select a log on the left</span>}>
                <span style={{ "font-size": "12px", color: C.text2 }}>{selected()}</span>
                <div style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
                  <label style={{ display: "flex", "align-items": "center", gap: "4px", "font-size": "11px", color: C.text2, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showRaw()}
                      onChange={toggleRaw}
                      disabled={loading() || !rawCache()}
                    />
                    Raw (ANSI)
                  </label>
                  <button onClick={copyContent} style={btn} disabled={!content()}>Copy</button>
                  <button onClick={saveAs} style={btn} disabled={!content()}>Save As…</button>
                </div>
              </Show>
            </div>

            <Show when={error()}>
              <div style={{ padding: "10px 14px", color: C.red, "font-size": "12px" }}>{error()}</div>
            </Show>
            <Show when={loading()}>
              <div style={{ padding: "10px 14px", opacity: 0.6, "font-size": "12px" }}>Loading…</div>
            </Show>
            <pre style={pre}>{content()}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: "0",
  background: "rgba(0,0,0,0.55)",
  "backdrop-filter": "blur(8px)",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "z-index": "100",
} as const;

const card = {
  background: "rgba(28,28,30,0.97)",
  "backdrop-filter": "blur(40px) saturate(180%)",
  border: `1px solid ${C.border}`,
  "border-radius": "14px",
  "box-shadow": "0 24px 64px rgba(0,0,0,0.7)",
  width: "min(1200px, 92vw)",
  height: "min(800px, 88vh)",
  display: "flex",
  "flex-direction": "column",
  color: C.text,
  overflow: "hidden",
} as const;

const headerRow = {
  display: "flex",
  "align-items": "center",
  gap: "10px",
  padding: "12px 16px",
  "border-bottom": `1px solid ${C.border}`,
} as const;

const bodyRow = {
  display: "flex",
  flex: 1,
  "min-height": 0,
} as const;

const listPane = {
  width: "300px",
  "border-right": `1px solid ${C.border}`,
  overflow: "auto",
  display: "flex",
  "flex-direction": "column",
  padding: "4px",
  "flex-shrink": 0,
} as const;

const listItem = {
  padding: "6px 8px",
  "border-radius": "6px",
  cursor: "pointer",
  "margin-bottom": "1px",
  display: "flex",
  "flex-direction": "column",
  gap: "2px",
} as const;

const viewerPane = {
  flex: 1,
  display: "flex",
  "flex-direction": "column",
  "min-width": 0,
  "min-height": 0,
} as const;

const viewerToolbar = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  padding: "8px 14px",
  "border-bottom": `1px solid ${C.border}`,
  "min-height": "30px",
} as const;

const pre = {
  flex: 1,
  margin: "0",
  padding: "12px 16px",
  overflow: "auto",
  "white-space": "pre",
  "font-family": '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  "font-size": "12px",
  color: C.text,
  background: C.bg,
} as const;

const btn = {
  background: "transparent",
  color: C.text2,
  border: `1px solid ${C.border}`,
  "border-radius": "6px",
  padding: "3px 9px",
  "font-size": "12px",
  cursor: "pointer",
} as const;
