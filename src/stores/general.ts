import { createSignal } from "solid-js";
import { api, type GeneralSettings } from "../ipc/api";

const defaults: GeneralSettings = {
  scrollback: 10000,
  font_size: 14,
  side_font_size: 14,
  git_poll_secs: 5,
  terminal_palette: "macos-dark",
};

const [general, setGeneral] = createSignal<GeneralSettings>(defaults);
export { general };

export async function loadGeneral() {
  try {
    setGeneral(await api.generalGet());
  } catch (e) {
    console.error("loadGeneral", e);
    setGeneral(defaults);
  }
}

export async function updateGeneral(patch: Partial<GeneralSettings>) {
  const next = { ...general(), ...patch };
  setGeneral(next);
  try {
    await api.generalSet(next);
  } catch (e) {
    console.error("updateGeneral", e);
  }
}
