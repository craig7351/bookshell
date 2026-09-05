import { Show, type JSX } from "solid-js";
import { C, R, S, T } from "../../theme";
import { Icon, type IconName } from "../../icons";

/**
 * The one "there is nothing here" block for a panel.
 *
 * Deliberately quiet: a 28px --text-4 glyph, a --t-13/500 title, a --t-12
 * --text-3 explanation and at most one action. It never competes with the
 * content that will replace it. (The app-shell hero in App.tsx is a different
 * animal — 40px glyph, radial wash — and stays where it is.)
 */

interface Props {
  icon: IconName;
  title: string;
  /** One sentence. Wraps at 260px so it never stretches a narrow panel. */
  description?: JSX.Element;
  /** A single call to action, already styled by button(). */
  action?: JSX.Element;
}

export function EmptyState(props: Props) {
  return (
    <div style={wrapStyle}>
      <span style={{ color: C.text4, display: "flex" }}>
        <Icon name={props.icon} size={28} />
      </span>
      <span style={titleStyle}>{props.title}</span>
      <Show when={props.description}>
        <span style={descStyle}>{props.description}</span>
      </Show>
      <Show when={props.action}>
        <span style={{ "margin-top": S[1] }}>{props.action}</span>
      </Show>
    </div>
  );
}

/**
 * Loading placeholder: four bars breathing in place, so a slow `git status`
 * or SFTP listing shows the shape of the answer instead of a spinner. Widths
 * are staggered to read as text rather than as a progress bar.
 */
export function Skeleton(props: { rows?: number }) {
  const widths = ["92%", "68%", "84%", "54%", "76%", "62%"];
  const n = () => props.rows ?? 4;
  return (
    <div style={skeletonWrap} aria-hidden="true">
      {Array.from({ length: n() }, (_, i) => (
        <span
          class="bs-breathe"
          style={{ ...skeletonBar, width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

const wrapStyle = {
  padding: "40px 20px",
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "text-align": "center",
  gap: S[2],
} as const;

const titleStyle = {
  ...T[13],
  "font-weight": 500,
  color: C.text,
} as const;

const descStyle = {
  ...T[12],
  color: C.text3,
  "max-width": "260px",
} as const;

const skeletonWrap = {
  display: "flex",
  "flex-direction": "column",
  gap: S[2],
  padding: `${S[3]} ${S[3]}`,
} as const;

const skeletonBar = {
  display: "block",
  height: "12px",
  "border-radius": R.sm,
  background: C.bg3,
  "flex-shrink": 0,
} as const;
