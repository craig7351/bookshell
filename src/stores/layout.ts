import { createSignal } from "solid-js";

export type LayoutMode = "horizontal" | "vertical" | "right-split";

const CYCLE: LayoutMode[] = ["horizontal", "vertical", "right-split"];

const [layoutMode, setLayoutMode] = createSignal<LayoutMode>("horizontal");

export { layoutMode };

export function cycleLayout() {
  const next = CYCLE[(CYCLE.indexOf(layoutMode()) + 1) % CYCLE.length];
  setLayoutMode(next);
}

export function setLayout(mode: LayoutMode) {
  setLayoutMode(mode);
}

/** True when panels sit below the terminal (vertical or right-split column). */
export const layoutVertical = () => layoutMode() === "vertical";
