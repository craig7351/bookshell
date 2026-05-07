import { createSignal } from "solid-js";
import { C } from "../theme";

interface Props {
  onClose: () => void;
  /** Inline style overrides (e.g. position adjustments) */
  style?: Record<string, string | number>;
  title?: string;
}

/** Reusable top-right ✕ close button for modal dialogs.
 *  Caller must give the parent `position: relative`. */
export function CloseX(props: Props) {
  const [hover, setHover] = createSignal(false);
  return (
    <button
      onClick={props.onClose}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={props.title ?? "Close (Esc)"}
      style={{
        position: "absolute",
        top: "10px",
        right: "10px",
        background: hover() ? C.redBg : "transparent",
        color: hover() ? C.red : C.text3,
        border: "none",
        "font-size": "16px",
        "line-height": "1",
        cursor: "pointer",
        padding: "3px 8px",
        "border-radius": "6px",
        "z-index": "10",
        transition: "background 0.15s, color 0.15s",
        ...(props.style ?? {}),
      }}
    >
      ✕
    </button>
  );
}
