import type { JSX } from "solid-js";

interface Props {
  /** The shortcut text, e.g. `Ctrl+Shift+T`. Rendered verbatim. */
  children: JSX.Element;
}

/**
 * A keyboard-shortcut chip. Semantics live in the element (`<kbd>`) and the
 * whole look — surface, hairline, mono face, --t-10 — lives in the `kbd` rule
 * in styles/base.css, so a `<kbd>` written anywhere else (a dialog, a Notice,
 * rendered Markdown) gets the same chip without importing this component.
 */
export function Kbd(props: Props) {
  return <kbd>{props.children}</kbd>;
}
