import { createEffect, createSignal, onMount, Show } from "solid-js";
import { marked, type Renderer } from "marked";
import mermaid from "mermaid";
import { C } from "../theme";
import { api } from "../ipc/api";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#1c1c1e",
    mainBkg: "#2c2c2e",
    nodeBorder: "#48484a",
    lineColor: "#98989d",
    primaryTextColor: "#f2f2f7",
    secondaryTextColor: "#ebebf5",
    tertiaryTextColor: "#ebebf5",
  },
});

// Custom renderer: mermaid code blocks → placeholder divs rendered later.
const renderer: Partial<Renderer> = {
  code({ text, lang }) {
    if (lang === "mermaid") {
      return `<div class="mermaid-pending" data-graph="${encodeURIComponent(text)}"></div>`;
    }
    return `<pre><code class="lang-${lang ?? ""}">${text}</code></pre>`;
  },
};
marked.use({ renderer });

let mermaidCounter = 0;

interface Props {
  sessionId: string;
  cwd: string;
  path: string;
  /** undefined = working tree, "staged" = index, any hash = commit */
  rev?: string;
}

export function MarkdownViewer(props: Props) {
  const [content, setContent] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let containerRef!: HTMLDivElement;

  onMount(() => {
    api.gitShowFileContent(props.sessionId, props.cwd, props.path, props.rev)
      .then((text) => setContent(text))
      .catch((e) => setError(String(e)));
  });

  createEffect(async () => {
    const md = content();
    if (md === null || !containerRef) return;
    const html = await marked.parse(md);
    containerRef.innerHTML = html;

    // Render mermaid blocks sequentially.
    const nodes = containerRef.querySelectorAll<HTMLElement>(".mermaid-pending");
    for (const node of nodes) {
      const graph = decodeURIComponent(node.dataset.graph ?? "");
      if (!graph) continue;
      const id = `mermaid-${++mermaidCounter}`;
      try {
        const { svg } = await mermaid.render(id, graph);
        node.innerHTML = svg;
        node.classList.remove("mermaid-pending");
      } catch (err) {
        node.innerHTML = `<pre style="color:${C.red};font-size:11px">${String(err)}</pre>`;
      }
    }
  });

  return (
    <div style={{
      flex: 1,
      "overflow-y": "auto",
      padding: "20px 28px",
      "min-width": 0,
    }}>
      <Show when={!content() && !error()}>
        <div style={{ opacity: 0.5, "font-size": "13px" }}>Loading…</div>
      </Show>
      <Show when={error()}>
        <div style={{ color: C.red, "font-size": "12px" }}>{error()}</div>
      </Show>
      <div ref={containerRef!} class="md-viewer" />
    </div>
  );
}

