import { Show, type JSX } from "solid-js";
import { C, S, T } from "../../theme";
import { Icon, type IconName } from "../../icons";

/**
 * An inline banner inside a panel: a transfer in flight, an error, a hint.
 *
 * One tinted band, one glyph, one line of --t-11 text. It is not a toast and
 * not a dialog — it sits in the flow, above the content it is talking about,
 * and never steals focus.
 */

export type NoticeTone = "info" | "success" | "warn" | "error";

const TONE: Record<NoticeTone, { fg: string; bg: string; icon: IconName }> = {
  info:    { fg: C.accent, bg: C.accentBg, icon: "activity" },
  success: { fg: C.green,  bg: C.greenBg,  icon: "check" },
  warn:    { fg: C.orange, bg: C.orangeBg, icon: "alert-triangle" },
  error:   { fg: C.red,    bg: C.redBg,    icon: "alert-triangle" },
};

interface Props {
  tone?: NoticeTone;
  /** Overrides the tone's default glyph. Pass `null` for no glyph at all. */
  icon?: IconName | null;
  children: JSX.Element;
}

export function Notice(props: Props) {
  const tone = () => TONE[props.tone ?? "info"];
  const icon = () => (props.icon === null ? null : props.icon ?? tone().icon);
  return (
    <div style={{ ...wrapStyle, color: tone().fg, background: tone().bg }}>
      <Show when={icon()}>
        {(name) => (
          <span style={{ display: "flex", "padding-top": "2px" }}>
            <Icon name={name()} size={12} stroke={2} />
          </span>
        )}
      </Show>
      <span style={{ "min-width": 0, flex: 1 }}>{props.children}</span>
    </div>
  );
}

const wrapStyle = {
  display: "flex",
  "align-items": "flex-start",
  gap: S[1.5],
  padding: `${S[1.5]} ${S[3]}`,
  ...T[11],
  "flex-shrink": 0,
  "white-space": "pre-wrap",
  "overflow-wrap": "anywhere",
} as const;
