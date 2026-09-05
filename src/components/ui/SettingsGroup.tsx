import { Show, type JSX } from "solid-js";
import { C, R, S, T, TYPO } from "../../theme";

/**
 * The two blocks every Settings pane is built from.
 *
 * `SettingsGroup` is an uppercase section label over one `--bg-4` card
 * (`--r-md`, one `--line-sub` hairline, `overflow: hidden`). `SettingsRow` is
 * one line inside it: a fixed label column, an optional hint under the label,
 * and the control on the right.
 *
 * The dividers between rows come from the `.bs-settings-group` rule in
 * base.css (`> * + *`), not from an inline `border-top` — that way the first
 * row never doubles up with the card's own edge and a pane can drop a row in
 * or out without re-deciding who draws the line.
 */

interface GroupProps {
  /** Uppercase section label above the card. Omit for an unlabelled card. */
  label?: string;
  /** Control at the right end of the label row (a "Reset all", say). */
  actions?: JSX.Element;
  children: JSX.Element;
}

export function SettingsGroup(props: GroupProps) {
  return (
    <div style={wrapStyle}>
      <Show when={props.label || props.actions}>
        <div style={labelRowStyle}>
          <div style={TYPO.section}>{props.label}</div>
          <Show when={props.actions}>
            <div style={{ display: "flex", "align-items": "center", gap: S[2] }}>
              {props.actions}
            </div>
          </Show>
        </div>
      </Show>
      <div class="bs-settings-group" style={cardStyle}>
        {props.children}
      </div>
    </div>
  );
}

interface RowProps {
  /** Left column. A short noun, sentence case. */
  label?: JSX.Element;
  /** One line under the label explaining the unit or the consequence. */
  hint?: JSX.Element;
  /** Width of the label column. Defaults to 160px. */
  labelWidth?: string;
  /** Vertical stack instead of label | control (a long description block). */
  stacked?: boolean;
  children?: JSX.Element;
}

export function SettingsRow(props: RowProps) {
  return (
    <div style={props.stacked ? stackedRowStyle : rowStyle}>
      <Show when={props.label !== undefined || props.hint !== undefined}>
        <div
          style={
            props.stacked
              ? { "min-width": 0 }
              : { width: props.labelWidth ?? "160px", "flex-shrink": 0, "min-width": 0 }
          }
        >
          <Show when={props.label !== undefined}>
            <div style={labelStyle}>{props.label}</div>
          </Show>
          <Show when={props.hint !== undefined}>
            <div style={hintStyle}>{props.hint}</div>
          </Show>
        </div>
      </Show>
      <Show when={props.children !== undefined}>
        <div style={props.stacked ? { "min-width": 0 } : controlStyle}>{props.children}</div>
      </Show>
    </div>
  );
}

const wrapStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: S[2],
  "min-width": 0,
};

const labelRowStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  gap: S[2],
};

const cardStyle: JSX.CSSProperties = {
  background: C.bg3,
  border: `1px solid ${C.borderSub}`,
  "border-radius": R.md,
  overflow: "hidden",
};

const rowStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[3],
  padding: "10px 14px",
  "min-width": 0,
};

const stackedRowStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: S[1.5],
  padding: "10px 14px",
  "min-width": 0,
};

const labelStyle: JSX.CSSProperties = {
  ...T[13],
  "font-weight": 500,
  color: C.text,
};

const hintStyle: JSX.CSSProperties = {
  ...T[11],
  color: C.text3,
};

const controlStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: S[1.5],
  flex: 1,
  "min-width": 0,
  "flex-wrap": "wrap",
};
