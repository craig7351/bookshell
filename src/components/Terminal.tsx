import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { button, C, FONT, H, M, R, RAW, S, SH, T, xtermTheme } from "../theme";
import { Icon, type IconName } from "../icons";
import { CloseGlyph } from "./CloseX";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../ipc/api";
import {
  bumpFit,
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

/** One transient line of feedback in the bottom-centred HUD pill. */
interface HudMsg {
  text: string;
  icon: IconName;
  /** Set by the hold timer: the pill fades out instead of vanishing. */
  leaving?: boolean;
}

/** HUD lifetime: fully visible, then a fade. 1600 + 200 = the 1.8s the plan
 *  asks for, expressed as two timers so the exit is a real transition. */
const HUD_HOLD_MS = 1600;
const HUD_FADE_MS = 200;

/** Activity rail sampling. The PTY callback only stamps a plain variable; this
 *  interval is the ONLY thing allowed to touch a signal, at 4Hz (xterm rule 6),
 *  and only when the state actually flips. */
const RAIL_TICK_MS = 250;
const RAIL_IDLE_MS = 3000;

export function TerminalView(props: Props) {
  let host!: HTMLDivElement;
  let term: Terminal | undefined;
  /** Set by onCleanup so deferred work (the WebGL retry timer) can bail out
   *  instead of touching a disposed terminal. */
  let termDisposed = false;
  // WebGL renderer, ACTIVE TAB ONLY. Chromium caps a page at 16 live WebGL
  // contexts and evicts the oldest past that, so one context per open tab
  // (20+ tabs is normal here) guarantees a churn of context-loss events at
  // start-up and on every new tab — which is what the "context lost again"
  // diagnostics were. Hidden tabs are not painted, so they run on the DOM
  // renderer and get a fresh context the moment they come to the front.
  let webgl: WebglAddon | undefined;
  let webglRetried = false;
  const unmountWebgl = () => {
    webgl?.dispose();
    webgl = undefined;
  };
  const mountWebgl = () => {
    if (!term || termDisposed || webgl) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        // GPU reset / driver hiccup on the visible terminal. Drop to the DOM
        // renderer, give the driver a second, and try once more; a second
        // loss means the GPU path is unusable for this session.
        addon.dispose();
        if (webgl === addon) webgl = undefined;
        if (webglRetried) {
          console.warn("WebGL context lost twice — terminal stays on the DOM renderer");
          return;
        }
        webglRetried = true;
        setTimeout(() => { if (props.active) mountWebgl(); }, 1000);
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch (e) {
      console.warn("WebGL addon failed", e);
    }
  };
  let fit: FitAddon | undefined;
  let search: SearchAddon | undefined;
  let highlightAddons: SearchAddon[] = [];
  let searchInputRef: HTMLInputElement | undefined;

  const [query, setQuery] = createSignal("");
  const [pwPrompt, setPwPrompt] = createSignal("");
  const [reconnecting, setReconnecting] = createSignal(false);
  const [dragOver, setDragOver] = createSignal<"local" | "blocked" | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [showHighlight, setShowHighlight] = createSignal(false);
  const [hud, setHud] = createSignal<HudMsg | null>(null);
  /** True while the PTY has written something in the last RAIL_IDLE_MS. */
  const [busy, setBusy] = createSignal(false);

  /** Timestamp of the last PTY chunk. A PLAIN VARIABLE on purpose: it is
   *  written on every write() and a signal there would re-render at the
   *  terminal's output rate. The 250ms interval below samples it. */
  let lastOutputAt = Number.NEGATIVE_INFINITY;

  let hudHold: number | undefined;
  let hudDrop: number | undefined;
  /** Non-blocking feedback: upload progress, a pasted path, a copy, a
   *  passthrough flip. Anything that used to darken the whole canvas. */
  function showHud(text: string, icon: IconName) {
    clearTimeout(hudHold);
    clearTimeout(hudDrop);
    setHud({ text, icon });
    hudHold = window.setTimeout(
      () => setHud((h) => (h ? { ...h, leaving: true } : null)),
      HUD_HOLD_MS,
    );
    hudDrop = window.setTimeout(() => setHud(null), HUD_HOLD_MS + HUD_FADE_MS);
  }
  onCleanup(() => {
    clearTimeout(hudHold);
    clearTimeout(hudDrop);
  });

  /** An upload is a state, not an event, so it holds the pill open for as long
   *  as it runs; everything else is one of the timed messages above. */
  const hudMsg = (): HudMsg | null =>
    uploading() ? { text: "Uploading image…", icon: "upload" } : hud();

  interface HighlightSlot { color: string; keyword: string; }
  const DEFAULT_HIGHLIGHT_COLORS = RAW.highlight;
  const [slots, setSlots] = createStore<HighlightSlot[]>(
    DEFAULT_HIGHLIGHT_COLORS.map((color) => ({ color, keyword: "" })),
  );
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
  /** A typed query with nothing to show for it: the capsule border and the
   *  counter both go red, and nothing else in the bar changes. */
  const noMatch = () => query().length > 0 && matches().resultCount === 0;
  const countLabel = () =>
    matches().resultCount > 0
      ? `${matches().resultIndex + 1} / ${matches().resultCount}`
      : query()
        ? "No match"
        : "";

  function buildOpts(): ISearchOptions {
    return {
      ...opts(),
      decorations: {
        matchBackground: "rgba(255,214,10,0.30)",
        matchOverviewRuler: RAW.yellow,
        activeMatchBackground: "rgba(255,159,10,0.85)",
        activeMatchColorOverviewRuler: RAW.orange,
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

  function applyHighlights() {
    slots.forEach((slot, i) => {
      const addon = highlightAddons[i];
      if (!addon) return;
      addon.clearDecorations();
      const kw = slot.keyword.trim();
      if (!kw) return;
      addon.findNext(kw, {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        decorations: {
          matchBackground: slot.color + "70",
          activeMatchBackground: slot.color + "70",
          matchOverviewRuler: slot.color,
          activeMatchColorOverviewRuler: slot.color,
        },
      });
    });
  }

  function clearHighlights() {
    highlightAddons.forEach((a) => a.clearDecorations());
    DEFAULT_HIGHLIGHT_COLORS.forEach((color, i) => setSlots(i, { color, keyword: "" }));
  }

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      fontFamily: FONT.term,
      fontSize: general().font_size,
      // 1.2 gives the grid the same optical rhythm as the rest of the chrome
      // without breaking box-drawing TUIs (htop, Claude Code) the way a taller
      // leading does. Changing it re-measures the cell, hence it lands in the
      // same commit as the host padding and the ruler width.
      lineHeight: 1.2,
      fontWeightBold: 600,
      // Reserves a 10px strip on the right edge for search / highlight marks.
      // It costs cols, so it is measured together with the padding above.
      overviewRulerWidth: 10,
      scrollback: general().scrollback,
      allowProposedApi: true,
      theme: xtermTheme,
    });
    fit = new FitAddon();
    search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    // Align xterm's character-width tables with the wcwidth modern CLIs (e.g.
    // Claude Code) use. Without this, xterm defaults to Unicode 6 widths and
    // disagrees about CJK/emoji cell counts, so TUI redraws leave stray glyphs
    // behind (garbled overlapping text).
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    highlightAddons = DEFAULT_HIGHLIGHT_COLORS.map(() => {
      const a = new SearchAddon();
      term!.loadAddon(a);
      return a;
    });
    // Hand URL clicks off to the OS default browser via Tauri command — opening
    // them inside this WebView would navigate away from the app.
    term.loadAddon(
      new WebLinksAddon((_ev, uri) => {
        api.urlOpen(uri).catch((e) => console.warn("url_open failed", e));
      }),
    );
    // The WebGL addon is mounted by the active-tab effect below, after open.
    term.open(host);
    fit.fit();

    // Ctrl+F must reach App.tsx's search handler. xterm would otherwise swallow
    // it in the capture phase and forward ^F to the shell. Returning false here
    // tells xterm to skip the event entirely and let it bubble normally.
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") return false;
      return true;
    });

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

    // Clipboard image paste. Two trigger paths:
    //
    // 1. Ctrl+V / Shift+Insert (paste event on textarea): skip if text is
    //    present; otherwise call the native backend which reads the image
    //    directly from the OS clipboard. The clipboardData.items check is
    //    intentionally omitted — WebKitGTK never surfaces image MIME types
    //    in ClipboardEvent.items, so we always let the Rust side decide.
    //
    // 2. Ctrl+Shift+V: explicit shortcut for the same path, useful when
    //    WebKitGTK doesn't fire a paste event for image-only clipboard content.
    //
    // In both cases: local tabs get the local /tmp path; SSH tabs have the
    // PNG uploaded to the remote /tmp first and get the remote path.
    // Returns true if an image was found and pasted, false if clipboard had no image.
    const pasteImage = async (): Promise<boolean> => {
      if (!props.active) return false;
      const conn = connections().find((c) => c.id === props.tab.connectionId);
      if (!conn) return false;
      const sid = props.tab.sessionId;
      const localPath = await api.clipboardSaveImage();
      if (!localPath) return false;
      if (conn.kind === "local") {
        term?.paste(quoteShellPath(localPath) + " ");
        term?.focus();
        showHud("Path pasted", "check");
        return true;
      }
      if (!sid) return false;
      setUploading(true);
      try {
        const remotePath = await api.sshUploadFile(sid, localPath);
        term?.paste(quoteShellPath(remotePath) + " ");
        term?.focus();
        showHud("Path pasted", "check");
        return true;
      } finally {
        setUploading(false);
      }
    };

    {
      const ta = term.textarea as HTMLTextAreaElement | null;
      if (ta) {
        const ac = new AbortController();
        ta.addEventListener(
          "paste",
          (e) => {
            const ev = e as ClipboardEvent;
            if (!props.active) return;
            const text = ev.clipboardData?.getData("text/plain") ?? "";
            if (text) return; // has text → let xterm handle normally
            ev.preventDefault();
            ev.stopImmediatePropagation();
            pasteImage().catch((err) =>
              console.warn("clipboard image paste failed", err),
            );
          },
          { capture: true, signal: ac.signal },
        );
        onCleanup(() => ac.abort());
      }
    }

    // Ctrl+Shift+V: paste image if clipboard has one, otherwise paste text.
    const onCtrlShiftV = async (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.key !== "V") return;
      if (!props.active) return;
      e.preventDefault();
      try {
        const didImage = await pasteImage();
        if (!didImage) {
          const text = await api.clipboardReadText();
          if (text) {
            term?.paste(text);
            term?.focus();
          }
        }
      } catch (err) {
        console.warn("clipboard paste failed", err);
      }
    };
    window.addEventListener("keydown", onCtrlShiftV);
    onCleanup(() => window.removeEventListener("keydown", onCtrlShiftV));

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

    onTabData(props.tab.id, (bytes) => {
      // Runs once per PTY chunk — a signal here would repaint at the output
      // rate. Stamp a plain variable; the 4Hz sampler below owns the signal.
      lastOutputAt = performance.now();
      term?.write(bytes);
    });
    // Activity rail sampler: flips `busy` only when the state genuinely
    // changes, so a screenful of `yes` costs at most 4 signal writes a second
    // and a quiet terminal costs none.
    const railTimer = window.setInterval(() => {
      const on = performance.now() - lastOutputAt < RAIL_IDLE_MS;
      if (on !== busy()) setBusy(on);
    }, RAIL_TICK_MS);
    onCleanup(() => clearInterval(railTimer));
    onTabClose(props.tab.id, (reason) => {
      term?.write(`\r\n\x1b[31m[session closed: ${reason}]\x1b[0m\r\n`);
    });

    // Auto-copy on selection: fires when the drag ends inside the terminal.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return; // middle/right-click must not overwrite clipboard
      if (!term?.hasSelection()) return;
      const sel = term.getSelection();
      if (!sel) return;
      api
        .clipboardWriteText(sel)
        .then(() => showHud("Copied", "check"))
        .catch((e) => console.warn("clipboard write failed", e));
    };
    host.addEventListener("mouseup", onMouseUp);
    onCleanup(() => host.removeEventListener("mouseup", onMouseUp));

    // Ctrl+Shift+C: explicit copy shortcut. Covers the case where the drag
    // ends outside the terminal (tab bar, etc.) and mouseup didn't fire on
    // host. Uses native arboard to avoid WebKitGTK clipboard API hangs.
    const onCopyKey = (e: KeyboardEvent) => {
      if (!props.active || !e.ctrlKey || !e.shiftKey || e.altKey || e.key !== "C") return;
      if (!term?.hasSelection()) return;
      e.preventDefault();
      const sel = term.getSelection();
      if (!sel) return;
      api
        .clipboardWriteText(sel)
        .then(() => showHud("Copied", "check"))
        .catch((e) => console.warn("clipboard write failed", e));
    };
    window.addEventListener("keydown", onCopyKey);
    onCleanup(() => window.removeEventListener("keydown", onCopyKey));

    // Middle-click paste — uniform across platforms: read the system clipboard
    // (the select-to-copy mouseup handler keeps it populated) and paste it.
    // On Linux we make xterm's helper textarea readOnly for the duration so
    // WebKitGTK's native middle-click PRIMARY-selection paste can't ALSO fire
    // (double-paste). term.paste() writes straight to onData, bypassing the
    // textarea, so our manual paste still lands. Harmless no-op on Win/macOS.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ta = term?.textarea;
      if (ta) ta.readOnly = true;
      api
        .clipboardReadText()
        .then((text) => {
          if (text) term?.paste(text);
        })
        .catch((err) => console.warn("middle-click paste failed", err))
        .finally(() => {
          if (ta) ta.readOnly = false;
        });
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
          showHud(paths.length > 1 ? "Paths pasted" : "Path pasted", "check");
        }
      })
      .then((u) => {
        dragUnlisten = u;
      })
      .catch((e) => console.warn("onDragDropEvent failed", e));
    onCleanup(() => dragUnlisten?.());

    setTermReady(true);
  });

  // GPU renderer follows the active tab (see the note at `webgl` above).
  createEffect(() => {
    if (props.active) mountWebgl();
    else unmountWebgl();
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

  // Passthrough flips from a global hotkey, so the canvas has to say so
  // itself. The first pass only records the state — restoring a tab that was
  // already in passthrough is not an event.
  let lastPassthrough: boolean | undefined;
  createEffect(() => {
    const on = props.tab.passthrough;
    const prev = lastPassthrough;
    lastPassthrough = on;
    // Only `props.tab.passthrough` is read here — nothing else may be, or the
    // pill would reappear every time the tab is re-activated.
    if (prev === undefined || prev === on) return;
    showHud(on ? "Passthrough on" : "Passthrough off", "bot");
  });

  // When search opens for this tab, focus the input
  createEffect(() => {
    if (isSearchOpenFor(props.tab.id)) {
      queueMicrotask(() => searchInputRef?.focus());
    }
  });

  onCleanup(() => {
    termDisposed = true;
    unmountWebgl();
    term?.dispose();
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: "0",
        // Tab switching used to be a hard visibility cut. It is a cross-fade
        // now — opacity only, never geometry — and `visibility` waits out the
        // fade on the way down so the outgoing terminal stays painted while
        // it disappears (it must still end up hidden, or a background tab
        // would keep taking hit tests).
        visibility: props.active ? "visible" : "hidden",
        opacity: props.active ? 1 : 0,
        transition: props.active
          ? `opacity ${M.d1} ${M.ease}`
          : `opacity ${M.d1} ${M.ease}, visibility 0s linear ${M.d1}`,
        "pointer-events": props.active ? "auto" : "none",
        // The terminal card. App.tsx has no per-tab wrapper to round, so the
        // radius lives here and clips every overlay this component stacks on
        // top. Background must match xtermTheme.background exactly (RAW.bg2)
        // or a seam shows at the corners. No shadow, no filter — xterm rule 1.
        background: C.bg,
        "border-radius": R.md,
        overflow: "hidden",
      }}
    >
      <div
        ref={host}
        // Asymmetric on purpose: more air above the first row and to the left
        // of the prompt than on the edges the overview ruler and the scrollbar
        // already occupy. Background must stay the exact xtermTheme.background
        // (--bg-2) or the padding reads as a frame around the canvas.
        // content-box is load-bearing: FitAddon sizes cols/rows from the
        // parent's computed width/height, which under the global border-box
        // reset INCLUDES this padding. It then over-allocates ~2 columns, the
        // canvas overflows the .xterm box and paints over the viewport's
        // scrollbar (and the last row can slip under the card edge).
        style={{ position: "absolute", inset: "0", padding: "10px 8px 8px 12px", "box-sizing": "content-box", background: C.bg }}
        onclick={() => {
          if (props.active && !isSearchOpenFor(props.tab.id)) {
            term?.focus();
            bumpFit(props.tab.id);
          }
        }}
      />

      {/* Agent activity rail: a 2px accent hairline along the top edge that
       *  breathes while the PTY is writing. Driven by `busy`, which only the
       *  4Hz sampler may flip — never the output callback itself. */}
      <div
        aria-hidden="true"
        class={busy() ? "bs-breathe" : undefined}
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          right: "0",
          height: "2px",
          background: C.accent,
          opacity: busy() ? 1 : 0,
          transition: `opacity ${M.d2} ${M.ease}`,
          "pointer-events": "none",
          "z-index": "4",
        }}
      />

      {/* Passthrough is a canvas-wide mode, so it is marked on the canvas
       *  rather than only in the header: a 1.5px inset ring, drawn by its own
       *  layer because the host paints over anything the root could draw.
       *  Spread only, zero blur — the right side of xterm rule 1. */}
      <Show when={props.tab.passthrough}>
        <div aria-hidden="true" style={passthroughRing} />
      </Show>

      {/* The mode marker yields to the search capsule, which occupies the same
       *  corner and outranks it while it is open. */}
      <Show when={props.tab.passthrough && !isSearchOpenFor(props.tab.id)}>
        <span style={passthroughMark}>Ctrl+Shift+P · passthrough</span>
      </Show>

      <Show when={showReconnectPanel()}>
        <div style={reconnectOverlay}>
          <div style={reconnectCard}>
            <span style={statusBadge(props.tab.status === "error")}>
              <Icon name={props.tab.status === "error" ? "alert-triangle" : "plug"} size={16} />
            </span>
            <span style={cardTitle}>
              {props.tab.status === "error" ? "Connection error" : "Disconnected"}
            </span>
            <Show when={profile()}>
              {(p) => (
                <span style={hostChip}>
                  {p().kind === "local"
                    ? `local · ${p().shell ?? "default shell"}`
                    : `${p().user}@${p().host}:${p().port}`}
                </span>
              )}
            </Show>
            <Show when={props.tab.errorMessage}>
              <span style={errorChip}>{props.tab.errorMessage}</span>
            </Show>
            <Show
              when={profile()}
              fallback={<span style={cardHint}>Connection profile no longer exists.</span>}
            >
              {(p) => (
                <Show
                  when={p().kind === "local" || (p().password && p().password!.length > 0)}
                  fallback={
                    <div style={pwRow}>
                      <input
                        class="bs-input"
                        type="password"
                        placeholder="Password"
                        value={pwPrompt()}
                        autofocus
                        onInput={(e) => setPwPrompt(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") doManualReconnect();
                        }}
                        style={pwField}
                        disabled={reconnecting()}
                      />
                      <button
                        class="bs-btn"
                        onClick={doManualReconnect}
                        disabled={reconnecting() || !pwPrompt()}
                        style={button("primary", "roomy")}
                      >
                        {reconnecting() ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                  }
                >
                  <button
                    class="bs-btn"
                    onClick={doReconnect}
                    disabled={reconnecting()}
                    style={{ ...button("primary", "roomy"), "margin-top": S[1] }}
                  >
                    <Icon name="refresh-cw" size={14} class={reconnecting() ? "bs-spin" : undefined} />
                    {reconnecting() ? "Reconnecting…" : "Reconnect"}
                  </button>
                </Show>
              )}
            </Show>
          </div>
        </div>
      </Show>

      {/* Drag-drop is one of the two states that still earns a full-canvas
       *  overlay (the other is a dead session): it has to answer "will this
       *  drop land here?" before the pointer is released. */}
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
              <Icon name={mode() === "local" ? "download" : "alert-triangle"} size={14} />
              {mode() === "local"
                ? "Drop to paste path"
                : "Drag-drop only supported on local connections"}
            </div>
          </div>
        )}
      </Show>

      {/* HUD: everything that used to black out the terminal to say one short
       *  sentence. It never covers the canvas and never takes a click. */}
      <Show when={hudMsg()}>
        {(msg) => (
          <div style={hudDock}>
            <div style={{ ...hudPill, opacity: msg().leaving ? 0 : 1 }}>
              <Icon name={msg().icon} size={14} />
              {msg().text}
            </div>
          </div>
        )}
      </Show>

      <Show when={isSearchOpenFor(props.tab.id) || showHighlight()}>
        <div style={searchDock}>
          <Show when={isSearchOpenFor(props.tab.id)}>
            <div style={searchColumn}>
              <div style={searchBarStyle(noMatch())} onClick={(e) => e.stopPropagation()}>
                <span style={{ display: "flex", color: C.text3, "flex-shrink": 0 }}>
                  <Icon name="search" size={14} />
                </span>
                <input
                  ref={searchInputRef}
                  class="bs-input bs-input-bare"
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
                  style={searchFieldStyle}
                />
                {/* The three options are one choice, so they share one track. */}
                <div style={segTrack}>
                  <button
                    class="bs-iconbtn"
                    aria-pressed={!!opts().caseSensitive}
                    onClick={() => {
                      setOpts({ ...opts(), caseSensitive: !opts().caseSensitive });
                      runSearch("next");
                    }}
                    style={segToggle}
                    title="Case sensitive"
                  >
                    Aa
                  </button>
                  <button
                    class="bs-iconbtn"
                    aria-pressed={!!opts().wholeWord}
                    onClick={() => {
                      setOpts({ ...opts(), wholeWord: !opts().wholeWord });
                      runSearch("next");
                    }}
                    style={segToggle}
                    title="Whole word"
                  >
                    ab
                  </button>
                  <button
                    class="bs-iconbtn"
                    aria-pressed={!!opts().regex}
                    onClick={() => {
                      setOpts({ ...opts(), regex: !opts().regex });
                      runSearch("next");
                    }}
                    style={segToggle}
                    title="Regex"
                  >
                    .*
                  </button>
                </div>
                <span style={countStyle(noMatch())}>{countLabel()}</span>
                <button class="bs-iconbtn" onClick={findPrev} style={capsuleBtn} title="Previous (Shift+Enter)">
                  <Icon name="arrow-up" size={12} stroke={2} />
                </button>
                <button class="bs-iconbtn" onClick={findNext} style={capsuleBtn} title="Next (Enter)">
                  <Icon name="arrow-down" size={12} stroke={2} />
                </button>
                <button
                  class="bs-iconbtn"
                  aria-pressed={showHighlight()}
                  onClick={() => setShowHighlight((v) => !v)}
                  style={capsuleBtn}
                  title="Keyword highlight"
                >
                  <Icon name="highlighter" size={14} />
                </button>
                <button
                  class="bs-iconbtn"
                  onClick={() => {
                    closeSearch();
                    term?.focus();
                  }}
                  style={closeCapsuleBtn}
                  title="Close (Esc)"
                >
                  <CloseGlyph size="sm" />
                </button>
              </div>
              <div style={searchHint}>
                <kbd>Enter</kbd> next
                <kbd>Shift+Enter</kbd> previous
                <kbd>Esc</kbd> close
              </div>
            </div>
          </Show>

          {/* Highlight is a drawer under the capsule, not a second window. */}
          <Show when={showHighlight()}>
            <div style={highlightDrawer} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", "align-items": "center", "margin-bottom": S[2] }}>
                <span style={drawerTitle}>Keyword highlight</span>
                <button
                  class="bs-iconbtn"
                  onClick={() => setShowHighlight(false)}
                  style={{ ...closeCapsuleBtn, "margin-left": "auto" }}
                  title="Close"
                >
                  <CloseGlyph size="sm" />
                </button>
              </div>
              <For each={slots}>
                {(slot, i) => {
                  let colorInputEl!: HTMLInputElement;
                  return (
                    <div style={{ display: "flex", gap: S[1.5], "align-items": "center", "margin-bottom": S[1] }}>
                      <div
                        onClick={() => colorInputEl.click()}
                        title="Pick colour"
                        style={{
                          width: "18px",
                          height: "18px",
                          "border-radius": R.full,
                          background: slot.color,
                          cursor: "pointer",
                          border: `2px solid ${C.border}`,
                          "flex-shrink": 0,
                        }}
                      />
                      <input
                        ref={colorInputEl}
                        type="color"
                        value={slot.color}
                        style={{ display: "none" }}
                        onInput={(e) => setSlots(i(), "color", e.currentTarget.value)}
                      />
                      <input
                        class="bs-input"
                        type="text"
                        placeholder={`Keyword ${i() + 1}`}
                        value={slot.keyword}
                        onInput={(e) => setSlots(i(), "keyword", e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") applyHighlights(); }}
                        style={drawerField}
                      />
                    </div>
                  );
                }}
              </For>
              <div style={{ display: "flex", gap: S[1.5], "justify-content": "flex-end", "margin-top": S[2] }}>
                <button class="bs-btn" onClick={clearHighlights} style={button("ghost", "compact")}>
                  Clear
                </button>
                <button class="bs-btn" onClick={applyHighlights} style={button("primary", "compact")}>
                  Apply
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

/* Every floating surface below sits ON TOP OF the terminal, so all of them
 * take --sh-1 rather than the --sh-2 the rest of the app's popovers use: a
 * 24px blur radius over the canvas is exactly what xterm rule 1 forbids. */

/** Top-right stack: the search capsule, its hint line and the highlight
 *  drawer, in that order. 12px from the right edge keeps the capsule clear of
 *  the 10px overview ruler and the scrollbar. */
const searchDock = {
  position: "absolute",
  top: S[2],
  right: S[3],
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-end",
  gap: S[1],
  "z-index": "10",
} as const;

const searchColumn = {
  display: "flex",
  "flex-direction": "column",
  gap: S[1],
  animation: `bs-slide-down ${M.d2} ${M.ease}`,
} as const;

/** A real capsule: r-full, height-locked, one hairline. The no-match state is
 *  the border going red — the field inside is bare, so the capsule is the only
 *  thing that can carry it. */
const searchBarStyle = (bad: boolean): JSX.CSSProperties => ({
  display: "flex",
  "align-items": "center",
  gap: S[1],
  height: H.roomy,
  padding: `0 ${S[1]} 0 ${S[2]}`,
  background: C.overlay,
  border: `1px solid ${bad ? C.redBdr : C.border}`,
  "border-radius": R.full,
  "box-shadow": `${SH.e1}, ${SH.hlTop}`,
  transition: `border-color ${M.d1} ${M.ease}`,
});

const searchFieldStyle = {
  width: "168px",
  height: H.compact,
  padding: `0 ${S[1]}`,
  ...T[12],
  "font-family": "inherit",
  "box-sizing": "border-box",
} as const;

/** bg-4 track, 2px padding, one round segment per option. */
const segTrack = {
  display: "flex",
  gap: S[0.5],
  padding: S[0.5],
  background: C.bg3,
  "border-radius": R.full,
  "flex-shrink": 0,
} as const;

const segToggle = {
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "none",
  "border-radius": R.full,
  ...T[10],
  "font-family": FONT.mono,
  "font-weight": 500,
  cursor: "pointer",
  "--btn-bg": "transparent",
  "--btn-fg": C.text3,
  "--btn-fg-hover": C.text,
} as const;

/** Tabular so the capsule does not twitch as the count runs 9 → 10. */
const countStyle = (bad: boolean): JSX.CSSProperties => ({
  ...T[11],
  "font-variant-numeric": "tabular-nums",
  color: bad ? C.red : C.text3,
  "min-width": "58px",
  "text-align": "center",
  "white-space": "nowrap",
  "flex-shrink": 0,
});

const capsuleBtn = {
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "none",
  "border-radius": R.full,
  cursor: "pointer",
  "--btn-bg": "transparent",
  "--btn-fg": C.text3,
  "--btn-fg-hover": C.text,
} as const;

const closeCapsuleBtn = {
  ...capsuleBtn,
  "--btn-bg-hover": C.redBg,
  "--btn-fg-hover": C.red,
} as const;

const searchHint = {
  display: "flex",
  "align-items": "center",
  gap: S[1],
  padding: `0 ${S[2]}`,
  ...T[10],
  color: C.text4,
} as const;

const highlightDrawer = {
  width: "260px",
  background: C.overlay,
  border: `1px solid ${C.border}`,
  "border-radius": R.lg,
  "box-shadow": `${SH.e1}, ${SH.hlTop}`,
  padding: `${S[2]} ${S[3]}`,
  animation: `bs-slide-down ${M.d2} ${M.ease}`,
} as const;

const drawerTitle = {
  ...T[12],
  "font-weight": 600,
  color: C.text,
} as const;

const drawerField = {
  flex: 1,
  "min-width": 0,
  height: H.compact,
  padding: `0 ${S[2]}`,
  ...T[12],
  "font-family": "inherit",
  "box-sizing": "border-box",
} as const;

/* ------------------------------------------------------------- HUD + drop */

const hudDock = {
  position: "absolute",
  left: "0",
  right: "0",
  bottom: S[4],
  display: "flex",
  "justify-content": "center",
  "pointer-events": "none",
  "z-index": "9",
} as const;

const hudPill = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.roomy,
  padding: "0 14px",
  background: C.overlay,
  color: C.text,
  "border-radius": R.full,
  "box-shadow": `${SH.e1}, ${SH.hlTop}`,
  ...T[13],
  "font-weight": 500,
  "white-space": "nowrap",
  // No fill-mode: once the pop-in has run the element must fall back to its
  // own opacity, or the fade-out below would never be visible.
  animation: `bs-pop-in ${M.d2} ${M.easePop}`,
  transition: `opacity ${HUD_FADE_MS}ms ${M.ease}`,
} as const;

const dropOverlayStyle = {
  position: "absolute",
  inset: "0",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  background: C.scrimDrop,
  animation: `bs-fade-in ${M.d2} ${M.ease}`,
  "z-index": "11",
  "pointer-events": "none",
} as const;

const dropCardStyle = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[2],
  padding: `${S[5]} ${S[8]}`,
  border: "2px dashed",
  "border-radius": R.lg,
  background: C.overlay,
  ...T[13],
  "font-weight": 500,
} as const;

/* --------------------------------------------------- passthrough + reconnect */

const passthroughRing = {
  position: "absolute",
  inset: "0",
  "border-radius": R.md,
  "box-shadow": `inset 0 0 0 1.5px ${C.purpleRing}`,
  "pointer-events": "none",
  "z-index": "3",
} as const;

const passthroughMark = {
  position: "absolute",
  top: S[1],
  right: S[3],
  ...T[10],
  "font-family": FONT.mono,
  color: C.purple,
  "white-space": "nowrap",
  "pointer-events": "none",
  "z-index": "4",
} as const;

/** A radial wash rather than a flat veil: the card sits in the lighter middle
 *  and the corners go darker, so the dead canvas stops competing with it. */
const reconnectOverlay = {
  position: "absolute",
  inset: "0",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  background: `radial-gradient(ellipse at center, ${C.scrimTermIn}, ${C.scrimTermOut})`,
  animation: `bs-fade-in ${M.d2} ${M.ease}`,
  "z-index": "5",
} as const;

const reconnectCard = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "text-align": "center",
  gap: S[2],
  "min-width": "360px",
  "max-width": "480px",
  "box-sizing": "border-box",
  padding: `${S[6]} ${S[6]}`,
  background: C.overlay,
  border: `1px solid ${C.border}`,
  "border-radius": R.xl,
  "box-shadow": `${SH.e1}, ${SH.hlTop}`,
  color: C.text,
  animation: `bs-pop-in ${M.d3} ${M.easePop}`,
} as const;

const statusBadge = (error: boolean): JSX.CSSProperties => ({
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  width: "28px",
  height: "28px",
  "border-radius": R.full,
  "flex-shrink": 0,
  background: error ? C.redBg : C.yellowBg,
  color: error ? C.red : C.yellow,
});

const cardTitle = {
  ...T[15],
  "font-weight": 600,
  color: C.text,
} as const;

const hostChip = {
  ...T[12],
  "font-family": FONT.mono,
  color: C.text2,
} as const;

const errorChip = {
  "max-width": "100%",
  padding: `${S[1]} ${S[2]}`,
  background: C.bg3,
  border: `1px solid ${C.borderSub}`,
  "border-radius": R.sm,
  ...T[11],
  "font-family": FONT.mono,
  color: C.text2,
  "overflow-wrap": "anywhere",
} as const;

const cardHint = {
  ...T[12],
  color: C.text3,
} as const;

const pwRow = {
  display: "flex",
  gap: S[1.5],
  width: "100%",
  "margin-top": S[1],
} as const;

const pwField = {
  flex: 1,
  "min-width": 0,
  height: H.roomy,
  padding: `0 ${S[2]}`,
  ...T[13],
  "font-family": "inherit",
  "box-sizing": "border-box",
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
