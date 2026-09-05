import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, type DirListing, type FsEntry } from "../ipc/api";
import { activeTab, captureCwd } from "../stores/tabs";
import {
  closeFiles,
  filesShowHidden,
  toggleFilesShowHidden,
} from "../stores/files";
import { layoutMode } from "../stores/layout";
import { button, C, FONT, H, R, S, T } from "../theme";
import { Icon, type IconName } from "../icons";
import { PanelHeader, panelCard } from "./ui/PanelHeader";
import { EmptyState, Skeleton } from "./ui/EmptyState";
import { Notice } from "./ui/Notice";

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?)$/i;
const CODE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|ini|conf|rs|py|go|java|c|h|cc|cpp|hpp|cs|rb|php|sh|bash|zsh|fish|ps1|bat|sql|css|scss|less|html?|xml|vue|svelte|swift|kt|lua|pl|r|dart|zig)$/i;

/** File type -> glyph + semantic colour. Four buckets only: a directory reads
 *  cyan, source code accent, images purple, everything else recedes. */
function iconFor(e: FsEntry): { name: IconName; color: string } {
  if (e.is_dir) return { name: "folder", color: C.cyan };
  if (IMG_RE.test(e.name)) return { name: "image", color: C.purple };
  if (CODE_RE.test(e.name)) return { name: "file-code", color: C.accent };
  return { name: "file", color: C.text4 };
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface Crumb {
  label: string;
  path: string;
}

/** Split a path into clickable ancestors. Handles both separators because the
 *  same panel lists a local Windows fs and a remote POSIX one. */
function crumbsFor(path: string): Crumb[] {
  if (!path) return [];
  const win = /^[A-Za-z]:[\\/]/.test(path) || (path.includes("\\") && !path.startsWith("/"));
  const sep = win ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const out: Crumb[] = [];
  if (!win) out.push({ label: "/", path: "/" });
  let acc = "";
  for (const part of parts) {
    if (acc === "") acc = win ? part + sep : sep + part;
    else acc = acc + (acc.endsWith(sep) ? "" : sep) + part;
    out.push({ label: part, path: acc });
  }
  return out;
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
  /** The path slot is a breadcrumb at rest and a text field while editing —
   *  same box, same height, so switching never moves the toolbar. */
  const [editingPath, setEditingPath] = createSignal(false);

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
    // Start at the tab's marked cwd, else probe the live shell cwd, else
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

  /** A listing that answers in 40ms should not flash a skeleton, so the
   *  placeholder waits 150ms before it appears. Anything slower than that is
   *  slow enough that the user wants to see the shape of the answer. */
  const [showSkeleton, setShowSkeleton] = createSignal(false);
  createEffect(() => {
    if (!loading()) {
      setShowSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowSkeleton(true), 150);
    onCleanup(() => clearTimeout(t));
  });

  const crumbs = createMemo(() => crumbsFor(listing()?.path ?? ""));
  /** Only the last three ancestors fit a 260px panel; the rest collapse into
   *  a single "…" that still navigates to where they were. */
  const shownCrumbs = createMemo(() => {
    const c = crumbs();
    return c.length > 3 ? c.slice(-3) : c;
  });
  const hiddenCrumb = createMemo(() => {
    const c = crumbs();
    return c.length > 3 ? c[c.length - 4] : null;
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
    <div
      style={
        layoutMode() === "right-split"
          ? { ...panelCard(), flex: 1, "min-height": 0 }
          : panelStyle
      }
    >
      <PanelHeader
        icon="folder-open"
        title="Files"
        meta={listing() ? `${visibleEntries().length} items` : undefined}
        onClose={closeFiles}
        closeTitle="Close file browser"
      />

      <div style={toolbarStyle}>
        <button
          onClick={() => {
            const p = listing()?.parent;
            if (p != null) navigate(p);
          }}
          disabled={listing()?.parent == null}
          class="bs-iconbtn"
          title="Up one level"
          style={navBtn(listing()?.parent == null)}
        >
          <Icon name="arrow-up" />
        </button>
        <button
          onClick={() => navigate(listing()?.path ?? "")}
          class="bs-iconbtn"
          title="Refresh"
          style={navBtn()}
        >
          <Icon name="refresh-cw" />
        </button>
        <button
          onClick={toggleFilesShowHidden}
          class="bs-iconbtn"
          aria-pressed={filesShowHidden()}
          title={filesShowHidden() ? "Hide dotfiles" : "Show dotfiles"}
          style={navBtn()}
        >
          <Icon name={filesShowHidden() ? "eye" : "eye-off"} />
        </button>

        <div
          style={pathSlotStyle}
          onClick={() => {
            if (!editingPath()) {
              setPathDraft(listing()?.path ?? "");
              setEditingPath(true);
            }
          }}
          title="Click to type a path"
        >
          <Show
            when={editingPath()}
            fallback={
              <div style={crumbRowStyle}>
                <Show when={hiddenCrumb()}>
                  {(c) => (
                    <>
                      <button
                        class="bs-btn"
                        style={crumbBtn(false)}
                        title={c().path}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(c().path);
                        }}
                      >
                        …
                      </button>
                      <span style={crumbSepStyle}>
                        <Icon name="chevron-right" size={12} />
                      </span>
                    </>
                  )}
                </Show>
                <For each={shownCrumbs()}>
                  {(c, i) => (
                    <>
                      <Show when={i() > 0}>
                        <span style={crumbSepStyle}>
                          <Icon name="chevron-right" size={12} />
                        </span>
                      </Show>
                      <button
                        class="bs-btn"
                        style={crumbBtn(i() === shownCrumbs().length - 1)}
                        title={c.path}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(c.path);
                        }}
                      >
                        {c.label}
                      </button>
                    </>
                  )}
                </For>
              </div>
            }
          >
            <input
              ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
              class="bs-input"
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
              onBlur={() => {
                commitPath();
                setEditingPath(false);
              }}
              spellcheck={false}
              placeholder="path…"
              style={pathInputStyle}
            />
          </Show>
        </div>

        <button
          onClick={() => doUpload(false)}
          disabled={!!transfer()}
          class="bs-iconbtn"
          title="Upload file(s) to this directory"
          style={navBtn(!!transfer())}
        >
          <Icon name="upload" />
        </button>
        <button
          onClick={() => doUpload(true)}
          disabled={!!transfer()}
          class="bs-iconbtn"
          title="Upload a folder to this directory"
          style={navBtn(!!transfer())}
        >
          <Icon name="folder-up" />
        </button>
      </div>

      <Show when={transfer()}>
        <Notice tone="info">{transfer()}</Notice>
      </Show>
      <Show when={error()}>
        <Notice tone="error">{error()}</Notice>
      </Show>

      <div style={listStyle}>
        <Show when={loading() && showSkeleton()}>
          <Skeleton rows={6} />
        </Show>
        <Show when={!loading() && listing()}>
          <For
            each={visibleEntries()}
            fallback={
              <Show
                when={filesShowHidden() || listing()!.entries.length === 0}
                fallback={
                  <EmptyState
                    icon="eye-off"
                    title="Only dotfiles here"
                    description="Every entry in this directory starts with a dot."
                    action={
                      <button class="bs-btn" style={button("secondary", "compact")} onClick={toggleFilesShowHidden}>
                        <Icon name="eye" size={12} />
                        Show dotfiles
                      </button>
                    }
                  />
                }
              >
                <EmptyState
                  icon="folder-open"
                  title="Empty directory"
                  description="Nothing to list here yet."
                />
              </Show>
            }
          >
            {(e) => (
              <div
                class="bs-row"
                role="button"
                tabindex={0}
                onClick={() => onEntry(e)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onEntry(e);
                  }
                }}
                style={{
                  ...rowStyle,
                  "--btn-fg": e.is_dir ? C.text : C.text2,
                  "--btn-fg-hover": C.text,
                }}
                // The inline style.background writes are gone (.bs-row:hover
                // owns the tint) but hoverPath stays — the ⬇ hangs off it.
                onMouseEnter={() => setHoverPath(e.path)}
                onMouseLeave={() => setHoverPath((p) => (p === e.path ? null : p))}
              >
                <span style={{ color: iconFor(e).color, display: "flex", "flex-shrink": 0 }}>
                  <Icon name={iconFor(e).name} size={16} />
                </span>
                <span style={nameStyle}>{e.name}</span>
                {/* Fixed trailing slot: the size, "opening…" and the ⬇ all
                    share 56px, so the filename never reflows on hover. */}
                <span style={trailStyle}>
                  <Show
                    when={hoverPath() === e.path && !transfer()}
                    fallback={
                      <Show
                        when={openingPath() === e.path}
                        fallback={
                          <Show when={!e.is_dir}>
                            <span style={sizeStyle}>{fmtSize(e.size)}</span>
                          </Show>
                        }
                      >
                        <span style={{ ...sizeStyle, color: C.accent }}>opening…</span>
                      </Show>
                    }
                  >
                    <button
                      class="bs-iconbtn"
                      onClick={(ev) => doDownload(e, ev)}
                      title={e.is_dir ? "Download folder…" : "Download file…"}
                      style={rowDownloadBtn}
                    >
                      <Icon name="download" />
                    </button>
                  </Show>
                </span>
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

const toolbarStyle = {
  padding: `${S[1]} ${S[1.5]}`,
  display: "flex",
  "align-items": "center",
  gap: S[1],
  "flex-shrink": 0,
} as const;

/** The path box. Breadcrumb and text field share it, so the two states are the
 *  same rectangle — only the contents swap. */
const pathSlotStyle = {
  flex: 1,
  "min-width": 0,
  height: H.compact,
  display: "flex",
  "align-items": "center",
  background: C.bg3,
  border: `1px solid ${C.borderSub}`,
  "border-radius": R.sm,
  padding: `0 ${S[0.5]}`,
  cursor: "text",
  overflow: "hidden",
} as const;

const crumbRowStyle = {
  display: "flex",
  "align-items": "center",
  "min-width": 0,
  flex: 1,
  overflow: "hidden",
} as const;

const crumbBtn = (current: boolean): JSX.CSSProperties => ({
    height: "18px",
    padding: `0 ${S[0.5]}`,
    border: "none",
    cursor: "pointer",
    "font-family": FONT.mono,
    ...T[11],
    "font-weight": current ? 500 : 400,
    "--btn-bg": "transparent",
    "--btn-fg": current ? C.text : C.text3,
    "--btn-fg-hover": C.text,
    "max-width": "120px",
    overflow: "hidden",
    "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "flex-shrink": 0,
});

const crumbSepStyle = {
  color: C.text4,
  display: "flex",
  "flex-shrink": 0,
} as const;

const pathInputStyle = {
  flex: 1,
  "min-width": 0,
  height: "18px",
  padding: `0 ${S[1]}`,
  background: "transparent",
  border: "none",
  "font-family": FONT.mono,
  ...T[12],
} as const;

const navBtn = (disabled = false): JSX.CSSProperties => ({
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "none",
  cursor: disabled ? "default" : "pointer",
  "--btn-bg": "transparent",
  "--btn-fg": C.text2,
  "--btn-fg-hover": C.text,
});

const listStyle = {
  flex: 1,
  "overflow-y": "auto",
  "min-height": 0,
  padding: `${S[1]} ${S[1.5]}`,
} as const;

const rowStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  height: H.default,
  padding: `0 ${S[2]}`,
  "border-radius": R.sm,
  cursor: "pointer",
  ...T[12],
  "user-select": "none",
} as const;

const nameStyle = {
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

/** 56px keeps "1023.4 KB", "opening…" and the ⬇ on one right edge. */
const trailStyle = {
  width: "56px",
  "flex-shrink": 0,
  display: "flex",
  "align-items": "center",
  "justify-content": "flex-end",
} as const;

const sizeStyle = {
  ...T[11],
  color: C.text3,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
} as const;

const rowDownloadBtn = {
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "none",
  cursor: "pointer",
  "--btn-bg": "transparent",
  "--btn-fg": C.accent,
} as const;
