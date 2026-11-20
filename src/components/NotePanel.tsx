import { gitWidth } from "../stores/git";
import { layoutMode } from "../stores/layout";
import { setTabNote, type Tab } from "../stores/tabs";
import { S, T } from "../theme";
import { PanelHeader, panelCard } from "./ui/PanelHeader";

export function NotePanel(props: { tab: Tab; onClose: () => void }) {
  return (
    <section
      aria-label={`Note for ${props.tab.name}`}
      style={{
        ...panelCard(),
        "min-height": "0",
        ...(layoutMode() === "right-split"
          ? { flex: 1 }
          : layoutMode() === "vertical"
            ? { height: "min(32vh, 220px)", "flex-shrink": 0 }
            : { width: `${gitWidth()}px`, "max-width": "45%", "flex-shrink": 0 }),
      }}
    >
      <PanelHeader
        icon="sticky-note"
        title="Note"
        meta={<span title={props.tab.name}>{props.tab.name}</span>}
        onClose={props.onClose}
        closeTitle="Close note"
      />
      <textarea
        aria-label={`Note for ${props.tab.name}`}
        class="bs-input"
        placeholder="Write a note for this tab…"
        value={props.tab.note ?? ""}
        onInput={(event) => setTabNote(props.tab.id, event.currentTarget.value)}
        style={{
          ...T[13],
          flex: 1,
          "min-height": 0,
          padding: S[2],
          margin: S[2],
          resize: "none",
        }}
      />
    </section>
  );
}
