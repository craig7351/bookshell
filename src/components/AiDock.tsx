import { createMemo, For, Show } from "solid-js";
import { C, H, R, S, T } from "../theme";
import { activeTabId, setActiveTab } from "../stores/tabs";
import { aiStateOf, aiTabs } from "../stores/aiStatus";
import { AiBadge } from "./ui/AiBadge";

const STATE_LABEL = {
  working: "AI working",
  attention: "AI needs your input",
  done: "AI finished",
} as const;

/**
 * Header strip (Left tab mode) listing every tab with an AI agent session:
 * one chip per tab with its badge and name; click to switch. Chips keep the
 * tabs' own order so they never jump under the pointer when a state changes.
 * Renders nothing when no tab has a session or a pending alert.
 */
export function AiDock() {
  let scroller: HTMLDivElement | undefined;
  const items = createMemo(aiTabs);

  return (
    <Show when={items().length > 0}>
      <div
        ref={scroller}
        class="bs-hscroll"
        style={dockStyle}
        role="toolbar"
        aria-label="AI sessions"
        onWheel={(e) => {
          if (!scroller || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          scroller.scrollLeft += e.deltaY;
          e.preventDefault();
        }}
      >
        <For each={items()}>
          {(t) => {
            const state = () => aiStateOf(t.id);
            const active = () => activeTabId() === t.id;
            const attention = () => state() === "attention";
            return (
              <button
                class="bs-pill"
                aria-current={active() ? "page" : undefined}
                title={`${t.name} · ${state() ? STATE_LABEL[state()!] : "AI idle"}`}
                onClick={() => setActiveTab(t.id)}
                style={{
                  ...chipStyle,
                  "font-weight": active() || attention() ? 600 : 400,
                  "border-color": attention() ? C.yellow : active() ? C.accentBdr : C.border,
                  "--btn-bg": attention() ? C.yellowBg : "transparent",
                  "--btn-fg": active() || attention() ? C.text : C.text2,
                  "--btn-fg-hover": C.text,
                }}
              >
                <Show when={state()} fallback={<span style={idleSlotStyle}><span style={idleDotStyle} /></span>}>
                  {(s) => <AiBadge state={s()} />}
                </Show>
                <span style={nameStyle}>{t.name}</span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

const dockStyle = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  flex: "0 1 auto",
  "min-width": 0,
  height: "100%",
  "overflow-x": "auto",
  "overflow-y": "hidden",
} as const;

const chipStyle = {
  display: "inline-flex",
  "align-items": "center",
  gap: S[1.5],
  height: H.default,
  "max-width": "180px",
  padding: `0 10px 0 ${S[1]}`,
  border: "1px solid",
  "border-radius": R.full,
  cursor: "pointer",
  "flex-shrink": 0,
  ...T[12],
} as const;

const nameStyle = {
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

/** Keeps idle chips' names aligned with badged ones (badges are 18px). */
const idleSlotStyle = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  width: "18px",
  height: "18px",
  "flex-shrink": 0,
} as const;

const idleDotStyle = {
  width: "8px",
  height: "8px",
  "border-radius": R.full,
  background: C.text3,
} as const;
