import { createSignal } from "solid-js";

/** File browser panel state.
 *
 *  The panel renders inside the same right column as Git / Side terminal (or
 *  inline in horizontal/vertical layouts), so it always targets the active
 *  tab — switching tabs swaps content automatically via activeTab().
 */
const [open, setOpen] = createSignal(false);
const [showHidden, setShowHidden] = createSignal(false);
const [width, setWidth] = createSignal(380);

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

/** Whether dotfiles (names starting with ".") are shown in the listing. */
export const filesShowHidden = showHidden;
export function toggleFilesShowHidden() {
  setShowHidden((v) => !v);
}

/** Width of the inline file-browser panel (horizontal/vertical layouts). The
 *  right-split layout ignores this and uses the shared Git column width. */
export const filesWidth = width;
export function setFilesWidth(w: number) {
  setWidth(Math.max(260, Math.min(900, w)));
}
