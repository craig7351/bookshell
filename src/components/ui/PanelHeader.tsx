import { Show, type JSX } from "solid-js";
import { C, H, R, S, T } from "../../theme";
import { Icon, type IconName } from "../../icons";
import { CloseGlyph } from "../CloseX";

/**
 * The one header for a right-column panel — Git, Files, Side terminal.
 *
 * Anatomy (locked by section 3.2 / 5.5): 32px tall, 0 10px padding, one
 * hairline underneath, a 16px glyph, an uppercase --t-11/600 title, a meta
 * slot for status text, then actions and a 22x22 close button.
 *
 * Colour flows from the header down: the root sets --text-3 so the glyph
 * inherits it, and only the title lifts to --text-2 (or --text-1 when the
 * panel owns focus). No child paints its own icon colour.
 */

interface Props {
  icon: IconName;
  /** Rendered uppercase — pass it in natural case. */
  title: string;
  /** Status text beside the title: "opening…", a count, an error. */
  meta?: JSX.Element;
  /** Controls that sit left of the close button. */
  actions?: JSX.Element;
  onClose?: () => void;
  closeTitle?: string;
  /** Lifts the title to --text-1 while the panel owns keyboard focus. */
  focused?: boolean;
}

export function PanelHeader(props: Props) {
  return (
    <div style={headerStyle}>
      <Icon name={props.icon} size={16} />
      <span
        style={{
          ...titleStyle,
          color: props.focused ? C.text : C.text2,
        }}
      >
        {props.title}
      </span>
      <Show when={props.meta}>
        <span style={metaStyle}>{props.meta}</span>
      </Show>
      <span style={trailStyle}>
        {props.actions}
        <Show when={props.onClose}>
          <button
            class="bs-iconbtn"
            onClick={() => props.onClose!()}
            title={props.closeTitle ?? "Close panel"}
            style={closeBtnStyle}
          >
            <CloseGlyph size="sm" />
          </button>
        </Show>
      </span>
    </div>
  );
}

const headerStyle = {
  height: "32px",
  padding: `0 ${S[3]}`,
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  "flex-shrink": 0,
  "border-bottom": `1px solid ${C.borderSub}`,
  color: C.text3,
} as const;

const titleStyle = {
  ...T[11],
  "font-weight": 600,
  "text-transform": "uppercase",
  "letter-spacing": "0.06em",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
} as const;

const metaStyle = {
  ...T[11],
  color: C.text3,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
} as const;

const trailStyle = {
  "margin-left": "auto",
  display: "flex",
  "align-items": "center",
  gap: S[1],
  "flex-shrink": 0,
  "padding-left": S[1.5],
} as const;

const closeBtnStyle = {
  width: H.compact,
  height: H.compact,
  padding: "0",
  border: "none",
  cursor: "pointer",
  // Hover colour belongs to .bs-iconbtn — feed it through the slots.
  "--btn-bg": "transparent",
  "--btn-bg-hover": C.redBg,
  "--btn-fg": C.text3,
  "--btn-fg-hover": C.red,
} as const;

/**
 * Card treatment for a panel inside the shared right column: a 6px gutter on
 * three sides (matching the terminal card), 8px corners, one hairline and
 * `overflow: hidden` so the content clips to the rounding.
 *
 * The background is a parameter because the Side terminal is the exception —
 * its chrome stays --bg-1 so the xterm host (--bg-2, and it must equal
 * xtermTheme.background) reads as the content surface.
 */
export function panelCard(background: string = C.bg): JSX.CSSProperties {
  return {
    margin: `${S[1.5]} ${S[1.5]} 0`,
    "border-radius": R.md,
    border: `1px solid ${C.borderSub}`,
    background,
    overflow: "hidden",
    display: "flex",
    "flex-direction": "column",
    color: C.text,
    ...T[13],
  };
}
