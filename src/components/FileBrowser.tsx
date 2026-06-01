import { createSignal, For, onMount, Show } from "solid-js";
import { api, type DirListing, type FsEntry } from "../ipc/api";
import { activeTab, captureCwd } from "../stores/tabs";
import { closeFiles } from "../stores/files";
import { CloseX } from "./CloseX";
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

/** File-browser modal. Lists the active tab's session (local fs or SFTP),
 *  navigates folders, and opens files with the OS default app — for SSH tabs
 *  the file is downloaded first (handled transparently by fs_download_file). */
export function FileBrowser() {
  const [listing, setListing] = createSignal<DirListing | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [openingPath, setOpeningPath] = createSignal<string | null>(null);

  async function navigate(path: string) {
    const t = activeTab();
    if (!t?.sessionId) {
      setError("No active session for this tab.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setListing(await api.fsListDir(t.sessionId, path));
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

  return (
    <div onClick={closeFiles} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={dialog}>
        <div style={header}>
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
          <span style={pathLabel}>{listing()?.path ?? "…"}</span>
        </div>

        <div style={{ flex: 1, "overflow-y": "auto", "min-height": 0 }}>
          <Show when={error()}>
            <div style={{ padding: "12px 16px", color: C.red, "font-size": "12px", "white-space": "pre-wrap" }}>
              {error()}
            </div>
          </Show>
          <Show when={loading()}>
            <div style={{ padding: "16px", opacity: 0.6, "font-size": "13px" }}>Loading…</div>
          </Show>
          <Show when={!loading() && listing()}>
            <For
              each={listing()!.entries}
              fallback={<div style={{ padding: "16px", opacity: 0.5, "font-size": "13px" }}>Empty directory</div>}
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

        <CloseX onClose={closeFiles} />
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: "0",
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "z-index": "200",
} as const;

const dialog = {
  background: "rgba(28,28,30,0.98)",
  "backdrop-filter": "blur(40px) saturate(180%)",
  color: C.text,
  border: `1px solid ${C.border}`,
  "border-radius": "14px",
  "box-shadow": "0 24px 64px rgba(0,0,0,0.8)",
  width: "min(720px, 92vw)",
  height: "min(640px, 88vh)",
  display: "flex",
  "flex-direction": "column",
  overflow: "hidden",
  position: "relative",
} as const;

const header = {
  padding: "10px 44px 10px 12px",
  "border-bottom": `1px solid ${C.border}`,
  display: "flex",
  "align-items": "center",
  gap: "6px",
  "flex-shrink": 0,
} as const;

const pathLabel = {
  "font-family": "monospace",
  "font-size": "12px",
  color: C.text2,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  flex: 1,
  "padding-left": "4px",
} as const;

const row = {
  display: "flex",
  "align-items": "center",
  gap: "10px",
  padding: "6px 16px",
  cursor: "pointer",
  "font-size": "13px",
  "user-select": "none",
} as const;

const navBtn = (disabled: boolean) =>
  ({
    background: "transparent",
    color: disabled ? C.text3 : C.text2,
    border: `1px solid ${C.border}`,
    "border-radius": "6px",
    padding: "2px 9px",
    "font-size": "13px",
    cursor: disabled ? "default" : "pointer",
    "flex-shrink": 0,
  }) as const;
