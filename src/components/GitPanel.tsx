import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { C } from "../theme";
import {
  closeViewer,
  gitHeight,
  gitState,
  gitWidth,
  openCommit,
  openDiff,
  refreshGit,
  selectCommitFile,
  setGitHeight,
  setGitWidth,
  viewer,
} from "../stores/git";
import { layoutMode, layoutVertical } from "../stores/layout";
import { activeTabId, captureCwdViaPty, setTabCwd } from "../stores/tabs";
import type { GitStatusEntry } from "../ipc/api";
import { CloseX } from "./CloseX";
import { MarkdownViewer } from "./MarkdownViewer";

function isMdPath(p: string | null | undefined): boolean {
  return !!p && p.toLowerCase().endsWith(".md");
}

export function GitPanel() {
  const tabId = () => activeTabId() ?? "";
  const data = () => gitState.data[tabId()];
  const loading = () => !!gitState.loading[tabId()];
  const error = () => gitState.error[tabId()];

  const [dragging, setDragging] = createSignal(false);

  function startDrag(ev: MouseEvent) {
    ev.preventDefault();
    setDragging(true);
    if (layoutVertical()) {
      const startY = ev.clientY;
      const startH = gitHeight();
      const onMove = (e: MouseEvent) => setGitHeight(startH + (startY - e.clientY));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    } else {
      const startX = ev.clientX;
      const startW = gitWidth();
      const onMove = (e: MouseEvent) => setGitWidth(startW + (startX - e.clientX));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  }

  // right-split: no drag handle — App.tsx owns the column's left-edge drag.
  // Panel fills flex:1 in the right column (height is fluid, not fixed).
  if (layoutMode() === "right-split") {
    return (
      <div
        style={{
          flex: 1,
          "min-height": 0,
          width: "100%",
          background: C.bg2,
          "border-bottom": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
          color: C.text,
          "font-size": "13px",
        }}
      >
        <Header loading={loading()} />
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <Show when={error()}>
            <ErrorBox tabId={tabId()} message={error()!} />
          </Show>
          <Show when={data()}>
            {(d) => (
              <Show
                when={!d().not_a_repo}
                fallback={
                  <div style={{ padding: "20px", "text-align": "center", opacity: 0.6 }}>
                    Not a git repository at<br />
                    <code style={{ "font-size": "11px" }}>{d().cwd}</code>
                  </div>
                }
              >
                <BranchHeader d={d()} />
                <StatusSection tabId={tabId()} entries={d().status} />
                <LogSection tabId={tabId()} log={d().log} />
              </Show>
            )}
          </Show>
        </div>
        <Show when={viewer().kind}>
          <ViewerModal />
        </Show>
      </div>
    );
  }

  return (
    <>
      <div
        onMouseDown={startDrag}
        style={layoutVertical() ? {
          height: "4px",
          cursor: "row-resize",
          background: dragging() ? C.accent : "transparent",
          "border-bottom": `1px solid ${C.border}`,
          "flex-shrink": "0",
          transition: "background 0.15s",
        } : {
          width: "4px",
          cursor: "col-resize",
          background: dragging() ? C.accent : "transparent",
          "border-right": `1px solid ${C.border}`,
          "flex-shrink": "0",
          transition: "background 0.15s",
        }}
        title="Drag to resize"
      />
      <div
        style={layoutVertical() ? {
          height: `${gitHeight()}px`,
          width: "100%",
          background: C.bg2,
          "border-top": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          "flex-shrink": "0",
          overflow: "hidden",
          color: C.text,
          "font-size": "13px",
        } : {
          width: `${gitWidth()}px`,
          background: C.bg2,
          "border-left": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          "flex-shrink": "0",
          overflow: "hidden",
          color: C.text,
          "font-size": "13px",
        }}
      >
        <Header loading={loading()} />
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <Show when={error()}>
            <ErrorBox tabId={tabId()} message={error()!} />
          </Show>
          <Show when={data()}>
            {(d) => (
              <Show
                when={!d().not_a_repo}
                fallback={
                  <div style={{ padding: "20px", "text-align": "center", opacity: 0.6 }}>
                    Not a git repository at<br />
                    <code style={{ "font-size": "11px" }}>{d().cwd}</code>
                  </div>
                }
              >
                <BranchHeader d={d()} />
                <StatusSection tabId={tabId()} entries={d().status} />
                <LogSection tabId={tabId()} log={d().log} />
              </Show>
            )}
          </Show>
        </div>
      </div>
      <Show when={viewer().kind}>
        <ViewerModal />
      </Show>
    </>
  );
}

function ErrorBox(p: { tabId: string; message: string }) {
  const [busy, setBusy] = createSignal(false);
  // Heuristic: if the message tells the user to mark cwd, show the quick-detect button.
  const showDetect = () => /Mark cwd|working directory/.test(p.message);

  async function detect() {
    if (busy()) return;
    setBusy(true);
    try {
      const path = await captureCwdViaPty(p.tabId);
      if (path) {
        setTabCwd(p.tabId, path);
        await refreshGit(p.tabId);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "12px", "font-size": "12px", display: "flex", "flex-direction": "column", gap: "10px" }}>
      <div style={{ color: C.red }}>{p.message}</div>
      <Show when={showDetect()}>
        <button
          onClick={detect}
          disabled={busy()}
          style={{
            background: C.accent,
            color: "#fff",
            border: "none",
            "border-radius": "6px",
            padding: "5px 12px",
            "font-size": "12px",
            cursor: busy() ? "default" : "pointer",
            "font-weight": 600,
            "align-self": "flex-start",
            opacity: busy() ? 0.6 : 1,
          }}
        >
          {busy() ? "Detecting…" : "📍 Detect from current shell"}
        </button>
      </Show>
    </div>
  );
}

function Header(_p: { loading: boolean }) {
  return (
    <div
      style={{
        padding: "7px 10px",
        "border-bottom": `1px solid ${C.border}`,
        display: "flex",
        "align-items": "center",
        gap: "6px",
        "flex-shrink": 0,
      }}
    >
      <strong style={{ "font-size": "12px", color: C.text2 }}>🌿 Git view</strong>
    </div>
  );
}

function BranchHeader(p: { d: NonNullable<ReturnType<() => any>> }) {
  const ahead = p.d.ahead as number;
  const behind = p.d.behind as number;
  const status = p.d.status as GitStatusEntry[];
  return (
    <div style={{ padding: "8px 12px", "border-bottom": `1px solid ${C.border}` }}>
      <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
        <span style={{ background: C.bg3, color: C.text, padding: "1px 8px", "border-radius": "10px", "font-size": "12px", "font-weight": 600 }}>
          {p.d.detached ? "DETACHED" : p.d.branch ?? "(no branch)"}
        </span>
        <Show when={p.d.upstream}>
          <span style={{ "font-size": "11px", color: C.text3 }}>→ {p.d.upstream}</span>
        </Show>
        <Show when={ahead > 0 || behind > 0}>
          <span style={{ "font-size": "11px" }}>
            <Show when={ahead > 0}>
              <span style={{ color: C.green }}>↑{ahead}</span>{" "}
            </Show>
            <Show when={behind > 0}>
              <span style={{ color: C.red }}>↓{behind}</span>
            </Show>
          </span>
        </Show>
        <span style={{ "margin-left": "auto", "font-size": "11px", color: C.text3 }}>
          {status.length === 0 ? "clean" : `${status.length} change${status.length === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

function StatusSection(p: { tabId: string; entries: GitStatusEntry[] }) {
  return (
    <Show when={p.entries.length > 0}>
      <div style={{ "border-bottom": `1px solid ${C.border}` }}>
        <div style={{ padding: "6px 12px", "font-size": "10px", "letter-spacing": "0.06em", color: C.text3, "font-weight": 600 }}>
          STATUS ({p.entries.length})
        </div>
        <For each={p.entries}>
          {(e) => <StatusRow tabId={p.tabId} e={e} />}
        </For>
      </div>
    </Show>
  );
}

function StatusRow(p: { tabId: string; e: GitStatusEntry }) {
  const e = p.e;
  const stagedChar = e.staged === " " ? "" : e.staged;
  const workChar = e.work === " " ? "" : e.work;
  const isUntracked = e.staged === "?" && e.work === "?";
  const useStagedDiff = !isUntracked && e.staged !== " " && e.work === " ";

  return (
    <div
      onClick={() => openDiff(p.tabId, e.path, useStagedDiff, isUntracked)}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "4px 12px",
        cursor: "pointer",
        "font-size": "12px",
      }}
      onMouseOver={(ev) => (ev.currentTarget.style.background = C.bgHover)}
      onMouseOut={(ev) => (ev.currentTarget.style.background = "transparent")}
      title={isUntracked ? "Untracked — click to view" : "Click to view diff"}
    >
      <span style={{ "font-family": "monospace", width: "20px", "text-align": "center" }}>
        <span style={{ color: stagedColor(e.staged) }}>{stagedChar}</span>
        <span style={{ color: workColor(e.work) }}>{workChar}</span>
      </span>
      <span style={{ flex: 1, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "font-family": "monospace" }}>
        {e.orig_path && <span style={{ opacity: 0.5 }}>{e.orig_path} → </span>}
        {e.path}
      </span>
    </div>
  );
}

function stagedColor(c: string): string {
  switch (c) {
    case "M": return C.green;
    case "A": return C.accent;
    case "D": return C.red;
    case "R": return C.purple;
    case "C": return "#5ac8fa";
    case "U": return C.orange;
    case "?": return C.text3;
    default:  return C.text;
  }
}
function workColor(c: string): string {
  switch (c) {
    case "M": return C.yellow;
    case "D": return C.red;
    case "?": return C.text3;
    case "U": return C.orange;
    default:  return C.text;
  }
}

function LogSection(p: { tabId: string; log: any[] }) {
  return (
    <Show when={p.log.length > 0}>
      <div>
        <div style={{ padding: "6px 12px", "font-size": "10px", "letter-spacing": "0.06em", color: C.text3, "font-weight": 600 }}>
          LOG ({p.log.length})
        </div>
        <div style={{ "font-family": "monospace", "font-size": "12px" }}>
          <For each={p.log}>
            {(line) => <LogRow tabId={p.tabId} line={line} />}
          </For>
        </div>
      </div>
    </Show>
  );
}

function LogRow(p: { tabId: string; line: any }) {
  const c = p.line.commit;
  if (!c) {
    // Graph-only connector line
    return (
      <div style={{ padding: "0 12px", "white-space": "pre", color: C.text3 }}>
        {p.line.graph}
      </div>
    );
  }
  return (
    <div
      onClick={() => openCommit(p.tabId, c.hash)}
      style={{
        display: "flex",
        "align-items": "baseline",
        gap: "6px",
        padding: "2px 12px",
        cursor: "pointer",
        "white-space": "nowrap",
        overflow: "hidden",
      }}
      onMouseOver={(ev) => (ev.currentTarget.style.background = C.bgHover)}
      onMouseOut={(ev) => (ev.currentTarget.style.background = "transparent")}
      title={`${c.hash}\n${c.author} • ${c.time_relative}`}
    >
      <span style={{ color: C.text3, "white-space": "pre" }}>{p.line.graph}</span>
      <span style={{ color: C.orange }}>{c.hash_short}</span>
      <Show when={c.refs}>
        <span style={{ color: C.green, "font-size": "11px" }}>{c.refs}</span>
      </Show>
      <span style={{ flex: 1, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis" }}>
        {c.subject}
      </span>
      <span style={{ color: C.text3, "font-size": "11px", "flex-shrink": 0 }}>
        {c.time_relative}
      </span>
    </div>
  );
}

function ViewerModal() {
  const [maximized, setMaximized] = createSignal(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeViewer();
  };
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <div
      onClick={closeViewer}
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "z-index": "200",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(28,28,30,0.98)",
          "backdrop-filter": "blur(40px) saturate(180%)",
          color: C.text,
          border: `1px solid ${C.border}`,
          "box-shadow": "0 24px 64px rgba(0,0,0,0.8)",
          width: maximized() ? "98vw" : "min(1100px, 94vw)",
          height: maximized() ? "96vh" : "min(760px, 90vh)",
          "border-radius": maximized() ? "10px" : "14px",
          transition: "width 0.18s ease, height 0.18s ease",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Show when={viewer().kind === "diff"}>
          <DiffViewerContent />
        </Show>
        <Show when={viewer().kind === "commit"}>
          <CommitViewerContent />
        </Show>
        <MaximizeBtn maximized={maximized()} onToggle={() => setMaximized((m) => !m)} />
        <CloseX onClose={closeViewer} />
      </div>
    </div>
  );
}

/** Top-right maximize/restore toggle for the viewer modal.
 *  Sits left of CloseX; parent must be position: relative. */
function MaximizeBtn(props: { maximized: boolean; onToggle: () => void }) {
  const [hover, setHover] = createSignal(false);
  return (
    <button
      onClick={props.onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={props.maximized ? "Restore size" : "Maximize"}
      style={{
        position: "absolute",
        top: "10px",
        right: "46px",
        background: hover() ? C.bgHover : "transparent",
        color: hover() ? C.text : C.text3,
        border: "none",
        "font-size": "15px",
        "line-height": "1",
        cursor: "pointer",
        padding: "3px 8px",
        "border-radius": "6px",
        "z-index": "10",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {props.maximized ? "⤡" : "⤢"}
    </button>
  );
}

function DiffViewerContent() {
  const [showPreview, setShowPreview] = createSignal(false);
  const v = () => {
    const x = viewer();
    return x.kind === "diff" ? x : null;
  };
  const isMd = () => isMdPath(v()?.path);
  // Reset preview tab whenever a different file is opened.
  createEffect(on(() => v()?.path, () => setShowPreview(false), { defer: true }));

  return (
    <Show when={v()}>
      {(d) => (
        <>
          <div style={modalHeader}>
            <strong style={{ "font-size": "14px", "font-family": "monospace" }}>{d().title}</strong>
            <Show when={isMd()}>
              <div style={{ "margin-left": "auto", display: "flex", gap: "4px" }}>
                <TabBtn active={!showPreview()} onClick={() => setShowPreview(false)}>Diff</TabBtn>
                <TabBtn active={showPreview()} onClick={() => setShowPreview(true)}>Preview</TabBtn>
              </div>
            </Show>
          </div>
          <Show
            when={showPreview() && isMd()}
            fallback={
              <div style={diffScrollArea}>
                <Show when={d().loading} fallback={<DiffBody body={d().body} />}>
                  <div style={{ opacity: 0.6 }}>Loading…</div>
                </Show>
              </div>
            }
          >
            <MarkdownViewer
              sessionId={d().sessionId}
              cwd={d().cwd}
              path={d().path}
              rev={d().mdRev}
            />
          </Show>
        </>
      )}
    </Show>
  );
}

function CommitViewerContent() {
  const [showPreview, setShowPreview] = createSignal(false);
  const v = () => {
    const x = viewer();
    return x.kind === "commit" ? x : null;
  };
  const isMd = () => isMdPath(v()?.selectedPath);
  // Reset preview tab when a different file is selected.
  createEffect(on(() => v()?.selectedPath, () => setShowPreview(false), { defer: true }));

  return (
    <Show when={v()}>
      {(c) => (
        <>
          <div style={modalHeader}>
            <span style={{ color: C.orange, "font-family": "monospace", "font-weight": 600 }}>
              {c().detail?.hash_short ?? c().rev.slice(0, 7)}
            </span>
            <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {c().detail?.subject ?? c().rev}
            </span>
            <Show when={isMd()}>
              <div style={{ display: "flex", gap: "4px", "flex-shrink": 0 }}>
                <TabBtn active={!showPreview()} onClick={() => setShowPreview(false)}>Diff</TabBtn>
                <TabBtn active={showPreview()} onClick={() => setShowPreview(true)}>Preview</TabBtn>
              </div>
            </Show>
          </div>
          <Show when={c().error}>
            <div style={{ padding: "12px 16px", color: "#f38ba8" }}>{c().error}</div>
          </Show>
          <Show when={c().loading}>
            <div style={{ padding: "20px", opacity: 0.6 }}>Loading commit…</div>
          </Show>
          <Show when={c().detail}>
            {(d) => (
              <>
                <CommitMeta detail={d()} />
                <div style={{ flex: 1, display: "flex", "min-height": 0 }}>
                  <CommitFileList
                    detail={d()}
                    selected={c().selectedPath}
                    onSelect={(p) => { selectCommitFile(p); setShowPreview(false); }}
                  />
                  <Show
                    when={showPreview() && isMd() && c().selectedPath}
                    fallback={
                      <div style={diffScrollArea}>
                        <Show
                          when={c().fileLoading}
                          fallback={
                            <Show when={c().selectedPath} fallback={<div style={{ opacity: 0.6 }}>Select a file on the left.</div>}>
                              <DiffBody body={c().fileDiff} />
                            </Show>
                          }
                        >
                          <div style={{ opacity: 0.6 }}>Loading diff…</div>
                        </Show>
                      </div>
                    }
                  >
                    <MarkdownViewer
                      sessionId={c().sessionId}
                      cwd={c().cwd}
                      path={c().selectedPath!}
                      rev={c().rev}
                    />
                  </Show>
                </div>
              </>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}

function CommitMeta(p: { detail: NonNullable<ReturnType<() => any>> }) {
  const d = p.detail;
  return (
    <div style={{ padding: "8px 16px", "border-bottom": `1px solid ${C.border}`, "font-size": "12px", color: C.text2 }}>
      <div style={{ opacity: 0.7 }}>
        <strong style={{ "font-weight": 600 }}>{d.author}</strong>
        <span style={{ "margin-left": "8px" }}>{d.author_date}</span>
        <Show when={d.committer && d.committer !== d.author}>
          <span style={{ "margin-left": "12px", opacity: 0.7 }}>committed by {d.committer}</span>
        </Show>
      </div>
      <Show when={d.body}>
        <pre style={{ margin: "8px -16px 0 0", "padding-right": "16px", "font-size": "12px", "white-space": "pre-wrap", "font-family": "inherit", opacity: 0.85, "max-height": "140px", "overflow-y": "auto" }}>
          {d.body}
        </pre>
      </Show>
    </div>
  );
}

function CommitFileList(p: { detail: any; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <div style={{ width: "260px", "min-width": "200px", "border-right": `1px solid ${C.border}`, "overflow-y": "auto", "flex-shrink": 0 }}>
      <div style={{ padding: "6px 12px", "font-size": "10px", "letter-spacing": "0.06em", color: C.text3, "font-weight": 600 }}>
        FILES ({p.detail.files.length})
      </div>
      <For each={p.detail.files}>
        {(f: any) => (
          <div
            onClick={() => p.onSelect(f.path)}
            style={{
              padding: "4px 12px",
              cursor: "pointer",
              background: p.selected === f.path ? C.bgActive : "transparent",
              display: "flex",
              "align-items": "center",
              gap: "8px",
              "font-size": "12px",
              "font-family": "monospace",
              "white-space": "nowrap",
            }}
            onMouseOver={(ev) => {
              if (p.selected !== f.path) ev.currentTarget.style.background = C.bgHover;
            }}
            onMouseOut={(ev) => {
              if (p.selected !== f.path) ev.currentTarget.style.background = "transparent";
            }}
            title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
          >
            <span style={{ width: "26px", color: commitFileColor(f.status), "text-align": "center" }}>
              {f.status}
            </span>
            <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis" }}>
              {f.path}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function commitFileColor(status: string): string {
  if (status.startsWith("A")) return C.accent;
  if (status.startsWith("M")) return C.green;
  if (status.startsWith("D")) return C.red;
  if (status.startsWith("R")) return C.purple;
  if (status.startsWith("C")) return "#5ac8fa";
  return C.text;
}

function TabBtn(p: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={p.onClick}
      style={{
        background: p.active ? C.accent : C.bg3,
        color: p.active ? "#fff" : C.text2,
        border: "none",
        "border-radius": "6px",
        padding: "3px 10px",
        "font-size": "11px",
        "font-weight": p.active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {p.children}
    </button>
  );
}

const modalHeader = {
  // Right padding clears the two absolute corner buttons (maximize + close).
  padding: "10px 84px 10px 16px",
  "border-bottom": `1px solid ${C.border}`,
  display: "flex",
  "align-items": "center",
  gap: "10px",
  "flex-shrink": 0,
} as const;

const diffScrollArea = {
  flex: 1,
  "overflow-y": "auto",
  padding: "12px 16px",
  "font-family": "monospace",
  "font-size": "12px",
  "line-height": 1.5,
  "white-space": "pre",
  "tab-size": "4",
  "min-width": 0,
} as const;

function DiffBody(p: { body: string }) {
  // Color +/-/@@ lines for readability without running a syntax highlighter.
  // file/hunk headers are styled as section dividers so a long multi-file
  // commit diff stays navigable just by scrolling.
  const lines = p.body.split("\n");
  return (
    <For each={lines}>
      {(line) => {
        // file header: `diff --git a/foo b/foo` — section opener, gets a top
        // border + bg tint so it visually separates files in a commit diff.
        if (line.startsWith("diff --git")) {
          return <div style={diffFileHeader}>{line}</div>;
        }
        // +++/--- file path lines belong to the same file header block.
        if (line.startsWith("+++") || line.startsWith("---")) {
          return <div style={diffFilePath}>{line}</div>;
        }
        // hunk header: subtle bg + cyan text, reads as inner section break.
        if (line.startsWith("@@")) {
          return <div style={diffHunkHeader}>{line}</div>;
        }
        // commit metadata lines (only present in `git show`-style bodies).
        if (line.startsWith("commit ")) {
          return <div style={{ color: C.orange, "font-weight": 600 }}>{line}</div>;
        }
        if (line.startsWith("Author: ") || line.startsWith("Date: ")) {
          return <div style={{ color: C.text2 }}>{line}</div>;
        }
        // additions / deletions: full-bleed tinted bg so the eye traces the
        // changed regions even when scanning quickly.
        if (line.startsWith("+")) {
          return <div style={diffAdd}>{line}</div>;
        }
        if (line.startsWith("-")) {
          return <div style={diffDel}>{line}</div>;
        }
        // context line — keep neutral but slightly dimmed so the +/- pop.
        return <div style={{ color: C.text2 }}>{line}</div>;
      }}
    </For>
  );
}

const diffFileHeader = {
  color: C.orange,
  "font-weight": 600,
  background: "rgba(255,159,10,0.08)",
  padding: "6px 8px",
  "margin-top": "10px",
  "border-top": `1px solid ${C.border}`,
  "border-radius": "4px 4px 0 0",
  position: "sticky",
  top: "-12px",
  "z-index": 1,
  "backdrop-filter": "blur(6px)",
} as const;

const diffFilePath = {
  color: C.purple,
  background: "rgba(191,90,242,0.06)",
  padding: "0 8px",
} as const;

const diffHunkHeader = {
  color: "#5ac8fa",
  background: "rgba(90,200,250,0.08)",
  padding: "3px 8px",
  "margin-top": "6px",
  "border-radius": "3px",
} as const;

const diffAdd = {
  color: C.green,
  background: "rgba(48,209,88,0.10)",
  padding: "0 8px",
} as const;

const diffDel = {
  color: C.red,
  background: "rgba(255,69,58,0.12)",
  padding: "0 8px",
} as const;
