import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, type CommandButton } from "../ipc/api";
import { buttons, loadButtons } from "../stores/buttons";
import { Icon } from "../icons";
import { activeTab, bumpFit } from "../stores/tabs";
import { button, C, FONT, H, M, R, S, SH, T } from "../theme";

interface Props {
  onEdit: () => void;
}

/** Anchored confirm popover width, in px. Fixed so the clamp below can keep
 *  the popover inside the window without measuring after paint. */
const POP_W = 320;

/** Window-edge inset used by that clamp. */
const EDGE = 8;

/** How long the sent-flash stays on a pill. */
const FLASH_MS = 400;

interface Pending {
  b: CommandButton;
  /** Viewport coordinates: the popover grows upward from the pill. */
  left: number;
  bottom: number;
}

export function CommandBar(props: Props) {
  const [pending, setPending] = createSignal<Pending | null>(null);
  const [flashId, setFlashId] = createSignal<string | null>(null);
  const [fade, setFade] = createSignal(false);
  let scroller: HTMLDivElement | undefined;

  loadButtons();

  /** True while the strip has content scrolled off its right edge. Drives the
   *  mask; without the check the last pill would always look half-faded. */
  function measure() {
    const el = scroller;
    if (!el) return;
    setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (scroller) ro.observe(scroller);
    onCleanup(() => ro.disconnect());
  });

  // The pill list changes width when buttons are added / renamed in Settings.
  createEffect(() => {
    buttons();
    queueMicrotask(measure);
  });

  // The confirm popover has no scrim — it closes on Escape or on a click
  // anywhere that is not the popover itself.
  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt?.closest("[data-cmd-pop]")) return;
      setPending(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pending()) setPending(null);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  function flash(id: string) {
    setFlashId(id);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), FLASH_MS);
  }

  async function send(b: CommandButton) {
    const t = activeTab();
    if (!t || !t.sessionId) {
      alert("No active connected tab");
      return;
    }
    let payload = b.command;
    if (payload.includes("\n")) {
      // multi-line: send each line followed by CR (if send_enter)
      const lines = payload.split("\n");
      for (const line of lines) {
        await api.sshWrite(t.sessionId, line);
        await api.sshWrite(t.sessionId, "\r");
      }
    } else {
      await api.sshWrite(t.sessionId, payload);
      if (b.send_enter) await api.sshWrite(t.sessionId, "\r");
    }
    // Return focus to the terminal so the user can keep typing without an
    // extra click. fitTick effect in Terminal.tsx handles the actual focus.
    bumpFit(t.id);
  }

  function run(b: CommandButton) {
    flash(b.id);
    send(b);
  }

  function handleClick(b: CommandButton, el: HTMLElement) {
    if (b.confirm) {
      const r = el.getBoundingClientRect();
      setPending({
        b,
        left: Math.max(EDGE, Math.min(r.left, window.innerWidth - POP_W - EDGE)),
        bottom: window.innerHeight - r.top + 6,
      });
    } else {
      run(b);
    }
  }

  return (
    <div style={dockStyle}>
      <div
        ref={scroller}
        class={fade() ? "bs-dock-scroll bs-dock-fade" : "bs-dock-scroll"}
        style={stripStyle}
        onScroll={measure}
        onWheel={(e) => {
          // A dock is a horizontal object: a vertical wheel scrolls it sideways
          // rather than doing nothing.
          if (e.deltaY === 0) return;
          const el = e.currentTarget;
          if (el.scrollWidth <= el.clientWidth) return;
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }}
      >
        <For each={buttons()}>
          {(b) => {
            // A user colour shows as a 6px dot plus a 35% border tint — the
            // label itself stays --text-2 so twelve pills read as one row and
            // not as twelve competing signals.
            const colored = () => !!b.color;
            return (
              <button
                class="bs-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick(b, e.currentTarget);
                }}
                style={{
                  ...pillStyle,
                  "--btn-fg": C.text2,
                  // Longhand after the shorthand: if color-mix() is not
                  // supported the declaration is dropped and the border keeps
                  // the var(--line) the shorthand already set.
                  "border-color": colored()
                    ? `color-mix(in srgb, ${b.color} 35%, transparent)`
                    : undefined,
                }}
                title={b.command}
              >
                <Show when={colored()}>
                  <span style={{ ...dotStyle, background: b.color as string }} />
                </Show>
                <Show when={b.icon}>{(i) => <span>{i()}</span>}</Show>
                <span style={labelStyle}>{b.label}</span>
                <Show when={b.hotkey}>{(k) => <kbd>{k()}</kbd>}</Show>
                <Show when={flashId() === b.id}>
                  <span style={flashStyle} />
                </Show>
              </button>
            );
          }}
        </For>
      </div>

      <div style={editSepStyle} />
      <button
        class="bs-iconbtn bs-tip bs-tip-up bs-tip-end"
        onClick={props.onEdit}
        style={editBtnStyle}
        data-tip="Edit command buttons"
        aria-label="Edit command buttons"
      >
        <Icon name="pencil" size={14} />
      </button>

      <Show when={pending()}>
        {(p) => (
          <div
            data-cmd-pop
            role="dialog"
            aria-label="Confirm command"
            style={{ ...popStyle, left: `${p().left}px`, bottom: `${p().bottom}px` }}
          >
            <div style={{ ...T[12], color: C.text, "font-weight": 500 }}>
              {p().b.confirm_text || `Run "${p().b.label}"?`}
            </div>
            <div style={cmdBoxStyle}>{p().b.command}</div>
            <div style={popActionsStyle}>
              <button
                class="bs-btn"
                onClick={() => setPending(null)}
                style={button("secondary", "default")}
              >
                Cancel
              </button>
              <button
                class="bs-btn"
                onClick={() => {
                  run(p().b);
                  setPending(null);
                }}
                style={button("danger", "default")}
              >
                Run
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

/** The dock itself: one 34px strip, never taller, never two rows. */
const dockStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  padding: `0 ${S[3]}`,
  height: "34px",
  background: C.bg2,
  "border-top": `1px solid ${C.border}`,
  "flex-shrink": 0,
};

/** The scrolling half. nowrap + overflow-x is what keeps the terminal height
 *  constant no matter how many buttons the user defines. */
const stripStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  flex: 1,
  "min-width": 0,
  "overflow-x": "auto",
  "overflow-y": "hidden",
  "white-space": "nowrap",
};

/** Geometry only — `.bs-pill` owns background, foreground and the capsule
 *  radius, so none of those may appear here. */
const pillStyle: JSX.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.default,
  padding: "0 10px",
  border: `1px solid ${C.border}`,
  ...T[12],
  "font-weight": 500,
  cursor: "pointer",
  "white-space": "nowrap",
  "max-width": "240px",
  overflow: "hidden",
  "flex-shrink": 0,
};

const labelStyle: JSX.CSSProperties = {
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const dotStyle: JSX.CSSProperties = {
  width: "6px",
  height: "6px",
  "border-radius": R.full,
  "flex-shrink": 0,
};

/** The "sent" acknowledgement: one accent wash over the pill, opacity only.
 *  The pill clips it, so it needs no radius of its own. */
const flashStyle: JSX.CSSProperties = {
  position: "absolute",
  inset: "0",
  background: C.accentBg,
  "pointer-events": "none",
  animation: `bs-flash ${FLASH_MS}ms ${M.ease}`,
};

/** Visual divider before the Edit button, so the pencil reads as a separate
 *  configuration affordance instead of "just another command button". */
const editSepStyle: JSX.CSSProperties = {
  width: "1px",
  height: "16px",
  background: C.border,
  "flex-shrink": 0,
};

/** Square ghost button. Background / foreground are slots the .bs-iconbtn
 *  class drives on hover — never set either one inline here. */
const editBtnStyle: JSX.CSSProperties = {
  "--btn-bg": "transparent",
  "--btn-fg": C.text3,
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "1px solid transparent",
  cursor: "pointer",
  "flex-shrink": 0,
};

/** Anchored above the pill that opened it. No scrim: confirming one button is
 *  not a modal moment, and dimming the terminal to ask "run this?" reads as
 *  far more serious than it is. */
const popStyle: JSX.CSSProperties = {
  position: "fixed",
  width: `${POP_W}px`,
  "max-width": "calc(100vw - 16px)",
  display: "flex",
  "flex-direction": "column",
  gap: S[2],
  padding: S[3],
  background: C.overlay,
  border: `1px solid ${C.border}`,
  "border-radius": R.lg,
  "box-shadow": `${SH.e2}, ${SH.hlTop}`,
  "z-index": "90",
  animation: `bs-pop-up ${M.d2} ${M.easePop}`,
};

const cmdBoxStyle: JSX.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.borderSub}`,
  padding: S[2],
  "border-radius": R.sm,
  "font-family": FONT.mono,
  ...T[11],
  color: C.text2,
  "white-space": "pre-wrap",
  "word-break": "break-all",
  "max-height": "120px",
  "overflow-y": "auto",
};

const popActionsStyle: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "flex-end",
  gap: S[2],
};
