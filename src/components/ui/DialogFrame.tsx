import { Show, type JSX } from "solid-js";
import { C, M, R, S, SH, T } from "../../theme";
import { CloseGlyph } from "../CloseX";

/**
 * The one modal shell in the app.
 *
 * Anatomy, frozen so five dialogs cannot drift apart again:
 *
 *   ┌────────────┬──────────────────────────────────────────┐
 *   │            │ header  48px · t-15/600 title · ✕        │
 *   │  sidebar?  ├──────────────────────────────────────────┤
 *   │            │ body    flex:1, scrolls, 16px 20px       │
 *   │            ├──────────────────────────────────────────┤
 *   │            │ footer? border-top --line-sub            │
 *   └────────────┴──────────────────────────────────────────┘
 *
 * The frame itself never scrolls (`overflow: hidden` + `max-height: 85vh`), so
 * a long list moves under a title and a footer that stay put. Elevation is the
 * app-wide recipe — opaque `--bg-3`, `--sh-3` + `--hl-top`, no blur anywhere.
 */

interface Props {
  /** Visible heading. Keep it a short noun phrase. */
  title: JSX.Element;
  /** Accessible name when `title` is markup rather than a bare string. */
  label?: string;
  onClose: () => void;
  /** Clicking the scrim closes the dialog. Default true. */
  dismissOnScrim?: boolean;
  width?: string;
  height?: string;
  /** Extra overlay properties — a z-index bump, nothing else. */
  overlay?: JSX.CSSProperties;
  /** Full-height column to the left of the header / body / footer stack. */
  sidebar?: JSX.Element;
  /** Controls at the right end of the header, before the ✕. */
  actions?: JSX.Element;
  /** Sticky bar below the body. */
  footer?: JSX.Element;
  /** Body padding override (the Settings panes want their own rhythm). */
  bodyPadding?: string;
  /** Handed the frame element — dialogs that must steal focus from xterm. */
  ref?: (el: HTMLDivElement) => void;
  children: JSX.Element;
}

export function DialogFrame(props: Props) {
  return (
    <div
      style={{ ...overlayStyle, ...(props.overlay ?? {}) }}
      onClick={() => {
        if (props.dismissOnScrim !== false) props.onClose();
      }}
    >
      <div
        ref={props.ref}
        role="dialog"
        aria-modal="true"
        aria-label={props.label ?? (typeof props.title === "string" ? props.title : undefined)}
        tabindex="-1"
        class="bs-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...frameStyle,
          width: props.width ?? "auto",
          ...(props.height ? { height: props.height } : {}),
        }}
      >
        <Show when={props.sidebar}>
          <div style={sidebarStyle}>{props.sidebar}</div>
        </Show>
        <div style={columnStyle}>
          <div style={headerStyle}>
            <div style={titleStyle}>{props.title}</div>
            <Show when={props.actions}>
              <div style={actionsStyle}>{props.actions}</div>
            </Show>
            <button
              class="bs-iconbtn bs-tip bs-tip-start"
              onClick={props.onClose}
              data-tip="Close (Esc)"
              aria-label="Close"
              style={closeStyle}
            >
              <CloseGlyph size="md" />
            </button>
          </div>
          <div style={{ ...bodyStyle, ...(props.bodyPadding ? { padding: props.bodyPadding } : {}) }}>
            {props.children}
          </div>
          <Show when={props.footer}>
            <div style={footerStyle}>{props.footer}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: JSX.CSSProperties = {
  position: "fixed",
  inset: "0",
  background: C.scrim,
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "z-index": "100",
};

const frameStyle: JSX.CSSProperties = {
  position: "relative",
  display: "flex",
  background: C.overlay,
  color: C.text,
  border: `1px solid ${C.border}`,
  "border-radius": R.xl,
  "box-shadow": `${SH.e3}, ${SH.hlTop}`,
  padding: "0",
  "max-width": "92vw",
  "max-height": "85vh",
  overflow: "hidden",
  outline: "none",
  animation: `bs-pop-in ${M.d3} ${M.easePop} both`,
};

const sidebarStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "flex-shrink": 0,
  "border-right": `1px solid ${C.borderSub}`,
};

const columnStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  flex: 1,
  "min-width": 0,
  "min-height": 0,
};

const headerStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  height: "48px",
  "flex-shrink": 0,
  padding: `0 ${S[2]} 0 ${S[5]}`,
};

const titleStyle: JSX.CSSProperties = {
  ...T[15],
  "font-weight": 600,
  color: C.text,
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

const actionsStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[2],
  "flex-shrink": 0,
};

/** Same slot recipe as CloseX — colour is the class's job, never inline. */
const closeStyle: JSX.CSSProperties = {
  width: "22px",
  height: "22px",
  padding: "0",
  border: "none",
  cursor: "pointer",
  "flex-shrink": 0,
  "--btn-bg": "transparent",
  "--btn-bg-hover": C.redBg,
  "--btn-fg": C.text3,
  "--btn-fg-hover": C.red,
};

const bodyStyle: JSX.CSSProperties = {
  flex: 1,
  "min-height": 0,
  overflow: "auto",
  padding: `${S[4]} ${S[5]}`,
};

const footerStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "flex-end",
  gap: S[2],
  "flex-shrink": 0,
  padding: `${S[3]} ${S[5]}`,
  "border-top": `1px solid ${C.borderSub}`,
};
