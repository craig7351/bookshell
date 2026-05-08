import { createSignal } from "solid-js";
import { api, type CommandButton } from "../ipc/api";

const [buttons, setButtons] = createSignal<CommandButton[]>([]);
export { buttons };

export async function loadButtons() {
  try {
    setButtons(await api.buttonsList());
  } catch (e) {
    console.error("loadButtons", e);
    setButtons([]);
  }
}

export async function saveButton(b: CommandButton) {
  await api.buttonsSave(b);
  await loadButtons();
}

export async function removeButton(id: string) {
  await api.buttonsDelete(id);
  await loadButtons();
}

export async function reorderButtons(ids: string[]) {
  await api.buttonsReorder(ids);
  await loadButtons();
}

export async function moveButton(id: string, delta: -1 | 1) {
  const arr = [...buttons()];
  const idx = arr.findIndex((b) => b.id === id);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= arr.length) return;
  const [moved] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, moved);
  setButtons(arr);
  await api.buttonsReorder(arr.map((b) => b.id)).catch((e) => {
    console.error("moveButton persist failed", e);
    loadButtons();
  });
}

export function newButtonId(): string {
  return `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
