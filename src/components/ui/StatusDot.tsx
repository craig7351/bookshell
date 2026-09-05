import { C, R } from "../../theme";

/** Connection lifecycle, mirrored from stores/tabs TabStatus. Declared locally
 *  so the primitive stays dependency-free and reusable for any connection-ish
 *  indicator (side terminal, agent, SFTP …). */
export type DotState = "connected" | "connecting" | "disconnected" | "error";

interface Props {
  state: DotState;
  /** Diameter in px. 7 is the app default; nothing should need another size. */
  size?: number;
}

/**
 * The single status indicator for the whole app — replaces the ◐ ● ○ !
 * glyph soup, which inherited the text baseline and jittered between fonts.
 *
 *   connected     solid green at .7 (present, not shouting)
 *   connecting    solid yellow, breathing at --dur-breathe
 *   disconnected  hollow, 1.5px --text-4 ring
 *   error         solid red with a 2px --red-fill halo (no blur)
 */
export function StatusDot(props: Props) {
  const d = () => `${props.size ?? 7}px`;
  return (
    <span
      class={props.state === "connecting" ? "bs-breathe" : undefined}
      style={{
        display: "block",
        width: d(),
        height: d(),
        "border-radius": R.full,
        "flex-shrink": 0,
        background:
          props.state === "connected"
            ? C.green
            : props.state === "connecting"
              ? C.yellow
              : props.state === "error"
                ? C.red
                : "transparent",
        opacity: props.state === "connected" ? 0.7 : 1,
        border: props.state === "disconnected" ? `1.5px solid ${C.text4}` : "none",
        // Blur-free halo: a spread-only shadow, safe next to the terminal.
        "box-shadow": props.state === "error" ? `0 0 0 2px ${C.redBg}` : "none",
      }}
    />
  );
}
