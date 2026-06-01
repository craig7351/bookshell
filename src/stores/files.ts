import { createSignal } from "solid-js";

/** Whether the file-browser modal is open. It always targets the active tab's
 *  session; the FileBrowser component captures that tab when it mounts. */
const [open, setOpen] = createSignal(false);

export const filesOpen = open;
export function openFiles() {
  setOpen(true);
}
export function closeFiles() {
  setOpen(false);
}
export function toggleFiles() {
  setOpen((v) => !v);
}
