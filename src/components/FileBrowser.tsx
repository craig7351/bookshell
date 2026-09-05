import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { api, type DirListing, type FsEntry } from "../ipc/api";
import { activeTab, captureCwd } from "../stores/tabs";
import {
  closeFiles,
  filesShowHidden,
  toggleFilesShowHidden,
} from "../stores/files";
import { C, FONT, R } from "../theme";

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
  const [hoverPath, setHoverPath] = createSignal<string | null>(null);
  /** Non-null while an upload/download is in flight — shows a status line and
   *  blocks a second concurrent transfer. */
  const [transfer, setTransfer] = createSignal<string | null>(null);
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

  /** Upload picked local paths into the current directory, then refresh. */
  async function doUpload(pickDir: boolean) {
    const t = activeTab();
    const dir = listing()?.path;
    if (!t?.sessionId || !dir || transfer()) return;
    // Hold the guard ACROSS the picker await. The native picker is not modal on
    // Windows, so without this the disabled/Show state wouldn't take effect and
    // a second transfer could start while the dialog is open.
    setTransfer(pickDir ? "Choosing folder…" : "Choosing files…");
    try {
      let sources: string[];
      if (pickDir) {
        const d = await api.fsPickDir();
        sources = d ? [d] : [];
      } else {
        sources = await api.fsPickFiles();
      }
      if (sources.length === 0) {
        setTransfer(null); // cancelled — release the guard
        return;
      }
      setError(null);
      setTransfer(`Uploading ${pickDir ? "folder" : `${sources.length} item(s)`}…`);
      const n = await api.fsUpload(t.sessionId, sources, dir);
      setTransfer(`Uploaded ${n} file${n === 1 ? "" : "s"}`);
      // Only refresh if the user is still viewing the directory we uploaded into
      // — don't yank them back if they navigated away during a long upload.
      if (listing()?.path === dir) await navigate(dir);
      setTimeout(() => setTransfer(null), 2500);
    } catch (e) {
      setError(String(e));
      setTransfer(null);
    }
  }

  /** Download a remote entry (file or dir) into a user-picked local folder. */
  async function doDownload(e: FsEntry, ev: MouseEvent) {
    ev.stopPropagation();
    const t = activeTab();
    if (!t?.sessionId || transfer()) return;
    setTransfer("Choosing destination…"); // hold the guard across the picker
    try {
      const dest = await api.fsPickDir();
      if (!dest) {
        setTransfer(null); // cancelled — release the guard
        return;
      }
      setError(null);
      setTransfer(`Downloading ${e.name}…`);
      const n = await api.fsDownload(t.sessionId, e.path, e.is_dir, dest);
      setTransfer(`Downloaded ${n} file${n === 1 ? "" : "s"} → ${dest}`);
      setTimeout(() => setTransfer(null), 3000);
    } catch (err) {
      setError(String(err));
      setTransfer(null);
    }
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
          onClick={() => doUpload(false)}
          disabled={!!transfer()}
          title="Upload file(s) to this directory"
          style={navBtn(!!transfer())}
        >
          ⬆📄
        </button>
        <button
          onClick={() => doUpload(true)}
          disabled={!!transfer()}
          title="Upload a folder to this directory"
          style={navBtn(!!transfer())}
        >
          ⬆📁
        </button>
        <button
          onClick={closeFiles}
          title="Close panel"
          style={navBtn(false)}
        >
          ×
        </button>
      </div>

      <Show when={transfer()}>
        <div style={transferStyle}>{transfer()}</div>
      </Show>

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
                onMouseEnter={(ev) => {
                  ev.currentTarget.style.background = C.bgHover;
                  setHoverPath(e.path);
                }}
                onMouseLeave={(ev) => {
                  ev.currentTarget.style.background = "transparent";
                  setHoverPath((p) => (p === e.path ? null : p));
                }}
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
                <Show when={hoverPath() === e.path && !transfer()}>
                  <button
                    onClick={(ev) => doDownload(e, ev)}
                    title={e.is_dir ? "Download folder…" : "Download file…"}
                    style={rowDownloadBtn}
                  >
                    ⬇
                  </button>
                </Show>
                <Show when={!e.is_dir && openingPath() !== e.path && hoverPath() !== e.path}>
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
  "border-radius": R.sm,
  padding: "3px 8px",
  "font-family": FONT.mono,
  "font-size": "12px",
  outline: "none",
} as const;

const navBtn = (disabled: boolean) =>
  ({
    background: "transparent",
    color: disabled ? C.text3 : C.text2,
    border: `1px solid ${C.border}`,
    "border-radius": R.sm,
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

const rowDownloadBtn = {
  background: "transparent",
  color: C.accent,
  border: "none",
  cursor: "pointer",
  "font-size": "13px",
  padding: "0 2px",
  "line-height": "1",
  "flex-shrink": 0,
} as const;

const transferStyle = {
  padding: "5px 12px",
  "font-size": "11px",
  color: C.accent,
  background: C.accentBg,
  "border-bottom": `1px solid ${C.border}`,
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "flex-shrink": 0,
} as const;
