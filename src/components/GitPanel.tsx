import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { button, C, dialogStyle, FONT, H, M, overlayStyle, R, S, T, TYPO } from "../theme";
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
  toggleGit,
  viewer,
} from "../stores/git";
import { layoutMode, layoutVertical } from "../stores/layout";
import { activeTabId, captureCwdViaPty, setTabCwd } from "../stores/tabs";
import type { GitCommitFile, GitLogLine, GitStatusEntry } from "../ipc/api";
import { CloseX } from "./CloseX";
import { PanelHeader, panelCard } from "./ui/PanelHeader";
import { EmptyState, Skeleton } from "./ui/EmptyState";
import { Notice } from "./ui/Notice";
import { StatusDot } from "./ui/StatusDot";
import { Icon } from "../icons";
import { MarkdownViewer } from "./MarkdownViewer";

function isMdPath(p: string | null | undefined): boolean {
  return !!p && p.toLowerCase().endsWith(".md");
}

/** The surface the panel content sits on: the card's --bg-2 in right-split,
 *  the inline column's --bg-1 otherwise. Sticky section labels need an opaque
 *  background of their own, and it has to match whichever one is behind them. */
const surface = () => (layoutMode() === "right-split" ? C.bg : C.bg2);

export function GitPanel() {
  const tabId = () => activeTabId() ?? "";

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
      <div style={{ ...panelCard(), flex: 1, "min-height": 0 }}>
        <Header loading={!!gitState.loading[tabId()]} tabId={tabId()} />
        <PanelBody tabId={tabId()} />
        <Show when={viewer().kind}>
          <ViewerModal />
        </Show>
      </div>
    );
  }

  return (
    <>
      <div
        class="bs-resize"
        data-axis={layoutVertical() ? "row" : "col"}
        data-dragging={dragging() ? "true" : "false"}
        onMouseDown={startDrag}
        style={layoutVertical() ? rowHandle : colHandle}
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
          ...T[13],
        } : {
          width: `${gitWidth()}px`,
          background: C.bg2,
          "border-left": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          "flex-shrink": "0",
          overflow: "hidden",
          color: C.text,
          ...T[13],
        }}
      >
        <Header loading={!!gitState.loading[tabId()]} tabId={tabId()} />
        <PanelBody tabId={tabId()} />
      </div>
      <Show when={viewer().kind}>
        <ViewerModal />
      </Show>
    </>
  );
}

/** Everything under the header. Shared by both layouts so the loading, error
 *  and empty branches can never drift apart between them. */
function PanelBody(p: { tabId: string }) {
  const data = () => gitState.data[p.tabId];
  const loading = () => !!gitState.loading[p.tabId];
  const error = () => gitState.error[p.tabId];

  return (
    <div style={{ flex: 1, "overflow-y": "auto" }}>
      <Show when={error()}>
        <ErrorBox tabId={p.tabId} message={error()!} />
      </Show>
      {/* First load only: a skeleton shows the shape of the answer. A refresh
          of already-cached data keeps the old list on screen instead. */}
      <Show when={loading() && !data()}>
        <Skeleton rows={5} />
      </Show>
      <Show when={data()}>
        {(d) => (
          <Show
            when={!d().not_a_repo}
            fallback={
              <EmptyState
                icon="git-branch"
                title="Not a git repository"
                description={<span style={{ "font-family": FONT.mono }}>{d().cwd}</span>}
              />
            }
          >
            <BranchHeader d={d()} />
            <StatusSection tabId={p.tabId} entries={d().status} />
            <LogSection tabId={p.tabId} log={d().log} />
          </Show>
        )}
      </Show>
    </div>
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
    <>
      <Notice tone="error">{p.message}</Notice>
      <Show when={showDetect()}>
        <div style={{ padding: `${S[2]} ${S[3]}` }}>
          <button class="bs-btn" onClick={detect} disabled={busy()} style={button("primary", "default")}>
            <Icon name="map-pin" size={12} />
            {busy() ? "Detecting…" : "Detect from current shell"}
          </button>
        </div>
      </Show>
    </>
  );
}

function Header(p: { loading: boolean; tabId: string }) {
  return (
    <PanelHeader
      icon="git-branch"
      title="Git"
      meta={
        <Show when={p.loading}>
          <span style={{ display: "flex" }}>
            <Icon name="refresh-cw" size={12} class="bs-spin" />
          </span>
        </Show>
      }
      onClose={() => toggleGit(p.tabId)}
      closeTitle="Close Git view"
    />
  );
}

/** Grab strips. No border of their own — the panel card draws the only line. */
const rowHandle = {
  height: "4px",
  cursor: "row-resize",
  "z-index": "5",
} as const;

const colHandle = {
  width: "4px",
  cursor: "col-resize",
  "z-index": "5",
} as const;

/** One uppercase section opener. Sticky, so the eye always knows which list it
 *  is scrolling through — hence the opaque background of its own. */
function SectionLabel(p: { children: JSX.Element }) {
  return (
    <div
      style={{
        ...TYPO.section,
        display: "flex",
        "align-items": "center",
        height: H.compact,
        padding: `0 ${S[3]}`,
        position: "sticky",
        top: "0",
        "z-index": "1",
        background: surface(),
      }}
    >
      {p.children}
    </div>
  );
}

function BranchHeader(p: { d: NonNullable<ReturnType<() => any>> }) {
  const ahead = p.d.ahead as number;
  const behind = p.d.behind as number;
  const status = p.d.status as GitStatusEntry[];
  return (
    <div style={{ padding: `${S[2]} ${S[3]}`, "border-bottom": `1px solid ${C.borderSub}` }}>
      <div style={{ display: "flex", "align-items": "center", gap: S[1.5], "flex-wrap": "wrap" }}>
        <span style={branchPill}>
          {p.d.detached ? "DETACHED" : p.d.branch ?? "(no branch)"}
        </span>
        <Show when={p.d.upstream}>
          <span style={{ ...T[11], color: C.text2, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis" }}>
            {p.d.upstream}
          </span>
        </Show>
        <Show when={ahead > 0 || behind > 0}>
          <span style={{ display: "flex", "align-items": "center", gap: S[1], ...T[11] }}>
            <Show when={ahead > 0}>
              <span style={{ display: "flex", "align-items": "center", color: C.green }}>
                <Icon name="arrow-up" size={12} />
                {ahead}
              </span>
            </Show>
            <Show when={behind > 0}>
              <span style={{ display: "flex", "align-items": "center", color: C.red }}>
                <Icon name="arrow-down" size={12} />
                {behind}
              </span>
            </Show>
          </span>
        </Show>
        <span style={{ "margin-left": "auto", ...T[11], color: C.text2, "flex-shrink": 0 }}>
          {status.length === 0 ? "clean" : `${status.length} change${status.length === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

const branchPill = {
  display: "inline-flex",
  "align-items": "center",
  height: "18px",
  padding: `0 ${S[2]}`,
  background: C.bg3,
  color: C.text,
  "border-radius": R.full,
  ...T[11],
  "font-weight": 600,
  "max-width": "180px",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

/* --------------------------------------------------------------- status */

function StatusSection(p: { tabId: string; entries: GitStatusEntry[] }) {
  return (
    <div style={{ "border-bottom": `1px solid ${C.borderSub}`, "padding-bottom": S[1] }}>
      <SectionLabel>Status ({p.entries.length})</SectionLabel>
      <Show when={p.entries.length > 0} fallback={<CleanRow />}>
        <For each={p.entries}>
          {(e) => <StatusRow tabId={p.tabId} e={e} />}
        </For>
      </Show>
    </div>
  );
}

function CleanRow() {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: S[2],
        height: H.default,
        padding: `0 ${S[3]}`,
        color: C.text2,
        ...T[12],
      }}
    >
      <StatusDot state="connected" size={6} />
      Working tree clean
    </div>
  );
}

function StatusRow(p: { tabId: string; e: GitStatusEntry }) {
  const e = p.e;
  const isUntracked = e.staged === "?" && e.work === "?";
  const useStagedDiff = !isUntracked && e.staged !== " " && e.work === " ";
  const parts = splitPath(e.path);
  const open = () => openDiff(p.tabId, e.path, useStagedDiff, isUntracked);

  return (
    <div
      class="bs-row"
      role="button"
      tabindex={0}
      onClick={open}
      onKeyDown={(ev) => activateOnKey(ev, open)}
      style={listRowStyle}
      title={
        (e.orig_path ? `${e.orig_path} → ${e.path}\n` : `${e.path}\n`) +
        (isUntracked ? "Untracked — click to view" : "Click to view diff")
      }
    >
      <span style={badgeSlot}>
        <Show when={!isUntracked} fallback={<StatusBadge code="?" column="work" />}>
          <Show when={e.staged !== " "}>
            <StatusBadge code={e.staged} column="staged" />
          </Show>
          <Show when={e.work !== " "}>
            <StatusBadge code={e.work} column="work" />
          </Show>
        </Show>
      </span>
      <span style={fileNameStyle}>{parts.name}</span>
      <Show when={parts.dir}>
        <span style={fileDirStyle}>{parts.dir}</span>
      </Show>
    </div>
  );
}

/** Two-part path: the filename carries the meaning, the directory is context.
 *  Name first — and it is the last thing to shrink — so a 260px panel still
 *  answers "which file?" before it answers "where?". */
function splitPath(path: string): { name: string; dir: string } {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i < 0) return { name: path, dir: "" };
  return { name: path.slice(i + 1), dir: path.slice(0, i) };
}

/** Enter / Space activate a role="button" div, the way a real button does. */
function activateOnKey(ev: KeyboardEvent, run: () => void) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    run();
  }
}

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  M: { fg: C.green,  bg: C.greenBg },
  A: { fg: C.accent, bg: C.accentBg },
  D: { fg: C.red,    bg: C.redBg },
  R: { fg: C.purple, bg: C.purpleBg },
  C: { fg: C.cyan,   bg: C.cyanBg },
  T: { fg: C.cyan,   bg: C.cyanBg },
  U: { fg: C.orange, bg: C.orangeBg },
  "?": { fg: C.text3,  bg: C.bg3 },
  "!": { fg: C.yellow, bg: C.yellowBg },
};

function statusTone(code: string, column: "staged" | "work"): { fg: string; bg: string } {
  // A modification that exists only in the work tree is the "not staged yet"
  // state — yellow — while the same letter in the index column is green.
  if (column === "work" && code === "M") return { fg: C.yellow, bg: C.yellowBg };
  return STATUS_TONE[code] ?? { fg: C.text2, bg: C.bg3 };
}

/** The one M / A / D / R marker: a 16px tinted chip, so the letters sit on a
 *  grid instead of floating on the text baseline at four different widths. */
function StatusBadge(p: { code: string; column: "staged" | "work" }) {
  const tone = () => statusTone(p.code, p.column);
  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        width: "16px",
        height: "16px",
        "flex-shrink": 0,
        "border-radius": R.xs,
        "font-family": FONT.mono,
        ...T[10],
        "font-weight": 600,
        color: tone().fg,
        background: tone().bg,
      }}
    >
      {p.code}
    </span>
  );
}

/* ------------------------------------------------------------------ log */

function LogSection(p: { tabId: string; log: GitLogLine[] }) {
  const commits = () => p.log.filter((l) => l.commit).length;
  return (
    <Show when={p.log.length > 0}>
      <div style={{ "padding-bottom": S[1] }}>
        <SectionLabel>Log ({commits()})</SectionLabel>
        <For each={p.log}>
          {(line) => <LogRow tabId={p.tabId} line={line} />}
        </For>
      </div>
    </Show>
  );
}

/** "3 days ago" → "3d". The full string stays in the row's tooltip. */
function shortTime(rel: string): string {
  const m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?/.exec(rel.trim());
  if (!m) return rel.replace(/\s*ago$/, "");
  const unit: Record<string, string> = {
    second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y",
  };
  return `${m[1]}${unit[m[2]]}`;
}

function LogRow(p: { tabId: string; line: GitLogLine }) {
  const c = p.line.commit;
  if (!c) {
    // Graph-only connector line: pure decoration, and short, so it reads as
    // the gap between two commits rather than as a row of its own.
    return <div style={graphOnlyStyle}>{p.line.graph}</div>;
  }
  const open = () => openCommit(p.tabId, c.hash);
  return (
    <div
      class="bs-row"
      role="button"
      tabindex={0}
      onClick={open}
      onKeyDown={(ev) => activateOnKey(ev, open)}
      style={logRowStyle}
      title={`${c.hash}\n${c.author} • ${c.time_relative}\n${c.subject}`}
    >
      <Show when={p.line.graph.trim()}>
        <span style={graphStyle}>{p.line.graph}</span>
      </Show>
      <span style={hashStyle}>{c.hash_short}</span>
      <Show when={c.refs}>
        <RefChips refs={c.refs} />
      </Show>
      <span style={subjectStyle}>{c.subject}</span>
      <span style={timeStyle}>{shortTime(c.time_relative)}</span>
    </div>
  );
}

const listRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  height: H.default,
  padding: `0 ${S[3]}`,
  "border-radius": R.sm,
  cursor: "pointer",
  ...T[12],
  "--btn-fg": C.text2,
  "user-select": "none",
} as const;

const logRowStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.default,
  padding: `0 ${S[3]}`,
  "border-radius": R.sm,
  cursor: "pointer",
  overflow: "hidden",
  "--btn-fg": C.text2,
  "user-select": "none",
} as const;

const badgeSlot = {
  display: "flex",
  "align-items": "center",
  "justify-content": "flex-end",
  gap: S[1],
  width: "36px",
  "flex-shrink": 0,
} as const;

const fileNameStyle = {
  color: C.text,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

/** The directory half. `direction: rtl` keeps the ellipsis on the LEFT, so a
 *  deep path shows the folder the file is actually in. */
const fileDirStyle = {
  ...T[11],
  color: C.text3,
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "text-align": "right",
  direction: "rtl",
} as const;

const graphOnlyStyle = {
  display: "flex",
  "align-items": "center",
  height: "14px",
  padding: `0 ${S[3]}`,
  "font-family": FONT.mono,
  ...T[11],
  color: C.text4,
  "white-space": "pre",
} as const;

/* LOG rows keep git's own colour vocabulary so a glance at the list reads like
 * `git log --oneline --decorate`: orange graph + hash (the pre-redesign look),
 * and one chip per decoration coloured by kind — HEAD cyan, local branch
 * green, remote purple, tag yellow. */
const graphStyle = {
  "font-family": FONT.mono,
  color: C.orange,
  "white-space": "pre",
  "flex-shrink": 0,
} as const;

const hashStyle = {
  "font-family": FONT.mono,
  ...T[11],
  color: C.orange,
  "font-variant-numeric": "tabular-nums",
  "flex-shrink": 0,
} as const;

type RefKind = "head" | "branch" | "remote" | "tag";

function refKind(ref: string): RefKind {
  if (ref.startsWith("HEAD")) return "head";
  if (ref.startsWith("tag:")) return "tag";
  if (ref.includes("/")) return "remote";
  return "branch";
}

const REF_TINT: Record<RefKind, { fg: string; bg: string }> = {
  head:   { fg: C.cyan,   bg: C.cyanBg },
  branch: { fg: C.green,  bg: C.greenBg },
  remote: { fg: C.purple, bg: C.purpleBg },
  tag:    { fg: C.yellow, bg: C.yellowBg },
};

/** `%d` decorations — "(HEAD -> main, origin/main, tag: v1.2.0)" — split into
 *  one chip each so every ref gets its own colour instead of one green blob. */
function RefChips(p: { refs: string }) {
  const parts = () =>
    p.refs
      .replace(/^\s*\(/, "")
      .replace(/\)\s*$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <For each={parts()}>
      {(ref) => {
        const tint = REF_TINT[refKind(ref)];
        return (
          <span style={{ ...refChipStyle, color: tint.fg, background: tint.bg }} title={ref}>
            {ref}
          </span>
        );
      }}
    </For>
  );
}

const refChipStyle = {
  display: "inline-flex",
  "align-items": "center",
  height: "14px",
  padding: `0 ${S[1]}`,
  "border-radius": R.xs,
  ...T[10],
  "max-width": "110px",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "flex-shrink": 0,
} as const;

const subjectStyle = {
  "font-family": FONT.ui,
  ...T[12],
  color: C.text,
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const timeStyle = {
  ...T[11],
  color: C.text3,
  "font-variant-numeric": "tabular-nums",
  "flex-shrink": 0,
} as const;

/* --------------------------------------------------------------- viewer */

function ViewerModal() {
  const [maximized, setMaximized] = createSignal(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeViewer();
  };
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <div onClick={closeViewer} style={{ ...overlayStyle, "z-index": "200" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...dialogStyle,
          padding: "0",
          width: maximized() ? "98vw" : "min(1100px, 94vw)",
          height: maximized() ? "96vh" : "min(760px, 90vh)",
          "border-radius": maximized() ? R.lg : R.xl,
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
          animation: `bs-pop-in ${M.d3} ${M.easePop} both`,
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
  return (
    <button
      class="bs-iconbtn"
      onClick={props.onToggle}
      title={props.maximized ? "Restore size" : "Maximize"}
      style={{
        position: "absolute",
        top: "10px",
        right: "36px",
        width: "22px",
        height: "22px",
        padding: "0",
        border: "none",
        cursor: "pointer",
        "--btn-bg": "transparent",
        "--btn-fg": C.text3,
        "--btn-fg-hover": C.text,
        "z-index": "10",
      }}
    >
      <Icon name={props.maximized ? "minimize-2" : "maximize-2"} size={14} />
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
            <span style={modalTitleStyle}>{d().title}</span>
            <Show when={isMd()}>
              <div style={{ "margin-left": "auto", display: "flex", gap: S[1] }}>
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
                  <Skeleton rows={6} />
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
            <span style={{ ...hashStyle, ...T[12] }}>
              {c().detail?.hash_short ?? c().rev.slice(0, 7)}
            </span>
            <span style={{ flex: 1, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {c().detail?.subject ?? c().rev}
            </span>
            <Show when={isMd()}>
              <div style={{ display: "flex", gap: S[1], "flex-shrink": 0 }}>
                <TabBtn active={!showPreview()} onClick={() => setShowPreview(false)}>Diff</TabBtn>
                <TabBtn active={showPreview()} onClick={() => setShowPreview(true)}>Preview</TabBtn>
              </div>
            </Show>
          </div>
          <Show when={c().error}>
            <Notice tone="error">{c().error}</Notice>
          </Show>
          <Show when={c().loading}>
            <Skeleton rows={5} />
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
                            <Show
                              when={c().selectedPath}
                              fallback={
                                <div style={proseReset}>
                                  <EmptyState
                                    icon="file"
                                    title="No file selected"
                                    description="Pick a file on the left to see its diff."
                                  />
                                </div>
                              }
                            >
                              <DiffBody body={c().fileDiff} />
                            </Show>
                          }
                        >
                          <Skeleton rows={6} />
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
    <div style={{ padding: `${S[2]} ${S[4]}`, "border-bottom": `1px solid ${C.borderSub}`, ...T[12], color: C.text2 }}>
      <div>
        <span style={{ "font-weight": 600, color: C.text }}>{d.author}</span>
        <span style={{ "margin-left": S[2] }}>{d.author_date}</span>
        <Show when={d.committer && d.committer !== d.author}>
          <span style={{ "margin-left": S[3], color: C.text3 }}>committed by {d.committer}</span>
        </Show>
      </div>
      <Show when={d.body}>
        <pre
          style={{
            margin: `${S[2]} 0 0`,
            ...T[12],
            "white-space": "pre-wrap",
            "font-family": "inherit",
            color: C.text2,
            "max-height": "140px",
            "overflow-y": "auto",
          }}
        >
          {d.body}
        </pre>
      </Show>
    </div>
  );
}

function CommitFileList(p: { detail: any; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <div style={commitFileListStyle}>
      <SectionLabel>Files ({p.detail.files.length})</SectionLabel>
      <For each={p.detail.files}>
        {(f: GitCommitFile) => {
          const parts = splitPath(f.path);
          const open = () => p.onSelect(f.path);
          return (
            <div
              class="bs-row"
              role="button"
              tabindex={0}
              aria-selected={p.selected === f.path}
              onClick={open}
              onKeyDown={(ev) => activateOnKey(ev, open)}
              style={listRowStyle}
              title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
            >
              <span style={badgeSlot}>
                <StatusBadge code={f.status.charAt(0)} column="staged" />
              </span>
              <span style={fileNameStyle}>{parts.name}</span>
              <Show when={parts.dir}>
                <span style={fileDirStyle}>{parts.dir}</span>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/** Diff / Preview switch. One selection language: aria-selected → fill-selected.
 *  Weight is constant so flipping tabs never shifts their width. */
function TabBtn(p: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      class="bs-pill"
      aria-selected={p.active}
      onClick={p.onClick}
      style={{
        height: H.compact,
        padding: `0 ${S[2]}`,
        border: "none",
        cursor: "pointer",
        ...T[11],
        "font-weight": 500,
        "--btn-bg": "transparent",
        "--btn-fg": C.text3,
        "--btn-fg-hover": C.text2,
      }}
    >
      {p.children}
    </button>
  );
}

const commitFileListStyle = {
  width: "260px",
  "min-width": "200px",
  "border-right": `1px solid ${C.borderSub}`,
  "overflow-y": "auto",
  "flex-shrink": 0,
  padding: `0 ${S[1]} ${S[2]}`,
} as const;

const modalHeader = {
  // Right padding clears the two absolute corner buttons (maximize + close).
  padding: `${S[2]} 72px ${S[2]} ${S[4]}`,
  "border-bottom": `1px solid ${C.borderSub}`,
  display: "flex",
  "align-items": "center",
  gap: S[2],
  "flex-shrink": 0,
  color: C.text,
  ...T[12],
} as const;

const modalTitleStyle = {
  ...T[13],
  "font-weight": 600,
  "font-family": FONT.mono,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

/** Escapes the diff pane's `white-space: pre` + mono face for a block of real
 *  prose (an empty state) rendered inside it. */
const proseReset = {
  "white-space": "normal",
  "font-family": FONT.ui,
} as const;

const diffScrollArea = {
  flex: 1,
  "overflow-y": "auto",
  padding: `${S[3]} ${S[4]}`,
  "font-family": FONT.mono,
  "font-size": "12px",
  "line-height": "1.55",
  "white-space": "pre",
  "tab-size": "4",
  "min-width": 0,
} as const;

/* ----------------------------------------------------------- diff parse */

type DiffKind = "file" | "hunk" | "meta" | "add" | "del" | "ctx" | "nonl";

interface DiffLine {
  kind: DiffKind;
  /** Content with the leading +/-/space marker removed, so copying a selection
   *  yields the file's own text and not a diff. */
  text: string;
  oldNo?: number;
  newNo?: number;
}

interface ParsedDiff {
  lines: DiffLine[];
  /** Widest line number in the whole body — drives the gutter width, so a
   *  5-digit number is never truncated and a 2-digit one wastes no space. */
  digits: number;
}

const FILE_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_RE = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Pre-parse a unified diff into typed lines carrying their old/new line
 * numbers. Numbers cannot be accumulated inside a render callback — SolidJS
 * runs it once per row, in no guaranteed order — so the whole body is walked
 * up front, once, inside a memo.
 *
 * Handles: multi-file bodies (`diff --git` resets the file scope), hunk
 * headers with or without counts (`@@ -12,7 +12,9 @@` / `@@ -1 +1 @@`), the
 * `\ No newline at end of file` marker (numbered as nothing, since it is not a
 * line of either side), a deletion whose *content* starts with `--` (only the
 * header lines seen before the body count as paths), and the synthetic
 * hunk-less body `git_show_untracked` produces for a new file (numbering then
 * starts implicitly at 1).
 */
export function parseDiff(body: string): ParsedDiff {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let maxNo = 0;
  /** True once the file's header block is over and +/- mean add/delete. */
  let inBody = false;
  /** True once a line-number origin is known: a hunk header, or an implicit
   *  start at 1 for a body that carries no hunk header at all. */
  let numbered = false;

  const take = (n: number) => {
    if (n > maxNo) maxNo = n;
    return n;
  };

  const raws = body.split("\n");
  // A diff body ends with a newline, which split() turns into a trailing
  // empty element. It is not a line of the file — rendering it would put a
  // phantom numbered row at the bottom of every diff.
  if (raws.length > 0 && raws[raws.length - 1] === "") raws.pop();

  for (const raw of raws) {
    const fileHeader = FILE_HEADER_RE.exec(raw);
    if (fileHeader) {
      inBody = false;
      numbered = false;
      const [, a, b] = fileHeader;
      lines.push({ kind: "file", text: a === b ? b : `${a} → ${b}` });
      continue;
    }

    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inBody = true;
      numbered = true;
      lines.push({ kind: "hunk", text: raw });
      continue;
    }

    if (!inBody) {
      // Still inside a header block: `--- a/x` / `+++ b/x` are paths, not
      // content, and are dropped since the file header above already names the
      // file. Only `+++` ends the header — `---` comes first, and treating it
      // as the end would make the `+++` line that follows look like an
      // addition. After `+++`, content follows even in a body that carries no
      // `@@` at all (the synthetic new-file diff).
      if (raw.startsWith("--- ") || raw === "---") continue;
      if (raw.startsWith("+++ ") || raw === "+++") {
        inBody = true;
        continue;
      }
      if (raw.startsWith("@@")) {
        // A hunk header we could not parse (a combined merge diff): show it,
        // but do not pretend to know the line numbers that follow.
        inBody = true;
        numbered = false;
        lines.push({ kind: "hunk", text: raw });
        continue;
      }
      lines.push({ kind: "meta", text: raw });
      continue;
    }

    if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — a note about the previous line, not a
      // line of either side, so it consumes no number.
      lines.push({ kind: "nonl", text: raw });
      continue;
    }

    const isContent =
      raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ") || raw === "";
    if (isContent && !numbered) {
      // Hunk-less body (a new untracked file): both sides start at line 1.
      oldNo = 1;
      newNo = 1;
      numbered = true;
    }

    if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newNo: take(newNo++) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1), oldNo: take(oldNo++) });
    } else if (isContent) {
      lines.push({
        kind: "ctx",
        text: raw.slice(1),
        oldNo: take(oldNo++),
        newNo: take(newNo++),
      });
    } else {
      // Anything else between hunks (a `git show` trailer, a stray separator):
      // part of neither side.
      lines.push({ kind: "meta", text: raw });
    }
  }

  return { lines, digits: Math.max(2, String(maxNo).length) };
}

/* ---------------------------------------------------------- diff render */

function DiffBody(p: { body: string }) {
  const parsed = createMemo(() => parseDiff(p.body));
  const cols = () => {
    const w = `${parsed().digits}ch`;
    return `minmax(${w}, auto) minmax(${w}, auto) 2ch 1fr`;
  };
  // min-width: max-content makes every row as wide as the widest line, so the
  // tinted add/delete bands run the full scroll width instead of stopping at
  // the viewport edge.
  return (
    <div style={{ "min-width": "max-content" }}>
      <For each={parsed().lines}>
        {(line) => <DiffRow line={line} cols={cols()} />}
      </For>
    </div>
  );
}

function DiffRow(p: { line: DiffLine; cols: string }) {
  const l = p.line;

  if (l.kind === "file") {
    return (
      <div style={diffFileHeader}>
        <Icon name="file" size={14} />
        <span style={{ "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis" }}>
          {l.text}
        </span>
      </div>
    );
  }
  if (l.kind === "hunk") return <div style={diffHunkHeader}>{l.text}</div>;
  if (l.kind === "meta" || l.kind === "nonl") return <div style={diffMeta}>{l.text}</div>;

  const tint = l.kind === "add" ? C.greenBg : l.kind === "del" ? C.redBg : undefined;
  return (
    <div style={{ display: "grid", "grid-template-columns": p.cols, background: tint }}>
      {/* The gutter repeats the row tint, which lands on top of it — that is
          the "one step deeper" gutter, spelled with the same token. */}
      <span style={{ ...gutterCell, background: tint }}>{l.oldNo ?? ""}</span>
      <span style={{ ...gutterCell, ...gutterCellLast, background: tint }}>{l.newNo ?? ""}</span>
      <span
        style={{
          ...markerCell,
          color: l.kind === "add" ? C.green : l.kind === "del" ? C.red : "transparent",
        }}
      >
        {l.kind === "add" ? "+" : l.kind === "del" ? "-" : ""}
      </span>
      <span style={{ color: l.kind === "ctx" ? C.text2 : C.text, "padding-right": S[2] }}>
        {l.text}
      </span>
    </div>
  );
}

const gutterCell = {
  color: C.text3,
  "text-align": "right",
  "user-select": "none",
  "font-variant-numeric": "tabular-nums",
  padding: `0 ${S[1]}`,
} as const;

const gutterCellLast = {
  "border-right": `1px solid ${C.borderSub}`,
} as const;

/** The +/- marker is its own column and is never selectable, so a copied diff
 *  pastes as compilable code. */
const markerCell = {
  "user-select": "none",
  "text-align": "center",
  "font-weight": 600,
} as const;

const diffFileHeader = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  color: C.orange,
  "font-weight": 600,
  background: C.overlay,
  padding: `${S[1.5]} ${S[2]}`,
  "margin-top": S[2],
  "border-top": `1px solid ${C.border}`,
  "border-radius": R.xs,
  position: "sticky",
  top: "-12px",
  "z-index": 1,
} as const;

const diffHunkHeader = {
  color: C.cyan,
  background: C.cyanBg,
  padding: `2px ${S[2]}`,
  "margin-top": S[1.5],
  "border-radius": R.xs,
} as const;

const diffMeta = {
  color: C.text3,
  padding: `0 ${S[2]}`,
} as const;
