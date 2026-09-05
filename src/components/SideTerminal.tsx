import { createEffect, createSignal, getOwner, onCleanup, onMount, runWithOwner, Show } from "solid-js";
import { C, FONT, xtermThemeFor } from "../theme";
import { PanelHeader, panelCard } from "./ui/PanelHeader";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { api } from "../ipc/api";
import { general } from "../stores/general";
import {
  closeSideTerm,
  isSideTermOpen,
  setSideTermHeight,
  setSideTermWidth,
  sideTermHeight,
  sideTermSessionId,
  sideTermState,
  sideTermWidth,
} from "../stores/sideTerm";
import { layoutMode, layoutVertical } from "../stores/layout";
import { activeTabId } from "../stores/tabs";

export function SideTerminalPanel() {
  const tabId = () => activeTabId() ?? "";
  const sid = () => sideTermSessionId(tabId());
  const entry = () => sideTermState.entries[tabId()];

  const [dragging, setDragging] = createSignal(false);

  function startDrag(ev: MouseEvent) {
    ev.preventDefault();
    setDragging(true);
    if (layoutVertical() || layoutMode() === "right-split") {
      const startY = ev.clientY;
      const startH = sideTermHeight();
      const onMove = (e: MouseEvent) => setSideTermHeight(startH + (startY - e.clientY));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    } else {
      const startX = ev.clientX;
      const startW = sideTermWidth();
      const onMove = (e: MouseEvent) => setSideTermWidth(startW + (startX - e.clientX));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  }

  // right-split: top drag handle only (App.tsx owns column width).
  // SideTerminal takes fixed height at the bottom of the right column.
  if (layoutMode() === "right-split") {
    return (
      <>
        <div
          class="bs-resize"
          data-axis="row"
          data-dragging={dragging() ? "true" : "false"}
          onMouseDown={startDrag}
          style={gapHandle}
          title="Drag to resize"
        />
        <div
          style={{
            ...panelCard(C.bg2),
            height: `${sideTermHeight()}px`,
            "flex-shrink": "0",
            position: "relative",
          }}
        >
          <SideHeader tabId={tabId()} opening={!!entry()?.opening} error={entry()?.error} />
          <div style={{ flex: 1, "min-height": 0, position: "relative" }}>
            <Show when={sid()} keyed>
              {(s) => <SideTerminalView sessionId={s} parentTabId={tabId()} />}
            </Show>
          </div>
        </div>
      </>
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
          height: `${sideTermHeight()}px`,
          width: "100%",
          // Chrome is --bg-1; only the xterm host inside is --bg-2, which is
          // what xtermTheme.background is bound to.
          background: C.bg2,
          "border-top": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          "flex-shrink": "0",
          overflow: "hidden",
          color: C.text,
          "font-size": "13px",
          position: "relative",
        } : {
          width: `${sideTermWidth()}px`,
          background: C.bg2,
          "border-left": `1px solid ${C.border}`,
          display: "flex",
          "flex-direction": "column",
          "flex-shrink": "0",
          overflow: "hidden",
          color: C.text,
          "font-size": "13px",
          position: "relative",
        }}
      >
        <SideHeader tabId={tabId()} opening={!!entry()?.opening} error={entry()?.error} />
        <div style={{ flex: 1, "min-height": 0, position: "relative" }}>
          <Show when={sid()} keyed>
            {(s) => <SideTerminalView sessionId={s} parentTabId={tabId()} />}
          </Show>
        </div>
      </div>
    </>
  );
}

/** One header for both layouts. The status text lives in PanelHeader's meta
 *  slot so the title never shifts when a session is opening or errors. */
function SideHeader(p: { tabId: string; opening: boolean; error?: string }) {
  return (
    <PanelHeader
      icon="terminal"
      title="Side terminal"
      meta={
        <Show when={p.error} fallback={p.opening ? "opening…" : undefined}>
          <span style={{ color: C.red }}>{p.error}</span>
        </Show>
      }
      onClose={() => closeSideTerm(p.tabId)}
      closeTitle="Close side terminal"
    />
  );
}

/** Grab strips. No border of their own: the panel card already draws one, and
 *  a handle hairline next to it is the double line this phase removes. */

/** Right-split: an 8px strip pulled into the 6px gap between two cards with a
 *  -4px margin, so it costs no layout height and the gap stays exactly 6px —
 *  the same trick App.tsx uses for the column handle, rotated. */
const gapHandle = {
  height: "8px",
  margin: "-4px 0",
  cursor: "row-resize",
  "z-index": "5",
} as const;

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

function SideTerminalView(props: { sessionId: string; parentTabId: string }) {
  let host!: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let unlisteners: Array<() => void> = [];

  onMount(async () => {
    // Capture the component owner before any `await`. SolidJS only tracks the
    // owner synchronously, so reactive primitives created after the awaits
    // below (createEffect / onCleanup) would otherwise be owner-less — they'd
    // never be disposed (leaking listeners + an effect on every remount) and
    // log "computations/cleanups created outside a createRoot" warnings.
    const owner = getOwner();
    term = new Terminal({
      cursorBlink: true,
      fontFamily: FONT.term,
      fontSize: general().side_font_size,
      // Matches Terminal.tsx so the two grids share one optical rhythm.
      lineHeight: 1.2,
      fontWeightBold: 600,
      scrollback: general().scrollback,
      allowProposedApi: true,
      theme: xtermThemeFor(general().terminal_palette),
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    // Match modern CLI wcwidth (Unicode 11) so CJK/emoji redraws don't garble.
    // See Terminal.tsx for the full rationale.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.loadAddon(
      new WebLinksAddon((_ev, uri) => {
        api.urlOpen(uri).catch((e) => console.warn("url_open failed", e));
      }),
    );
    try {
      term.loadAddon(new WebglAddon());
    } catch {}
    term.open(host);
    fit.fit();
    // Push the actual fitted size to the PTY. side terminals are opened with
    // placeholder cols/rows (100x30), so without this the remote shell sits at
    // a smaller viewport than xterm displays.
    api.sshResize(props.sessionId, term.cols, term.rows).catch(console.error);

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
            api.sshWrite(props.sessionId, text).catch(console.error);
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

    term.onData((data) => {
      api.sshWrite(props.sessionId, data).catch(console.error);
    });
    term.onResize(({ cols, rows }) => {
      api.sshResize(props.sessionId, cols, rows).catch(() => {});
    });

    const ulData = await api.onSshData(props.sessionId, (bytes) => term?.write(bytes));
    const ulClose = await api.onSshClose(props.sessionId, (reason) => {
      term?.write(`\r\n\x1b[31m[side terminal closed: ${reason}]\x1b[0m\r\n`);
      // Clear the panel session so the user can reopen.
      // Don't kill again — the channel is gone already.
      closeSideTerm(props.parentTabId, false);
    });
    unlisteners.push(ulData, ulClose);

    // Auto-copy selection to clipboard on mouseup. Mirrors the main terminal:
    // native arboard (navigator.clipboard can silently fail on WebKitGTK), and
    // ignore non-left buttons so a middle-click paste doesn't re-copy the
    // selection over what was just pasted.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!term?.hasSelection()) return;
      const sel = term.getSelection();
      if (!sel) return;
      api.clipboardWriteText(sel).catch((err) =>
        console.warn("clipboard write failed", err),
      );
    };
    host.addEventListener("mouseup", onMouseUp);

    // Middle-click paste — uniform across platforms: read the system clipboard
    // and paste it. On Linux make the helper textarea readOnly for the duration
    // so WebKitGTK's native PRIMARY-selection middle-click paste can't ALSO fire
    // (double-paste); term.paste() bypasses the textarea so ours still lands.
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

    const ro = new ResizeObserver(() => {
      if (isSideTermOpen(props.parentTabId)) fit?.fit();
    });
    ro.observe(host);

    // Re-establish the owner lost across the awaits above so these reactive
    // primitives are attached to the component and disposed on unmount.
    runWithOwner(owner, () => {
      createEffect(() => {
        if (!term) return;
        term.options.scrollback = general().scrollback;
        term.options.fontSize = general().side_font_size;
        term.options.theme = xtermThemeFor(general().terminal_palette);
        queueMicrotask(() => fit?.fit());
      });

      onCleanup(() => {
        host.removeEventListener("mouseup", onMouseUp);
        host.removeEventListener("mousedown", onMouseDown);
        ro.disconnect();
      });
    });
    term.focus();
  });

  onCleanup(() => {
    unlisteners.forEach((u) => u());
    term?.dispose();
  });

  // Same anatomy as the main terminal host, one notch tighter because the
  // side pane is narrow. Background is xtermTheme.background exactly (--bg-2).
  return (
    <div
      ref={host}
      style={{ position: "absolute", inset: "0", padding: "6px 8px 4px 10px", background: C.bg }}
    />
  );
}
