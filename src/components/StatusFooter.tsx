import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { api, type SystemStats } from "../ipc/api";
import { Icon, type IconName } from "../icons";
import { activeTab, activeTabId, tabs } from "../stores/tabs";
import { clearDiag, diagEntries } from "../stores/diagnostics";
import { gitState } from "../stores/git";
import { C, FONT, H, R, S, SH, T } from "../theme";

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
    <div style={footerStyle}>
      {/* — left: per-tab context — */}
      <Show when={cwd()}>
        <Cell icon="map-pin" tip={`cwd: ${cwd()}`} align="start" color={C.text}>
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

      {/* — right: system / process metrics — */}
      <Cell icon="plug" tip="Open sessions">
        {tabs().filter((t) => t.status === "connected").length}
      </Cell>
      <Cell icon="activity" tip="Resident memory">
        {stats() ? `${stats()!.rss_mb} MB` : "—"}
      </Cell>
      <Cell icon="cpu" tip="CPU usage (delta since last poll)">
        {stats() ? `${stats()!.cpu_pct.toFixed(1)}%` : "—"}
      </Cell>
      <Cell icon="clock" tip="Uptime">
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
            "--btn-fg": hasErrors() ? C.red : C.text2,
            "--btn-bg": hasErrors() && open() ? C.redBg : "transparent",
          }}
          data-tip={hasErrors() ? `${errCount()} log records` : "No recent errors"}
        >
          <span style={iconSlot}>
            <Icon name="alert-triangle" size={12} />
          </span>
          {errCount()}
          <Icon
            name="chevron-down"
            size={12}
            style={{
              opacity: 0.7,
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
        <span style={{ "font-size": "11px", color: C.text2, "letter-spacing": "0.04em" }}>
          RECENT LOG · {diagEntries().length}
        </span>
        <button
          type="button"
          onClick={() => clearDiag()}
          style={clearBtnStyle}
          disabled={diagEntries().length === 0}
        >
          Clear
        </button>
      </div>
      <div style={popoverList}>
        <Show
          when={diagEntries().length > 0}
          fallback={<div style={emptyRowStyle}>No log records yet.</div>}
        >
          <For each={[...diagEntries()].reverse()}>
            {(e) => (
              <div style={rowStyle}>
                <span style={{ ...levelTagStyle, color: e.level === "error" ? C.red : C.yellow }}>
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

const footerStyle = {
  display: "flex",
  "align-items": "center",
  gap: "16px",
  // Vertical padding is 0 so a 22px compact control (the log button) fits the
  // 22px bar exactly instead of bleeding over the terminal above it.
  padding: `0 ${S[3]}`,
  background: C.bg2,
  "border-top": `1px solid ${C.border}`,
  "font-size": "11px",
  color: C.text2,
  "flex-shrink": 0,
  "user-select": "none",
  height: "22px",
} as const;

const cellStyle = {
  display: "inline-flex",
  "align-items": "center",
  gap: "4px",
  "white-space": "nowrap",
} as const;

/** Fixed 12px slot so every value starts on the same x whatever the glyph.
 *  The marker stays --text-4 even when the cell's text is coloured: it names
 *  the category, it is not the information. */
const iconSlot = {
  display: "inline-flex",
  width: "12px",
  "justify-content": "center",
  "flex-shrink": 0,
  color: C.text4,
} as const;

interface CellProps {
  icon: IconName;
  /** Tooltip text. The footer sits on the window edge, so it opens upward. */
  tip: string;
  /** Which edge the bubble hangs from: left-hand cells anchor to their start
   *  edge, right-hand ones to their end edge. A centred bubble would run off
   *  the window. */
  align?: "start" | "end";
  color?: string;
  children: JSX.Element;
}

/** One footer metric: 12px marker in a fixed slot, then the value. */
function Cell(props: CellProps) {
  return (
    <span
      class={`bs-tip bs-tip-up bs-tip-${props.align ?? "end"}`}
      data-tip={props.tip}
      style={{ ...cellStyle, color: props.color }}
    >
      <span style={iconSlot}>
        <Icon name={props.icon} size={12} />
      </span>
      {props.children}
    </span>
  );
}

const errBtnStyle = {
  border: `1px solid transparent`,
  "border-radius": R.xs,
  height: H.compact,
  padding: `0 ${S[2]}`,
  gap: S[1],
  ...T[11],
  cursor: "pointer",
  "font-weight": 600,
  display: "inline-flex",
  "align-items": "center",
} as const;

const popoverStyle = {
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
} as const;

const popoverHeader = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 12px",
  "border-bottom": `1px solid ${C.border}`,
} as const;

const clearBtnStyle = {
  background: C.bg3,
  color: C.text,
  border: `1px solid ${C.border}`,
  "border-radius": R.sm,
  padding: "2px 9px",
  "font-size": "11px",
  cursor: "pointer",
} as const;

const popoverList = {
  flex: 1,
  "overflow-y": "auto",
  padding: "4px 0",
} as const;

const rowStyle = {
  display: "grid",
  "grid-template-columns": "44px 60px 100px 1fr",
  gap: "8px",
  padding: "4px 12px",
  "font-size": "11px",
  "font-family": FONT.mono,
  "border-bottom": `1px solid ${C.borderSub}`,
  "align-items": "baseline",
} as const;

const levelTagStyle = {
  "font-weight": 700,
  "font-size": "10px",
} as const;

const tsStyle = {
  color: C.text3,
} as const;

const targetStyle = {
  color: C.text2,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const msgStyle = {
  color: C.text,
  "word-break": "break-word",
} as const;

const emptyRowStyle = {
  padding: "20px",
  "text-align": "center",
  color: C.text3,
  "font-size": "12px",
} as const;
