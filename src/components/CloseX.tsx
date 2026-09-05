import { C, R } from "../theme";
import { Icon } from "../icons";

interface Props {
  onClose: () => void;
  /** Inline style overrides (e.g. position adjustments) */
  style?: Record<string, string | number>;
  title?: string;
}

/** The one close mark in the app: a 12px (sm) or 14px (md) stroked ✕.
 *  Shared so a TabBar row, a dialog and a viewer never disagree about what
 *  "close" looks like. Colour is inherited — set it on the button, not here. */
export function CloseGlyph(props: { size?: "sm" | "md" }) {
  return <Icon name="x" size={props.size === "md" ? 14 : 12} stroke={2} />;
}

/** Reusable top-right ✕ close button for modal dialogs.
 *  Caller must give the parent `position: relative`. */
export function CloseX(props: Props) {
  return (
    <button
      class="bs-iconbtn"
      onClick={props.onClose}
      title={props.title ?? "Close (Esc)"}
      style={{
        position: "absolute",
        top: "10px",
        right: "10px",
        width: "22px",
        height: "22px",
        padding: "0",
        border: "none",
        cursor: "pointer",
        // Hover/press colour belongs to .bs-iconbtn — feed it through the
        // slots, never through an inline background/color.
        "--btn-bg": "transparent",
        "--btn-bg-hover": C.redBg,
        "--btn-fg": C.text3,
        "--btn-fg-hover": C.red,
        "border-radius": R.sm,
        "z-index": "10",
        ...(props.style ?? {}),
      }}
    >
      <CloseGlyph size="md" />
    </button>
  );
}
