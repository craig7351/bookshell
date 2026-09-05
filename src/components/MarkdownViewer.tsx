import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { marked, type Renderer } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { C, RAW } from "../theme";
import { api } from "../ipc/api";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    // Driven by the shared design tokens so diagrams track the app theme.
    // These MUST come from RAW: mermaid derives shades with khroma, which
    // parses the strings as real colours and cannot resolve a var().
    primaryColor: RAW.accent,
    primaryTextColor: "#ffffff",
    primaryBorderColor: RAW.accent,
    lineColor: RAW.text2,
    secondaryColor: RAW.green,
    tertiaryColor: RAW.orange,
    background: RAW.bg2,
    mainBkg: RAW.bg4,
    nodeBorder: RAW.line,
    clusterBkg: RAW.bg1,
    titleColor: RAW.text1,
    edgeLabelBackground: RAW.bg4,
  },
});

// Inject the markdown viewer stylesheet once, generated from the shared design
// tokens (C) so it stays in sync with the app theme instead of hard-coding
// colors in index.html.
const MD_VIEWER_STYLE_ID = "md-viewer-styles";
if (typeof document !== "undefined" && !document.getElementById(MD_VIEWER_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = MD_VIEWER_STYLE_ID;
  style.textContent = `
    .md-viewer {
      color: ${C.text};
      font-size: 14px;
      line-height: 1.7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .md-viewer h1, .md-viewer h2, .md-viewer h3,
    .md-viewer h4, .md-viewer h5, .md-viewer h6 {
      margin: 1.2em 0 0.4em;
      font-weight: 600;
      line-height: 1.3;
    }
    .md-viewer h1 { font-size: 1.7em; color: ${C.cyan}; border-bottom: 1px solid ${C.border}; padding-bottom: 0.3em; }
    .md-viewer h2 { font-size: 1.35em; color: ${C.accent}; border-bottom: 1px solid ${C.border}; padding-bottom: 0.2em; }
    .md-viewer h3 { font-size: 1.1em; color: ${C.green}; }
    .md-viewer h4 { color: ${C.orange}; }
    .md-viewer h5, .md-viewer h6 { color: ${C.purple}; }
    .md-viewer p { margin: 0.7em 0; }
    .md-viewer strong { color: ${C.yellow}; }
    .md-viewer em { color: ${C.orange}; font-style: italic; }
    .md-viewer a { color: ${C.accent}; text-decoration: none; }
    .md-viewer a:hover { color: ${C.cyan}; text-decoration: underline; }
    .md-viewer code {
      background: ${C.accentBg};
      border: 1px solid ${C.accentBdr};
      border-radius: 4px;
      padding: 0.15em 0.4em;
      font-size: 0.88em;
      font-family: "SF Mono", "JetBrains Mono", "Cascadia Code", monospace;
      color: ${C.cyan};
    }
    .md-viewer pre {
      border: 1px solid ${C.border};
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
      padding: 0;
    }
    .md-viewer pre code.hljs {
      border-radius: 8px;
      font-size: 0.85em;
      font-family: "SF Mono", "JetBrains Mono", "Cascadia Code", monospace;
      padding: 14px 16px;
    }
    /* inline code styling must not apply inside code blocks */
    .md-viewer pre code { background: none; border: none; padding: 0; color: inherit; }
    .md-viewer blockquote {
      border-left: 3px solid ${C.accent};
      margin: 0.8em 0;
      padding: 0.2em 1em;
      color: ${C.text2};
      background: ${C.accentBg};
      border-radius: 0 6px 6px 0;
    }
    .md-viewer ul, .md-viewer ol { padding-left: 1.6em; margin: 0.5em 0; }
    .md-viewer li { margin: 0.25em 0; }
    .md-viewer li::marker { color: ${C.accent}; }
    .md-viewer table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
    .md-viewer th, .md-viewer td { border: 1px solid ${C.border}; padding: 6px 12px; text-align: left; }
    .md-viewer th { background: ${C.accentBg}; color: ${C.cyan}; font-weight: 600; }
    .md-viewer tr:nth-child(even) { background: rgba(255,255,255,0.03); }
    .md-viewer img { max-width: 100%; border-radius: 6px; }
    .md-viewer hr { border: none; border-top: 1px solid ${C.border}; margin: 1.5em 0; }
    .md-viewer .mermaid-pending svg,
    .md-viewer svg[id^="mermaid-"] {
      max-width: 100%;
      background: ${C.bg};
      border-radius: 8px;
      padding: 12px;
      margin: 0.8em 0;
      display: block;
    }
  `;
  document.head.appendChild(style);
}

// Custom renderer: mermaid → placeholder, others → highlight.js.
const renderer: Partial<Renderer> = {
  code({ text, lang }) {
    if (lang === "mermaid") {
      return `<div class="mermaid-pending" data-graph="${encodeURIComponent(text)}"></div>`;
    }
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(text, { language }).value;
    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
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

  createEffect(() => {
    const md = content();
    if (md === null || !containerRef) return;

    // Guard against the race where the file is switched mid-render: an earlier
    // effect's async work (marked + sequential mermaid renders) could otherwise
    // overwrite the newer content. onCleanup runs synchronously when the effect
    // re-runs, flipping this flag so the stale pass bails before each write.
    let cancelled = false;
    onCleanup(() => { cancelled = true; });

    (async () => {
      const html = await marked.parse(md);
      // Sanitize untrusted markdown (file content can come from any repo) before
      // injecting as HTML. data-*/class are kept, so the mermaid placeholders
      // below still resolve.
      const safe = DOMPurify.sanitize(html);
      if (cancelled || !containerRef) return;
      containerRef.innerHTML = safe;

      // Render mermaid blocks sequentially.
      const nodes = containerRef.querySelectorAll<HTMLElement>(".mermaid-pending");
      for (const node of nodes) {
        if (cancelled) return;
        const graph = decodeURIComponent(node.dataset.graph ?? "");
        if (!graph) continue;
        const id = `mermaid-${++mermaidCounter}`;
        try {
          const { svg } = await mermaid.render(id, graph);
          if (cancelled) return;
          node.innerHTML = svg;
          node.classList.remove("mermaid-pending");
        } catch (err) {
          if (cancelled) return;
          node.innerHTML = `<pre style="color:${C.red};font-size:11px">${String(err)}</pre>`;
        }
      }
    })();
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
