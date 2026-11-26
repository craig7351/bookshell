import { Show } from "solid-js";
import { C, R } from "../../theme";
import { Icon } from "../../icons";
import type { AiState } from "../../stores/aiStatus";

/** AI agent state chip: spinner while working, yellow bell when it needs
 *  you, green check when it finished while you were elsewhere. */
export function AiBadge(props: { state: AiState }) {
  return (
    <Show
      when={props.state !== "working"}
      fallback={
        // Same 18px pill as the other two states, accent-filled. The arc spins
        // via SVG <animateTransform>: it runs on the document clock, so a
        // re-rendered row picks up mid-turn instead of restarting, and it does
        // not depend on a CSS class.
        <span title="AI working" aria-label="AI working" style={{ ...aiPillStyle, background: C.accent, color: "#fff" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" opacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </path>
          </svg>
        </span>
      }
    >
      <span
        title={props.state === "attention" ? "AI needs your input" : "AI finished"}
        aria-label={props.state === "attention" ? "AI needs your input" : "AI finished"}
        class={props.state === "attention" ? "bs-pulse" : undefined}
        style={{
          ...aiPillStyle,
          background: props.state === "attention" ? C.yellow : C.green,
        }}
      >
        <Icon name={props.state === "attention" ? "bell" : "check"} size={12} stroke={2.5} />
      </span>
    </Show>
  );
}

const aiPillStyle = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  width: "18px",
  height: "18px",
  "border-radius": R.full,
  color: C.bg0,
  "flex-shrink": 0,
} as const;
