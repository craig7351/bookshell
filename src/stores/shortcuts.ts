import { createSignal } from "solid-js";

// User-editable keybindings for tab navigation. Persisted via localStorage —
// these are frontend-only state, no Rust round-trip needed. Other hotkeys
// (Ctrl+Shift+T, Ctrl+1-9, Ctrl+Shift+P, etc.) remain hardcoded for now.

export interface Binding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string; // KeyboardEvent.key, normalized (PageUp, ArrowUp, etc.)
}

export type ActionId =
  | "prevTab"
  | "nextTab"
  | "moveTabPrev"
  | "moveTabNext";

export interface ActionDef {
  id: ActionId;
  label: string;
  desc: string;
}

export const ACTIONS: ActionDef[] = [
  { id: "prevTab",     label: "Previous tab",      desc: "Switch focus to the previous tab" },
  { id: "nextTab",     label: "Next tab",          desc: "Switch focus to the next tab" },
  { id: "moveTabPrev", label: "Move tab left",     desc: "Reorder active tab one position left (wraps)" },
  { id: "moveTabNext", label: "Move tab right",    desc: "Reorder active tab one position right (wraps)" },
];

const defaults: Record<ActionId, Binding[]> = {
  prevTab: [
    { ctrl: false, shift: true, alt: false, meta: false, key: "ArrowUp" },
    { ctrl: true, shift: false, alt: false, meta: false, key: "PageUp" },
  ],
  nextTab: [
    { ctrl: false, shift: true, alt: false, meta: false, key: "ArrowDown" },
    { ctrl: true, shift: false, alt: false, meta: false, key: "PageDown" },
  ],
  moveTabPrev: [
    { ctrl: true, shift: true, alt: false, meta: false, key: "PageUp" },
  ],
  moveTabNext: [
    { ctrl: true, shift: true, alt: false, meta: false, key: "PageDown" },
  ],
};

const STORAGE_KEY = "bookshell.shortcuts.v1";

function loadInitial(): Record<ActionId, Binding[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaults);
    const parsed = JSON.parse(raw) as Partial<Record<ActionId, Binding[]>>;
    const out = structuredClone(defaults);
    for (const id of Object.keys(defaults) as ActionId[]) {
      if (Array.isArray(parsed[id])) out[id] = parsed[id]!;
    }
    return out;
  } catch {
    return structuredClone(defaults);
  }
}

const [shortcuts, setShortcuts] = createSignal<Record<ActionId, Binding[]>>(loadInitial());
export { shortcuts };

function persist(next: Record<ActionId, Binding[]>) {
  setShortcuts(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("shortcuts persist", e);
  }
}

export function setBindings(action: ActionId, bindings: Binding[]) {
  persist({ ...shortcuts(), [action]: bindings });
}

export function resetAction(action: ActionId) {
  persist({ ...shortcuts(), [action]: structuredClone(defaults[action]) });
}

export function resetAll() {
  persist(structuredClone(defaults));
}

/** Does the keyboard event match this binding? */
export function matches(e: KeyboardEvent, b: Binding): boolean {
  return (
    e.ctrlKey === b.ctrl &&
    e.shiftKey === b.shift &&
    e.altKey === b.alt &&
    e.metaKey === b.meta &&
    e.key === b.key
  );
}

/** Returns the first action whose bindings include this event, or null. */
export function actionFor(e: KeyboardEvent): ActionId | null {
  const map = shortcuts();
  for (const id of Object.keys(map) as ActionId[]) {
    if (map[id].some((b) => matches(e, b))) return id;
  }
  return null;
}

/** Build a Binding from a captured KeyboardEvent. Returns null for modifier-only events. */
export function bindingFromEvent(e: KeyboardEvent): Binding | null {
  const key = e.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  return {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    key,
  };
}

/** Human-readable representation, e.g. "Ctrl+Shift+PageUp". */
export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  if (b.meta) parts.push("Meta");
  parts.push(prettyKey(b.key));
  return parts.join("+");
}

function prettyKey(k: string): string {
  switch (k) {
    case "ArrowUp": return "↑";
    case "ArrowDown": return "↓";
    case "ArrowLeft": return "←";
    case "ArrowRight": return "→";
    case " ": return "Space";
    default: return k.length === 1 ? k.toUpperCase() : k;
  }
}
