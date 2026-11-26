import { createSignal } from "solid-js";
import { api, type GeneralSettings } from "../ipc/api";

export const defaultTerminalAppearance = {
  font_size: 14,
  side_font_size: 14,
  terminal_font_family: null,
  terminal_palette: null,
  terminal_foreground: null,
  terminal_background: null,
} as const;

const defaults: GeneralSettings = {
  ...defaultTerminalAppearance,
  scrollback: 10000,
  git_poll_secs: 5,
  tab_position: "left",
  ai_alerts: true,
};

const [general, setGeneral] = createSignal<GeneralSettings>(defaults);
export { general };

let pendingSave = Promise.resolve();

export async function loadGeneral() {
  try {
    const loaded = await api.generalGet();
    // Anything other than "top" (missing, hand-edited) falls back to the sidebar.
    setGeneral({ ...loaded, tab_position: loaded.tab_position === "top" ? "top" : "left" });
  } catch (e) {
    console.error("loadGeneral", e);
    setGeneral(defaults);
  }
}

export function updateGeneral(patch: Partial<GeneralSettings>): Promise<boolean> {
  const save = pendingSave.then(async () => {
    const next = { ...general(), ...patch };
    try {
      await api.generalSet(next);
      setGeneral(next);
      return true;
    } catch (e) {
      console.error("updateGeneral", e);
      return false;
    }
  });
  pendingSave = save.then(() => {});
  return save;
}
