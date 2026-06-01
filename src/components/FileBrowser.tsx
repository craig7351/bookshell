import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { api, type DirListing, type FsEntry } from "../ipc/api";
import { activeTab, captureCwd } from "../stores/tabs";
import {
  closeFiles,
  filesShowHidden,
  toggleFilesShowHidden,
} from "../stores/files";
import { C } from "../theme";

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?)$/i;

function iconFor(e: FsEntry): string {
  if (e.is_dir) return "📁";
  if (IMG_RE.test(e.name)) return "🖼️";
  return "📄";
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** File-browser side panel. Lists the active tab's session (local fs or SFTP),
 *  navigates folders, and opens files with the OS default app — for SSH tabs
 *  the file is downloaded first (handled transparently by fs_download_file).
 *
 *  Renders as a flex column that fills its container — caller decides whether
 *  it lives in the shared right-split column or in its own inline panel. */
export function FileBrowser() {
  const [listing, setListing] = createSignal<DirListing | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [openingPath, setOpeningPath] = createSignal<string | null>(null);
  /** What the path input currently shows. Falls out of sync with listing()
   *  while the user is typing — committed via Enter or blur. */
  const [pathDraft, setPathDraft] = createSignal("");

  async function navigate(path: string) {
    const t = activeTab();
    if (!t?.sessionId) {
      setError("No active session for this tab.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const l = await api.fsListDir(t.sessionId, path);
      setListing(l);
      setPathDraft(l.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onEntry(e: FsEntry) {
    if (e.is_dir) {
      navigate(e.path);
      return;
    }
    const t = activeTab();
    if (!t?.sessionId) return;
    setOpeningPath(e.path);
    setError(null);
    try {
      // Local tabs pass through; SSH tabs download to a temp file first.
      const local = await api.fsDownloadFile(t.sessionId, e.path);
      await api.fsOpenPath(local);
    } catch (err) {
      setError(String(err));
    } finally {
      setOpeningPath(null);
    }
  }

  onMount(async () => {
    const t = activeTab();
    if (!t?.sessionId) {
      setError("No active session for this tab.");
      return;
    }
    // Start at the tab's 📍 marked cwd, else probe the live shell cwd, else
    // let the backend fall back to the session's home dir.
    let start = t.cwd ?? null;
    if (!start) {
      try {
        start = await captureCwd(t.id);
      } catch {
        /* fall back to home */
      }
    }
    navigate(start ?? "");
  });

  /** Entries shown after hidden-file filter. Dotfiles are hidden by default
   *  so SSH home dirs aren't dominated by `.cache` / `.config` noise. */
  const visibleEntries = createMemo(() => {
    const l = listing();
    if (!l) return [];
    if (filesShowHidden()) return l.entries;
    return l.entries.filter((e) => !e.name.startsWith("."));
  });

  function commitPath() {
    const v = pathDraft().trim();
    const cur = listing()?.path ?? "";
    if (v && v !== cur) navigate(v);
    else setPathDraft(cur); // revert empties / no-op edits
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <button
          onClick={() => {
            const p = listing()?.parent;
            if (p != null) navigate(p);
          }}
          disabled={listing()?.parent == null}
          title="Up one level"
          style={navBtn(listing()?.parent == null)}
        >
          ↑
        </button>
        <button
          onClick={() => navigate(listing()?.path ?? "")}
          title="Refresh"
          style={navBtn(false)}
        >
          ⟳
        </button>
        <button
          onClick={toggleFilesShowHidden}
          title={filesShowHidden() ? "Hide dotfiles" : "Show dotfiles"}
          style={{
            ...navBtn(false),
            background: filesShowHidden() ? C.accentBg : "transparent",
            color: filesShowHidden() ? C.accent : C.text2,
            "border-color": filesShowHidden() ? C.accentBdr : C.border,
          }}
        >
          .{filesShowHidden() ? "✓" : ""}
        </button>
        <input
          value={pathDraft()}
          onInput={(e) => setPathDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPath();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setPathDraft(listing()?.path ?? "");
              e.currentTarget.blur();
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitPath}
          spellcheck={false}
          placeholder="path…"
          title="Type a path and press Enter to jump"
          style={pathInputStyle}
        />
        <button
          onClick={closeFiles}
          title="Close panel"
          style={navBtn(false)}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, "overflow-y": "auto", "min-height": 0 }}>
        <Show when={error()}>
          <div style={errStyle}>{error()}</div>
        </Show>
        <Show when={loading()}>
          <div style={{ padding: "16px", opacity: 0.6, "font-size": "13px" }}>Loading…</div>
        </Show>
        <Show when={!loading() && listing()}>
          <For
            each={visibleEntries()}
            fallback={
              <div style={{ padding: "16px", opacity: 0.5, "font-size": "13px" }}>
                {filesShowHidden() || listing()!.entries.length === 0
                  ? "Empty directory"
                  : "No visible entries (only dotfiles here — click the . button to show)"}
              </div>
            }
          >
            {(e) => (
              <div
                onClick={() => onEntry(e)}
                style={row}
                onMouseOver={(ev) => (ev.currentTarget.style.background = C.bgHover)}
                onMouseOut={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <span style={{ width: "20px", "text-align": "center", "flex-shrink": 0 }}>{iconFor(e)}</span>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    color: e.is_dir ? C.text : C.text2,
                  }}
                >
                  {e.name}
                </span>
                <Show when={openingPath() === e.path}>
                  <span style={{ "font-size": "11px", color: C.accent, "flex-shrink": 0 }}>opening…</span>
                </Show>
                <Show when={!e.is_dir && openingPath() !== e.path}>
                  <span style={{ "font-size": "11px", color: C.text3, "flex-shrink": 0 }}>{fmtSize(e.size)}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

const panelStyle = {
  flex: 1,
  display: "flex",
  "flex-direction": "column",
  background: C.bg2,
  "min-height": 0,
  overflow: "hidden",
} as const;

const headerStyle = {
  padding: "6px 8px",
  "border-bottom": `1px solid ${C.border}`,
  display: "flex",
  "align-items": "center",
  gap: "4px",
  "flex-shrink": 0,
} as const;

const pathInputStyle = {
  flex: 1,
  "min-width": 0,
  background: C.bg,
  color: C.text,
  border: `1px solid ${C.border}`,
  "border-radius": "5px",
  padding: "3px 8px",
  "font-family": "monospace",
  "font-size": "12px",
  outline: "none",
} as const;

const navBtn = (disabled: boolean) =>
  ({
    background: "transparent",
    color: disabled ? C.text3 : C.text2,
    border: `1px solid ${C.border}`,
    "border-radius": "5px",
    padding: "2px 8px",
    "font-size": "12px",
    cursor: disabled ? "default" : "pointer",
    "flex-shrink": 0,
  }) as const;

const errStyle = {
  padding: "12px 16px",
  color: C.red,
  "font-size": "12px",
  "white-space": "pre-wrap",
} as const;

const row = {
  display: "flex",
  "align-items": "center",
  gap: "10px",
  padding: "5px 12px",
  cursor: "pointer",
  "font-size": "13px",
  "user-select": "none",
} as const;
