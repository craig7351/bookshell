import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { marked, type Renderer } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { C, FONT, M, R, RAW, S } from "../theme";
import { Skeleton } from "./ui/EmptyState";
import { Notice } from "./ui/Notice";
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
    // Diagram labels are UI text, not prose: same family and size as the rest
    // of the chrome, so a graph does not read as a screenshot pasted in.
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontSize: "13px",
  },
});

// Inject the markdown viewer stylesheet once, generated from the shared design
// tokens (C) so it stays in sync with the app theme instead of hard-coding
// colors in index.html. This is a real <style> element, so C's var() strings
// resolve normally — the ONLY exception is the highlight.js palette, which is
// a JS table (RAW.hljs) and is interpolated as pure hex.
const MD_VIEWER_STYLE_ID = "md-viewer-styles";
if (typeof document !== "undefined" && !document.getElementById(MD_VIEWER_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = MD_VIEWER_STYLE_ID;
  style.textContent = `
    /* ---------------------------------------------------------- prose */
    .md-viewer {
      color: ${C.text2};
      font-size: 14px;
      line-height: 1.7;
      font-family: ${FONT.ui};
      max-width: 760px;
    }
    /* One colour rule for the whole document: headings and body text are
       tiers of the same neutral, and only a link is allowed to be blue. */
    .md-viewer h1, .md-viewer h2, .md-viewer h3,
    .md-viewer h4, .md-viewer h5, .md-viewer h6 {
      color: ${C.text};
      margin: 1.6em 0 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    .md-viewer > :first-child { margin-top: 0; }
    .md-viewer h1 {
      font-size: 24px;
      font-weight: 650;
      letter-spacing: -0.01em;
      border-bottom: 1px solid ${C.border};
      padding-bottom: 0.4em;
    }
    .md-viewer h2 {
      font-size: 19px;
      border-bottom: 1px solid ${C.borderSub};
      padding-bottom: 0.3em;
    }
    .md-viewer h3 { font-size: 16px; }
    .md-viewer h4 { font-size: 14px; }
    .md-viewer h5, .md-viewer h6 {
      font-size: 12px;
      color: ${C.text2};
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .md-viewer p { margin: 0.8em 0; }
    .md-viewer strong { color: inherit; font-weight: 600; }
    .md-viewer em { color: inherit; font-style: italic; }
    .md-viewer a { color: ${C.accent}; text-decoration: none; }
    .md-viewer a:hover { text-decoration: underline; }
    .md-viewer ul, .md-viewer ol { padding-left: 1.5em; margin: 0.6em 0; }
    .md-viewer li { margin: 0.25em 0; }
    .md-viewer li::marker { color: ${C.text4}; }
    .md-viewer blockquote {
      border-left: 3px solid ${C.border};
      margin: 1em 0;
      padding: 0.1em 0 0.1em 1em;
      color: ${C.text2};
    }
    .md-viewer hr { border: none; border-top: 1px solid ${C.borderSub}; margin: 2em 0; }
    .md-viewer img { max-width: 100%; border-radius: ${R.sm}; }

    /* ----------------------------------------------------------- code */
    .md-viewer code {
      background: ${C.bgActive};
      border-radius: ${R.xs};
      padding: 0.1em 0.35em;
      font-size: 0.88em;
      font-family: ${FONT.mono};
      color: ${C.text};
    }
    .md-viewer pre {
      position: relative;
      background: ${C.bg2};
      border: 1px solid ${C.borderSub};
      border-radius: ${R.md};
      overflow-x: auto;
      margin: 1.2em 0;
      padding: 0;
    }
    /* The language tag sits in the block's own top-right corner rather than in
       a header strip, so a code block stays one shape. */
    .md-viewer pre[data-lang]::before {
      content: attr(data-lang);
      position: absolute;
      top: 6px;
      right: 10px;
      font-size: 11px;
      line-height: 16px;
      font-family: ${FONT.mono};
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${C.text4};
      pointer-events: none;
    }
    .md-viewer pre code.hljs {
      display: block;
      font-size: 13px;
      line-height: 1.55;
      font-family: ${FONT.mono};
      padding: 14px 16px;
      background: none;
    }
    /* inline code styling must not apply inside code blocks */
    .md-viewer pre code { background: none; border: none; padding: 0; color: inherit; }

    /* --------------------------------------------------------- tables */
    /* display:block turns the table into its own horizontal scroller, so a
       wide table never widens the document column. */
    .md-viewer table {
      display: block;
      width: max-content;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 1.2em 0;
      font-size: 13px;
    }
    .md-viewer th, .md-viewer td {
      padding: 6px 12px;
      text-align: left;
      border-bottom: 1px solid ${C.borderSub};
    }
    .md-viewer th {
      background: none;
      color: ${C.text};
      font-weight: 600;
      border-bottom: 1px solid ${C.border};
    }

    /* -------------------------------------------------------- mermaid */
    /* Reserve the block's height before the graph exists, so the document
       does not jump when an async render lands. */
    .md-viewer .mermaid-pending {
      min-height: 96px;
      border-radius: ${R.md};
      background: ${C.bg2};
      margin: 1.2em 0;
    }
    .md-viewer svg[id^="mermaid-"] {
      max-width: 100%;
      background: ${C.bg2};
      border: 1px solid ${C.borderSub};
      border-radius: ${R.md};
      padding: 12px;
      margin: 1.2em 0;
      display: block;
    }

    /* -------------------------------------------- highlight.js (Xcode) */
    /* Replaces the github-dark stylesheet that used to be linked out of
       node_modules — colours come from RAW.hljs (pure hex, see theme.ts). */
    .md-viewer .hljs { color: ${C.text}; background: none; }
    .md-viewer .hljs-comment,
    .md-viewer .hljs-quote { color: ${RAW.hljs.comment}; font-style: italic; }
    .md-viewer .hljs-keyword,
    .md-viewer .hljs-selector-tag,
    .md-viewer .hljs-literal,
    .md-viewer .hljs-doctag { color: ${RAW.hljs.keyword}; }
    .md-viewer .hljs-string,
    .md-viewer .hljs-regexp,
    .md-viewer .hljs-symbol,
    .md-viewer .hljs-char { color: ${RAW.hljs.string}; }
    .md-viewer .hljs-number,
    .md-viewer .hljs-bullet { color: ${RAW.hljs.number}; }
    .md-viewer .hljs-title,
    .md-viewer .hljs-title.function_,
    .md-viewer .hljs-section { color: ${RAW.hljs.function}; }
    .md-viewer .hljs-type,
    .md-viewer .hljs-title.class_,
    .md-viewer .hljs-built_in,
    .md-viewer .hljs-class .hljs-title { color: ${RAW.hljs.type}; }
    .md-viewer .hljs-attr,
    .md-viewer .hljs-attribute,
    .md-viewer .hljs-property,
    .md-viewer .hljs-variable,
    .md-viewer .hljs-template-variable { color: ${RAW.hljs.attr}; }
    .md-viewer .hljs-name,
    .md-viewer .hljs-selector-id,
    .md-viewer .hljs-selector-class { color: ${RAW.hljs.type}; }
    .md-viewer .hljs-meta { color: ${RAW.hljs.attr}; }
    .md-viewer .hljs-tag,
    .md-viewer .hljs-params,
    .md-viewer .hljs-punctuation { color: ${C.text2}; }
    .md-viewer .hljs-deletion { color: ${C.red}; }
    .md-viewer .hljs-addition { color: ${C.green}; }
    .md-viewer .hljs-link { color: ${C.accent}; text-decoration: underline; }
    .md-viewer .hljs-emphasis { font-style: italic; }
    .md-viewer .hljs-strong { font-weight: 600; }
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
    // data-lang drives the corner tag in CSS; DOMPurify keeps data-* attributes.
    const tag = language === "plaintext" ? "" : ` data-lang="${language}"`;
    return `<pre${tag}><code class="hljs language-${language}">${highlighted}</code></pre>`;
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
          node.innerHTML = `<pre style="color:${C.red}">${String(err)}</pre>`;
        }
      }
    })();
  });

  return (
    <div style={scrollStyle}>
      <Show when={!content() && !error()}>
        <Skeleton rows={6} />
      </Show>
      <Show when={error()}>
        <div style={{ "border-radius": R.sm, overflow: "hidden", "margin-bottom": S[3] }}>
          <Notice tone="error">{error()}</Notice>
        </div>
      </Show>
      <div
        ref={containerRef!}
        class="md-viewer"
        style={{
          // Fades in once, when the parsed document replaces the skeleton.
          animation: content() ? `bs-fade-in ${M.d3} ${M.ease} both` : undefined,
        }}
      />
    </div>
  );
}

/** Document margins: generous sides, a deep bottom so the last line is not
 *  glued to the panel edge. The 760px measure lives on .md-viewer itself. */
const scrollStyle = {
  flex: 1,
  "overflow-y": "auto",
  padding: "28px 32px 56px",
  "min-width": 0,
} as const;
