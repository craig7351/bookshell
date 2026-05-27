import { createEffect, createSignal, getOwner, onCleanup, onMount, runWithOwner, Show } from "solid-js";
import { C, xtermTheme } from "../theme";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
import { isLinux } from "../stores/connections";
import { activeTabId } from "../stores/tabs";
import { CloseX } from "./CloseX";

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
          onMouseDown={startDrag}
          style={{
            height: "4px",
            cursor: "row-resize",
            background: dragging() ? C.accent : "transparent",
            "border-top": `1px solid ${C.border}`,
            "flex-shrink": "0",
            transition: "background 0.15s",
          }}
          title="Drag to resize"
        />
        <div
          style={{
            height: `${sideTermHeight()}px`,
            width: "100%",
            background: C.bg,
            display: "flex",
            "flex-direction": "column",
            "flex-shrink": "0",
            overflow: "hidden",
            color: C.text,
            "font-size": "13px",
            position: "relative",
          }}
        >
          <div style={{ padding: "7px 10px", "border-bottom": `1px solid ${C.border}`, display: "flex", "align-items": "center", gap: "6px", "padding-right": "40px", "flex-shrink": 0 }}>
            <strong style={{ "font-size": "12px", color: C.text2 }}>📟 Side terminal</strong>
            <Show when={entry()?.opening}>
              <span style={{ "font-size": "11px", color: C.text3 }}>opening…</span>
            </Show>
            <Show when={entry()?.error}>
              <span style={{ color: C.red, "font-size": "11px" }}>{entry()!.error}</span>
            </Show>
          </div>
          <div style={{ flex: 1, "min-height": 0, position: "relative" }}>
            <Show when={sid()} keyed>
              {(s) => <SideTerminalView sessionId={s} parentTabId={tabId()} />}
            </Show>
          </div>
          <CloseX onClose={() => closeSideTerm(tabId())} title="Close side terminal" />
        </div>
      </>
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
          height: `${sideTermHeight()}px`,
          width: "100%",
          background: C.bg,
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
          background: C.bg,
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
        <div style={{ padding: "7px 10px", "border-bottom": `1px solid ${C.border}`, display: "flex", "align-items": "center", gap: "6px", "padding-right": "40px", "flex-shrink": 0 }}>
          <strong style={{ "font-size": "12px", color: C.text2 }}>📟 Side terminal</strong>
          <Show when={entry()?.opening}>
            <span style={{ "font-size": "11px", color: C.text3 }}>opening…</span>
          </Show>
          <Show when={entry()?.error}>
            <span style={{ color: C.red, "font-size": "11px" }}>{entry()!.error}</span>
          </Show>
        </div>
        <div style={{ flex: 1, "min-height": 0, position: "relative" }}>
          <Show when={sid()} keyed>
            {(s) => <SideTerminalView sessionId={s} parentTabId={tabId()} />}
          </Show>
        </div>
        <CloseX onClose={() => closeSideTerm(tabId())} title="Close side terminal" />
      </div>
    </>
  );
}

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
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: general().side_font_size,
      scrollback: general().scrollback,
      allowProposedApi: true,
      theme: xtermTheme,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
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

    // Auto-copy selection to clipboard on mouseup.
    const onMouseUp = () => {
      if (!term?.hasSelection()) return;
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    };
    host.addEventListener("mouseup", onMouseUp);

    // Middle-click paste. On Linux, WebKitGTK handles X11 primary-selection
    // paste natively via onData — we only suppress the auto-scroll affordance
    // to avoid double-paste. On Windows/macOS there is no native primary
    // selection, so we read the clipboard manually with arboard.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (!isLinux()) {
        api.clipboardReadText().then((text) => {
          if (text) term?.paste(text);
        }).catch((err) => console.warn("middle-click paste failed", err));
      }
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

  return <div ref={host} style={{ position: "absolute", inset: "0", padding: "4px" }} />;
}
