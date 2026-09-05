import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { api, type SystemStats } from "../ipc/api";
import { Icon, type IconName } from "../icons";
import { activeTab, activeTabId, tabs } from "../stores/tabs";
import { clearDiag, diagEntries } from "../stores/diagnostics";
import { gitState } from "../stores/git";
import { button, C, FONT, H, M, R, S, SH, T, TYPO } from "../theme";

/** Middle-truncate a path so the most distinctive parts (root + leaf) stay
 *  visible. Example: `/home/craig/projects/bookshell/src` (max 36)
 *                  → `/home/craig…/bookshell/src`. */
function shortenPath(p: string, max = 48): string {
  if (p.length <= max) return p;
  const head = Math.ceil(max / 2) - 1;
  const tail = Math.floor(max / 2) - 2;
  return `${p.slice(0, head)}…${p.slice(-tail)}`;
}

const POLL_MS = 2000;
const startedAt = Date.now();

export function StatusFooter() {
  const [stats, setStats] = createSignal<SystemStats | null>(null);
  const [uptime, setUptime] = createSignal(0);
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    let cancelled = false;
    async function poll() {
      try {
        const s = await api.systemStats();
        if (!cancelled) setStats(s);
      } catch {
        // sysinfo can briefly fail right after launch — silently retry.
      }
    }
    poll();
    const id = window.setInterval(poll, POLL_MS);
    const uid = window.setInterval(() => setUptime(Date.now() - startedAt), 1000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(id);
      window.clearInterval(uid);
    });
  });

  // Close popover when clicking anywhere outside it.
  function onDocClick(e: MouseEvent) {
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest("[data-diag-root]")) return;
    setOpen(false);
  }
  onMount(() => {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  const errCount = () => diagEntries().length;
  const hasErrors = () => errCount() > 0;

  // Context cells (left side): tab cwd + git branch for the active tab. These
  // come from existing stores so the footer doesn't pay any extra cost — we
  // just surface them. Git info only appears when the Git panel has been
  // opened for this tab (which is the same moment we have repo state).
  const cwd = () => activeTab()?.cwd ?? null;
  const gitInfo = () => {
    const id = activeTabId();
    if (!id) return null;
    return gitState.data[id] ?? null;
  };

  return (
    <div class="bs-footer" style={footerStyle}>
      {/* — left: per-tab context — */}
      <Show when={cwd()}>
        <Cell icon="map-pin" tip={`cwd: ${cwd()}`} align="start" color={C.text2} mono>
          {shortenPath(cwd()!)}
        </Cell>
      </Show>
      <Show when={gitInfo()?.branch}>
        {(b) => {
          const info = gitInfo()!;
          const ahead = info.ahead;
          const behind = info.behind;
          const trail =
            ahead || behind
              ? ` ${ahead ? `↑${ahead}` : ""}${behind ? `↓${behind}` : ""}`.trim()
              : "";
          return (
            <Cell
              icon="git-branch"
              align="start"
              mono
              tip={
                info.upstream
                  ? `Branch ${b()} · upstream ${info.upstream}${trail ? ` (${trail})` : ""}`
                  : `Branch ${b()} (no upstream)`
              }
            >
              {b()}
              {trail && <span style={{ color: C.text3, "margin-left": "4px" }}>{trail}</span>}
            </Cell>
          );
        }}
      </Show>
      <Show when={activeTab()?.passthrough}>
        <Cell icon="bot" tip="AI passthrough on" align="start" color={C.purple}>
          passthrough
        </Cell>
      </Show>

      <div style={{ flex: 1 }} />

      {/* — right: system / process metrics. Fixed value widths so a digit
          rolling over never nudges its neighbours sideways. — */}
      <Cell icon="plug" tip="Open sessions" metric width="18px">
        {tabs().filter((t) => t.status === "connected").length}
      </Cell>
      <Cell icon="activity" tip="Resident memory" metric width="58px">
        {stats() ? `${stats()!.rss_mb} MB` : "—"}
      </Cell>
      <Cell icon="cpu" tip="CPU usage (delta since last poll)" metric width="44px">
        {stats() ? `${stats()!.cpu_pct.toFixed(1)}%` : "—"}
      </Cell>
      <Cell icon="clock" tip="Uptime" metric width="56px">
        {formatUptime(uptime())}
      </Cell>
      <div
        data-diag-root
        style={{ position: "relative", display: "flex", "align-items": "center" }}
      >
        <button
          type="button"
          class="bs-btn bs-tip bs-tip-up bs-tip-end"
          aria-expanded={open()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          style={{
            ...errBtnStyle,
            // Slots, never the properties themselves: .bs-btn owns background
            // and colour, so setting them inline would kill its hover state.
            // At zero the control is deliberately not a focal point.
            "--btn-fg": hasErrors() ? C.red : C.text4,
            "--btn-bg": hasErrors() ? C.redBg : "transparent",
          }}
          data-tip={hasErrors() ? `${errCount()} log records` : "No warnings or errors"}
        >
          <span style={iconSlot}>
            <Show when={hasErrors()} fallback={<span style={okDotStyle} />}>
              <Icon name="alert-triangle" size={12} />
            </Show>
          </span>
          {errCount()}
          <Icon
            name="chevron-down"
            size={12}
            style={{
              color: C.text4,
              // The popover opens upward, so the chevron points up when closed.
              transform: open() ? "none" : "rotate(180deg)",
            }}
          />
        </button>
        <Show when={open()}>
          <DiagPopover />
        </Show>
      </div>
    </div>
  );
}

function DiagPopover() {
  return (
    <div style={popoverStyle}>
      <div style={popoverHeader}>
        <span style={TYPO.section}>Recent log · {diagEntries().length}</span>
        <button
          type="button"
          class="bs-btn"
          onClick={() => clearDiag()}
          style={button("secondary", "compact")}
          disabled={diagEntries().length === 0}
        >
          Clear
        </button>
      </div>
      <div style={popoverList}>
        <Show
          when={diagEntries().length > 0}
          fallback={<div style={emptyRowStyle}>No warnings or errors.</div>}
        >
          <For each={[...diagEntries()].reverse()}>
            {(e) => (
              <div class="bs-log-row" style={rowStyle}>
                <span
                  style={{
                    ...levelTagStyle,
                    color: e.level === "error" ? C.red : C.yellow,
                    background: e.level === "error" ? C.redBg : C.yellowBg,
                  }}
                >
                  {e.level.toUpperCase()}
                </span>
                <span style={tsStyle}>{formatTs(e.ts_ms)}</span>
                <span style={targetStyle}>{e.target}</span>
                <span style={msgStyle}>{e.message}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const footerStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: "16px",
  // Vertical padding is 0 so a 22px compact control (the log button) fits the
  // 22px bar exactly instead of bleeding over the terminal above it.
  padding: `0 ${S[3]}`,
  // The sunken floor of the window: darker than the chrome above it, and the
  // only line it draws is the faint internal one.
  background: C.bg0,
  "border-top": `1px solid ${C.borderSub}`,
  ...T[11],
  color: C.text2,
  "flex-shrink": 0,
  "user-select": "none",
  height: "22px",
};

const cellStyle: JSX.CSSProperties = {
  display: "inline-flex",
  "align-items": "center",
  gap: "4px",
  "white-space": "nowrap",
  // Digits share one advance width, so a metric never re-flows as it ticks.
  "font-variant-numeric": "tabular-nums",
};

/** Fixed 12px slot so every value starts on the same x whatever the glyph.
 *  The marker stays --text-4 even when the cell's text is coloured: it names
 *  the category, it is not the information. */
const iconSlot: JSX.CSSProperties = {
  display: "inline-flex",
  width: "12px",
  "justify-content": "center",
  "align-items": "center",
  "flex-shrink": 0,
  color: C.text4,
};

interface CellProps {
  icon: IconName;
  /** Tooltip text. The footer sits on the window edge, so it opens upward. */
  tip: string;
  /** Which edge the bubble hangs from: left-hand cells anchor to their start
   *  edge, right-hand ones to their end edge. A centred bubble would run off
   *  the window. */
  align?: "start" | "end";
  color?: string;
  /** A machine value — path, branch. Rendered in the mono face. */
  mono?: boolean;
  /** A system metric: --text-4 at rest, lifting to --text-3 while the pointer
   *  is anywhere on the footer. Colour comes from `.bs-metric` in base.css, so
   *  a metric cell must not carry `color`. */
  metric?: boolean;
  /** Fixed width for the value, so neighbours never shift as digits change. */
  width?: string;
  children: JSX.Element;
}

/** One footer metric: 12px marker in a fixed slot, then the value. */
function Cell(props: CellProps) {
  return (
    <span
      class={`bs-tip bs-tip-up bs-tip-${props.align ?? "end"}${props.metric ? " bs-metric" : ""}`}
      data-tip={props.tip}
      style={{
        ...cellStyle,
        color: props.color,
        "font-family": props.mono ? FONT.mono : undefined,
      }}
    >
      <span style={iconSlot}>
        <Icon name={props.icon} size={12} />
      </span>
      <span style={{ display: "inline-block", width: props.width }}>{props.children}</span>
    </span>
  );
}

const errBtnStyle: JSX.CSSProperties = {
  border: "1px solid transparent",
  "border-radius": R.xs,
  height: H.compact,
  padding: `0 ${S[2]}`,
  gap: S[1],
  ...T[11],
  cursor: "pointer",
  "font-weight": 600,
  "font-variant-numeric": "tabular-nums",
  display: "inline-flex",
  "align-items": "center",
};

/** The all-clear marker: a 6px green dot in place of the ⚠, so "nothing is
 *  wrong" is a quiet statement rather than a warning glyph you have to read. */
const okDotStyle: JSX.CSSProperties = {
  width: "6px",
  height: "6px",
  "border-radius": R.full,
  background: C.green,
  opacity: 0.7,
};

const popoverStyle: JSX.CSSProperties = {
  position: "absolute",
  bottom: "26px",
  right: "0",
  width: "560px",
  "max-width": "90vw",
  "max-height": "320px",
  background: C.overlay,
  border: `1px solid ${C.border}`,
  "border-radius": R.lg,
  "box-shadow": `${SH.e2}, ${SH.hlTop}`,
  display: "flex",
  "flex-direction": "column",
  "z-index": "50",
  overflow: "hidden",
  animation: `bs-pop-up ${M.d2} ${M.easePop}`,
};

const popoverHeader: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  gap: S[2],
  padding: `${S[1.5]} ${S[3]}`,
  "border-bottom": `1px solid ${C.borderSub}`,
};

const popoverList: JSX.CSSProperties = {
  flex: 1,
  "overflow-y": "auto",
  padding: `${S[1]} 0`,
};

/** Zebra banding (`.bs-log-row` in base.css) carries the row separation, so no
 *  row draws a hairline of its own. */
const rowStyle: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "48px 60px 100px 1fr",
  gap: S[2],
  padding: `${S[0.5]} ${S[3]}`,
  ...T[11],
  "font-family": FONT.mono,
  "align-items": "center",
};

const levelTagStyle: JSX.CSSProperties = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  height: "14px",
  "border-radius": R.xs,
  "font-weight": 600,
  ...T[10],
  "letter-spacing": "0.06em",
};

const tsStyle: JSX.CSSProperties = {
  color: C.text3,
};

const targetStyle: JSX.CSSProperties = {
  color: C.text2,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const msgStyle: JSX.CSSProperties = {
  color: C.text,
  "word-break": "break-word",
};

const emptyRowStyle: JSX.CSSProperties = {
  padding: S[5],
  "text-align": "center",
  color: C.text3,
  ...T[12],
};
