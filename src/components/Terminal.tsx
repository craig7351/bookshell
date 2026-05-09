import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { C, xtermTheme } from "../theme";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../ipc/api";
import {
  bumpFit,
  onTabBufferDump,
  onTabClose,
  onTabData,
  type Tab,
} from "../stores/tabs";
import { closeSearch, isSearchOpenFor } from "../stores/search";
import { general } from "../stores/general";
import { connections } from "../stores/connections";
import { connectTab, reconnectTabFromProfile, restoreCwd } from "../stores/tabs";

interface Props {
  tab: Tab;
  active: boolean;
}

interface MatchInfo {
  resultIndex: number;
  resultCount: number;
}

export function TerminalView(props: Props) {
  let host!: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let search: SearchAddon | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const [query, setQuery] = createSignal("");
  const [pwPrompt, setPwPrompt] = createSignal("");
  const [reconnecting, setReconnecting] = createSignal(false);
  const [dragOver, setDragOver] = createSignal<"local" | "blocked" | null>(null);
  // Reactive flag flipped at the end of onMount. Effects that need a live
  // `term` instance must depend on this — SolidJS runs createEffect bodies
  // before onMount callbacks, so reading `term` directly in an effect's
  // first pass would see undefined.
  const [termReady, setTermReady] = createSignal(false);

  const profile = () =>
    connections().find((c) => c.id === props.tab.connectionId) ?? null;
  const showReconnectPanel = () =>
    props.tab.status === "disconnected" || props.tab.status === "error";

  async function doReconnect() {
    setReconnecting(true);
    try {
      const ok = await reconnectTabFromProfile(props.tab.id);
      if (!ok) {
        // No saved password — fall through to manual prompt below.
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReconnecting(false);
    }
  }

  async function doManualReconnect() {
    const p = profile();
    if (!p) return;
    setReconnecting(true);
    try {
      await connectTab(props.tab.id, {
        host: p.host,
        port: p.port,
        user: p.user,
        password: pwPrompt(),
        cols: 80,
        rows: 24,
      });
      setPwPrompt("");
      restoreCwd(props.tab.id).catch(() => {});
    } catch (e) {
      console.error(e);
    } finally {
      setReconnecting(false);
    }
  }
  const [opts, setOpts] = createSignal<ISearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [matches, setMatches] = createSignal<MatchInfo>({ resultIndex: -1, resultCount: 0 });

  function buildOpts(): ISearchOptions {
    return {
      ...opts(),
      decorations: {
        matchBackground: "#515b78",
        matchOverviewRuler: "#f9e2af",
        activeMatchBackground: "#a06c2c",
        activeMatchColorOverviewRuler: "#fab387",
      },
    };
  }

  function runSearch(direction: "next" | "prev" = "next") {
    const q = query();
    if (!search) return;
    if (!q) {
      search.clearDecorations();
      setMatches({ resultIndex: -1, resultCount: 0 });
      return;
    }
    if (direction === "next") search.findNext(q, buildOpts());
    else search.findPrevious(q, buildOpts());
  }
  const findNext = () => runSearch("next");
  const findPrev = () => runSearch("prev");

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: general().font_size,
      scrollback: general().scrollback,
      allowProposedApi: true,
      theme: xtermTheme,
    });
    fit = new FitAddon();
    search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    // Hand URL clicks off to the OS default browser via Tauri command — opening
    // them inside this WebView would navigate away from the app.
    term.loadAddon(
      new WebLinksAddon((_ev, uri) => {
        api.urlOpen(uri).catch((e) => console.warn("url_open failed", e));
      }),
    );
    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL addon failed", e);
    }
    term.open(host);
    fit.fit();

    // WebKitGTK + IME (fcitx5 chewing/pinyin/ibus) workaround: xterm's
    // composition handling on Linux WebKit emits the committed text twice
    // (once via compositionend, once via the trailing input event). Take over
    // IME entirely: write the composed text ourselves on compositionend and
    // swallow the bubble-phase listeners xterm registered on the textarea.
    {
      const ta = term.textarea as HTMLTextAreaElement | null;
      if (ta) {
        const ac = new AbortController();
        let endedAt = 0;
        ta.addEventListener("compositionend", (e) => {
          const ce = e as CompositionEvent;
          const text = ce.data && ce.data.length > 0 ? ce.data : ta.value;
          if (text) {
            const sid = props.tab.sessionId;
            if (sid) api.sshWrite(sid, text).catch(console.error);
          }
          ta.value = "";
          endedAt = performance.now();
          ce.stopImmediatePropagation();
        }, { capture: true, signal: ac.signal });
        ta.addEventListener("input", (ev) => {
          if (performance.now() - endedAt < 250) {
            ev.stopImmediatePropagation();
            ta.value = "";
          }
        }, { capture: true, signal: ac.signal });
        onCleanup(() => ac.abort());
      }
    }

    search.onDidChangeResults((e) =>
      setMatches({ resultIndex: e.resultIndex, resultCount: e.resultCount }),
    );

    term.onData((data) => {
      const sid = props.tab.sessionId;
      if (sid) api.sshWrite(sid, data).catch(console.error);
    });

    term.onResize(({ cols, rows }) => {
      const sid = props.tab.sessionId;
      if (sid) api.sshResize(sid, cols, rows).catch(console.error);
    });

    onTabData(props.tab.id, (bytes) => term?.write(bytes));
    onTabClose(props.tab.id, (reason) => {
      term?.write(`\r\n\x1b[31m[session closed: ${reason}]\x1b[0m\r\n`);
    });

    // Walk the active buffer (scrollback + viewport) and return a plain-text
    // dump. xterm has already resolved every cursor move / line clear /
    // spinner redraw, so this is what the user actually saw on screen.
    onTabBufferDump(props.tab.id, () => {
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y);
        lines.push(line ? line.translateToString(true) : "");
      }
      // Trim leading/trailing blanks; collapse 3+ consecutive blanks to 2.
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
    });

    // Auto-copy on selection: when the user finishes a mouse drag and there is
    // a non-empty selection, push it to the OS clipboard.
    const onMouseUp = () => {
      if (!term?.hasSelection()) return;
      const sel = term.getSelection();
      if (!sel) return;
      navigator.clipboard.writeText(sel).catch((e) =>
        console.warn("clipboard write failed", e),
      );
    };
    host.addEventListener("mouseup", onMouseUp);
    onCleanup(() => host.removeEventListener("mouseup", onMouseUp));

    // Middle-click: just suppress the browser's auto-scroll affordance.
    // WebKitGTK already does X11-style primary-selection paste into the
    // focused textarea, which xterm forwards via onData — doing our own
    // clipboard.readText + sshWrite here would paste twice.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
    };
    host.addEventListener("mousedown", onMouseDown);
    onCleanup(() => host.removeEventListener("mousedown", onMouseDown));

    const ro = new ResizeObserver(() => {
      if (props.active) fit?.fit();
    });
    ro.observe(host);
    onCleanup(() => ro.disconnect());

    // OS-level drag-drop. Tauri intercepts file drops before they reach the
    // webview, so HTML5 ondrop never fires — we have to subscribe to the
    // Tauri event stream instead. Each TerminalView registers its own
    // listener and gates on `props.active` so only the visible tab reacts.
    let dragUnlisten: UnlistenFn | undefined;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (!props.active) return;
        const conn = connections().find((c) => c.id === props.tab.connectionId);
        const isLocal = conn?.kind === "local";
        const t = ev.payload.type;
        if (t === "enter" || t === "over") {
          setDragOver(isLocal ? "local" : "blocked");
        } else if (t === "leave") {
          setDragOver(null);
        } else if (t === "drop") {
          setDragOver(null);
          if (!isLocal) return;
          const paths = ev.payload.paths ?? [];
          if (paths.length === 0) return;
          const text = paths.map(quoteShellPath).join(" ") + " ";
          term?.paste(text);
          term?.focus();
        }
      })
      .then((u) => {
        dragUnlisten = u;
      })
      .catch((e) => console.warn("onDragDropEvent failed", e));
    onCleanup(() => dragUnlisten?.());

    setTermReady(true);
  });

  // Refit when activated
  createEffect(() => {
    void props.tab.fitTick;
    if (props.active) {
      queueMicrotask(() => {
        fit?.fit();
        if (!isSearchOpenFor(props.tab.id)) term?.focus();
      });
    }
  });

  // Sync PTY size to xterm once a session is attached. The initial connect
  // call uses placeholder cols/rows (80x24), so the remote shell starts off
  // smaller than the visible viewport — leaving dead rows at the bottom that
  // PTY never writes to. xterm.onResize only fires on size *changes*, so it
  // can't catch up after the fact. Push the current dims explicitly here.
  // Depend on termReady so the effect re-runs once onMount has set up `term`.
  createEffect(() => {
    const sid = props.tab.sessionId;
    if (!sid || !termReady() || !term) return;
    queueMicrotask(() => {
      fit?.fit();
      if (term) api.sshResize(sid, term.cols, term.rows).catch(console.error);
    });
  });

  // Live-update term options when general settings change
  createEffect(() => {
    if (!term) return;
    term.options.scrollback = general().scrollback;
    term.options.fontSize = general().font_size;
    queueMicrotask(() => fit?.fit());
  });

  // When search opens for this tab, focus the input
  createEffect(() => {
    if (isSearchOpenFor(props.tab.id)) {
      queueMicrotask(() => searchInputRef?.focus());
    }
  });

  onCleanup(() => term?.dispose());

  return (
    <div
      style={{
        position: "absolute",
        inset: "0",
        visibility: props.active ? "visible" : "hidden",
        "pointer-events": props.active ? "auto" : "none",
      }}
    >
      <div
        ref={host}
        style={{ position: "absolute", inset: "0", padding: "4px" }}
        onclick={() => {
          if (props.active && !isSearchOpenFor(props.tab.id)) {
            term?.focus();
            bumpFit(props.tab.id);
          }
        }}
      />
      <Show when={showReconnectPanel()}>
        <div style={reconnectOverlay}>
          <div style={reconnectCard}>
            <div style={{ "font-size": "14px", "margin-bottom": "8px" }}>
              <span style={{ color: "#f9e2af" }}>●</span>{" "}
              {props.tab.status === "error" ? "Connection error" : "Disconnected"}
            </div>
            <Show when={props.tab.errorMessage}>
              <div style={{ "font-size": "12px", opacity: 0.7, "margin-bottom": "12px", "font-family": "monospace" }}>
                {props.tab.errorMessage}
              </div>
            </Show>
            <Show
              when={profile()}
              fallback={<div style={{ opacity: 0.6, "font-size": "13px" }}>Connection profile no longer exists.</div>}
            >
              {(p) => (
                <>
                  <div style={{ "margin-bottom": "12px", opacity: 0.8 }}>
                    {p().kind === "local"
                      ? `📟 local · ${p().shell ?? ""}`
                      : `${p().user}@${p().host}:${p().port}`}
                  </div>
                  <Show
                    when={p().kind === "local" || (p().password && p().password!.length > 0)}
                    fallback={
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="password"
                          placeholder="Password"
                          value={pwPrompt()}
                          autofocus
                          onInput={(e) => setPwPrompt(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") doManualReconnect();
                          }}
                          style={pwInput}
                          disabled={reconnecting()}
                        />
                        <button
                          onClick={doManualReconnect}
                          disabled={reconnecting() || !pwPrompt()}
                          style={primaryBtn}
                        >
                          {reconnecting() ? "Connecting…" : "Connect"}
                        </button>
                      </div>
                    }
                  >
                    <button
                      onClick={doReconnect}
                      disabled={reconnecting()}
                      style={primaryBtn}
                    >
                      {reconnecting() ? "Reconnecting…" : "↻ Reconnect"}
                    </button>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
      <Show when={dragOver()}>
        {(mode) => (
          <div style={dropOverlayStyle}>
            <div
              style={{
                ...dropCardStyle,
                color: mode() === "local" ? C.accent : C.text3,
                "border-color": mode() === "local" ? C.accent : C.border,
              }}
            >
              {mode() === "local"
                ? "📎 Drop to paste path"
                : "Drag-drop only supported on local connections"}
            </div>
          </div>
        )}
      </Show>
      <Show when={isSearchOpenFor(props.tab.id)}>
        <div style={searchBarStyle} onClick={(e) => e.stopPropagation()}>
          <input
            ref={searchInputRef}
            value={query()}
            placeholder="Find"
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              runSearch("next");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
                term?.focus();
              }
            }}
            style={searchInputStyle}
          />
          <button
            onClick={() => {
              setOpts({ ...opts(), caseSensitive: !opts().caseSensitive });
              runSearch("next");
            }}
            style={toggleBtn(opts().caseSensitive)}
            title="Case sensitive"
          >
            Aa
          </button>
          <button
            onClick={() => {
              setOpts({ ...opts(), wholeWord: !opts().wholeWord });
              runSearch("next");
            }}
            style={toggleBtn(opts().wholeWord)}
            title="Whole word"
          >
            ab
          </button>
          <button
            onClick={() => {
              setOpts({ ...opts(), regex: !opts().regex });
              runSearch("next");
            }}
            style={toggleBtn(opts().regex)}
            title="Regex"
          >
            .*
          </button>
          <span style={{ "font-size": "12px", opacity: 0.7, "min-width": "60px", "text-align": "center" }}>
            {matches().resultCount > 0
              ? `${matches().resultIndex + 1} / ${matches().resultCount}`
              : query()
                ? "No match"
                : ""}
          </span>
          <button onClick={findPrev} style={navBtn} title="Previous (Shift+Enter)">▲</button>
          <button onClick={findNext} style={navBtn} title="Next (Enter)">▼</button>
          <button
            onClick={() => {
              closeSearch();
              term?.focus();
            }}
            style={navBtn}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      </Show>
    </div>
  );
}

const searchBarStyle = {
  position: "absolute",
  top: "10px",
  right: "14px",
  display: "flex",
  "align-items": "center",
  gap: "4px",
  background: "rgba(28,28,30,0.92)",
  "backdrop-filter": "blur(16px) saturate(160%)",
  border: `1px solid ${C.border}`,
  "border-radius": "10px",
  padding: "5px 8px",
  "box-shadow": "0 8px 24px rgba(0,0,0,0.5)",
  "z-index": "10",
} as const;

const searchInputStyle = {
  background: C.bg3,
  color: C.text,
  border: `1px solid ${C.border}`,
  padding: "4px 8px",
  "border-radius": "6px",
  "font-size": "13px",
  outline: "none",
  width: "200px",
} as const;

const toggleBtn = (active: boolean | undefined) =>
  ({
    background: active ? C.accentBg : "transparent",
    color: active ? C.accent : C.text2,
    border: `1px solid ${active ? C.accentBdr : C.border}`,
    "border-radius": "5px",
    padding: "2px 6px",
    "font-size": "11px",
    cursor: "pointer",
    "font-family": "monospace",
    "min-width": "26px",
  }) as const;

const navBtn = {
  background: "transparent",
  color: C.text2,
  border: `1px solid ${C.border}`,
  "border-radius": "5px",
  padding: "2px 8px",
  "font-size": "12px",
  cursor: "pointer",
} as const;

const reconnectOverlay = {
  position: "absolute",
  inset: "0",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  background: "rgba(0,0,0,0.6)",
  "backdrop-filter": "blur(8px)",
  "z-index": "5",
} as const;

const reconnectCard = {
  background: "rgba(30,30,32,0.97)",
  "backdrop-filter": "blur(40px) saturate(180%)",
  border: `1px solid ${C.border}`,
  "border-radius": "14px",
  "box-shadow": "0 24px 64px rgba(0,0,0,0.75)",
  padding: "24px 28px",
  "min-width": "320px",
  "max-width": "480px",
  color: C.text,
} as const;

const pwInput = {
  flex: 1,
  background: C.bg3,
  color: C.text,
  border: `1px solid ${C.border}`,
  padding: "7px 10px",
  "border-radius": "8px",
  "font-size": "13px",
  outline: "none",
} as const;

const dropOverlayStyle = {
  position: "absolute",
  inset: "0",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  background: "rgba(0,0,0,0.55)",
  "backdrop-filter": "blur(4px)",
  "z-index": "11",
  "pointer-events": "none",
} as const;

const dropCardStyle = {
  padding: "20px 36px",
  border: "2px dashed",
  "border-radius": "12px",
  background: "rgba(30,30,32,0.85)",
  "font-size": "14px",
  "font-weight": 500,
} as const;

/** Wrap a filesystem path so a shell will treat it as one argument. Plain
 *  double-quotes are safe for typical paths on Windows (PowerShell) and
 *  POSIX (bash/zsh) — backslashes inside `"..."` are literal in both. Paths
 *  containing a literal `"` aren't perfectly portable; rare enough to skip. */
function quoteShellPath(p: string): string {
  if (/[\s"'`$|&;<>(){}[\]\\]/.test(p)) {
    return `"${p.replace(/"/g, '\\"')}"`;
  }
  return p;
}

const primaryBtn = {
  background: C.accent,
  color: "#fff",
  border: "none",
  padding: "7px 18px",
  "border-radius": "8px",
  "font-size": "13px",
  cursor: "pointer",
  "font-weight": 600,
} as const;
