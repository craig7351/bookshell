import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import {
  api,
  type ClaudeBlock,
  type ClaudeCursor,
  type ClaudeMessage,
  type ClaudeSession,
  type ClaudeSource,
} from "../ipc/api";
import { tabConnectionKind, type Tab } from "../stores/tabs";
import { Icon } from "../icons";
import { button, C, S, T } from "../theme";
import { PanelHeader } from "./ui/PanelHeader";
import { Notice } from "./ui/Notice";
import "../styles/claude-chat.css";
import chatStyles from "../styles/claude-chat.css?inline";
import tokens from "../styles/tokens.css?inline";

export interface ClaudeBinding {
  source: ClaudeSource;
  project: string;
  session: ClaudeSession;
}

interface Props {
  tab: Tab;
  initialBinding?: ClaudeBinding;
  onBind: (binding: ClaudeBinding) => void;
  onClose: () => void;
}

export default function ClaudeChatPanel(props: Props) {
  const [binding, setBinding] = createSignal(props.initialBinding);
  const [choosing, setChoosing] = createSignal(false);
  const source = createMemo<ClaudeSource | null>(() => {
    if (tabConnectionKind(props.tab) === "local") return { sshSessionId: null };
    return props.tab.status === "connected" && props.tab.sessionId
      ? { sshSessionId: props.tab.sessionId }
      : null;
  });
  const selected = () => binding()?.source.sshSessionId === source()?.sshSessionId ? binding() : undefined;
  const conversation = () => choosing() ? undefined : selected();
  let surface!: HTMLElement;
  onMount(() => surface.focus());

  return (
    <section ref={surface} class="bs-claude-chat" aria-label="Claude Code chat" tabindex={-1}>
      <PanelHeader
        icon="message-square"
        title="Claude Chat"
        meta={props.tab.name}
        onClose={props.onClose}
        closeTitle="Back to terminal"
        actions={
          <Show when={selected() && source()}>
            <button
              class="bs-btn"
              onClick={() => setChoosing((value) => !value)}
              style={button("ghost", "compact")}
            >
              {choosing() ? "Back to chat" : "Change session"}
            </button>
          </Show>
        }
      />
      <Show when={source()} fallback={
        <div class="bs-chat-picker">
          <Notice tone="info">Connect this SSH tab from the terminal to open its Claude sessions.</Notice>
          <button class="bs-btn" style={button("secondary", "compact")} onClick={props.onClose}>
            Back to terminal
          </button>
        </div>
      }>
        <Show when={conversation()} keyed fallback={
          <SessionPicker
            source={source()!}
            cwd={props.tab.cwd}
            initial={selected()}
            onChoose={(item) => {
              setBinding(item);
              props.onBind(item);
              setChoosing(false);
            }}
          />
        }>
          {(item) => <Conversation binding={item} />}
        </Show>
      </Show>
    </section>
  );
}

function projectHint(cwd: string | null | undefined) {
  return cwd?.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

function sessionDate(timestamp: number) {
  return timestamp > 0 ? new Date(timestamp * 1000).toLocaleString() : "";
}

function SessionPicker(props: {
  source: ClaudeSource;
  cwd?: string | null;
  initial?: ClaudeBinding;
  onChoose: (binding: ClaudeBinding) => void;
}) {
  const [folder, setFolder] = createSignal(props.initial?.source.configDir ?? "");
  const [configDir, setConfigDir] = createSignal(folder());
  const [selectedProject, setSelectedProject] = createSignal(props.initial?.project);
  const [previews, setPreviews] = createSignal(false);
  const [offset, setOffset] = createSignal(0);
  const [previousOffsets, setPreviousOffsets] = createSignal<number[]>([]);
  const source = createMemo<ClaudeSource>(() => ({ ...props.source, configDir: configDir() || undefined }));
  const [projects, { refetch }] = createResource(source, api.claudeProjects);
  // A failed resource throws on read. Keep its error local to this view.
  const projectNames = () => projects.error || projects.loading ? [] : projects() ?? [];
  const project = () => {
    const names = projectNames();
    const hint = projectHint(props.cwd);
    return names.find((name) => name === selectedProject())
      ?? names.find((name) => name.toLowerCase() === hint)
      ?? names[0];
  };
  const [sessions, { refetch: refreshSessions }] = createResource(
    () => {
      const name = project();
      return name ? { source: source(), name, offset: offset(), previews: previews() } : false;
    },
    (request) => api.claudeSessions(request.source, request.name, request.offset, request.previews),
  );
  const results = () => sessions.error || sessions.loading || !project() ? undefined : sessions();

  function resetPage() {
    setOffset(0);
    setPreviousOffsets([]);
  }

  return (
    <div class="bs-chat-picker">
      <div>
        <h2>Choose a Claude Code session</h2>
        <p>Select the conversation running in this tab. Its history opens in a read-only view.</p>
      </div>
      <form class="bs-chat-config" onSubmit={(event) => {
        event.preventDefault();
        resetPage();
        const path = folder().trim();
        if (configDir() === path) void refetch();
        else setConfigDir(path);
      }}>
        <label>
          Claude config folder
          <input
            class="bs-input"
            value={folder()}
            placeholder={props.source.sshSessionId ? ".claude on the SSH server" : "Default Claude folder"}
            onInput={(event) => setFolder(event.currentTarget.value)}
          />
        </label>
        <button type="submit" class="bs-btn" style={button("secondary", "compact")}>Find sessions</button>
      </form>
      <Show when={projects.error}>
        {(failure) => <Notice tone="error">{String(failure().message ?? failure())}</Notice>}
      </Show>
      <Show when={projects.loading}><p role="status">Finding Claude projects…</p></Show>
      <Show when={!projects.loading && !projects.error && !projectNames().length}>
        <Notice tone="info">This Claude config folder has no saved projects.</Notice>
      </Show>
      <Show when={project()}>
        <label class="bs-chat-project">
          Project
          <select class="bs-input" value={project()} onChange={(event) => {
            setSelectedProject(event.currentTarget.value);
            resetPage();
          }}>
            <For each={projectNames()}>{(name) => <option value={name}>{name}</option>}</For>
          </select>
        </label>
        <label class="bs-chat-previews">
          <input type="checkbox" checked={previews()} onChange={(event) => setPreviews(event.currentTarget.checked)} />
          Preview titles and first messages in this project
        </label>
        <Show when={sessions.error}>
          {(failure) => (
            <>
              <Notice tone="error">{String(failure().message ?? failure())}</Notice>
              <button class="bs-btn" style={button("secondary", "compact")} onClick={() => void refreshSessions()}>
                Retry
              </button>
            </>
          )}
        </Show>
        <Show when={sessions.loading}><p role="status">Loading sessions…</p></Show>
        <Show when={results()}>
          {(page) => (
            <>
              <Show when={!page().sessions.length}><p>No saved conversations in this project.</p></Show>
              <ul class="bs-chat-sessions">
                <For each={page().sessions}>
                  {(session) => (
                    <li>
                      <button
                        class="bs-row bs-chat-session"
                        onClick={() => props.onChoose({ source: source(), project: project()!, session })}
                      >
                        <strong>{session.title || sessionDate(session.modified) || "Saved session"}</strong>
                        <span>{session.title ? `${sessionDate(session.modified)} · ` : ""}{session.id}</span>
                        <Show when={session.cwd}>{(cwd) => <span title={cwd()}>{cwd()}</span>}</Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={previousOffsets().length > 0 || page().next !== null}>
                <div class="bs-chat-pages">
                  <button
                    class="bs-btn"
                    style={button("secondary", "compact")}
                    disabled={!previousOffsets().length}
                    onClick={() => {
                      const history = previousOffsets();
                      setOffset(history[history.length - 1]);
                      setPreviousOffsets(history.slice(0, -1));
                    }}
                  >
                    Previous
                  </button>
                  <button
                    class="bs-btn"
                    style={button("secondary", "compact")}
                    disabled={page().next === null}
                    onClick={() => {
                      const next = page().next;
                      if (next === null) return;
                      setPreviousOffsets((history) => [...history, offset()]);
                      setOffset(next);
                    }}
                  >
                    Next
                  </button>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

const roleLabel = { user: "You", assistant: "Claude", tool: "Tool result", summary: "Compaction summary" };
function escapeMarkup(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeMarkup(text),
    image: ({ text }) => escapeMarkup(text ? `[Image: ${text}]` : "[Image]"),
    link({ tokens }) { return this.parser.parseInline(tokens); },
  },
});
const safeTags = [
  "p", "br", "pre", "code", "blockquote", "ul", "ol", "li", "strong", "em", "del", "hr", "h1", "h2",
  "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th",
];

function renderMarkdown(text: string) {
  return DOMPurify.sanitize(
    markdown.parse(text, { async: false }),
    { ALLOWED_TAGS: safeTags, ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false },
  );
}

function toolLabel(block: ClaudeBlock) {
  return block.kind === "result" ? "Tool output" : block.label || "Tool call";
}

function ChatBlockView(props: { block: ClaudeBlock }) {
  return (
    <Show when={props.block.kind === "text"} fallback={
      <Show when={props.block.kind !== "attachment"} fallback={<div class="bs-chat-attachment">Attachment</div>}>
        <details class="bs-chat-tool">
          <summary>{toolLabel(props.block)}</summary>
          <pre>{props.block.text}</pre>
        </details>
      </Show>
    }>
      <div class="bs-chat-markdown" innerHTML={renderMarkdown(props.block.text)} />
    </Show>
  );
}

function mergeMessages(current: ClaudeMessage[], incoming: ClaudeMessage[]) {
  const byId = new Map(current.map((message) => [message.id ?? message.offset, message]));
  for (const message of incoming) {
    const key = message.id ?? message.offset;
    const old = byId.get(key);
    if (!old || old.offset < message.offset) byId.set(key, message);
  }
  return [...byId.values()].sort((a, b) => a.offset - b.offset);
}

function downloadConversationHtml(binding: ClaudeBinding, messages: ClaudeMessage[], skipped: boolean) {
  const title = escapeMarkup(binding.session.title || "Claude Code session");
  const location = escapeMarkup(binding.session.cwd || binding.project);
  const id = escapeMarkup(binding.session.id);
  const header = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title}</title>
<style>${tokens}${chatStyles}
body { margin: 0; color-scheme: dark; background: var(--bg-2); color: var(--text-1); font: var(--t-13)/1.55 var(--font-ui, system-ui); }
.bs-chat-message > header { color: var(--text-2); }
h1, p { overflow-wrap: anywhere; }
h1 { margin: 0; font-size: 1.45rem; }
.export-meta { color: var(--text-2); margin: 0; }
</style></head><body><main class="bs-chat-messages">
<h1>${title}</h1><p class="export-meta">${location} · ${id}</p>
${skipped ? "<p>Some oversized transcript records could not be exported.</p>" : ""}
${messages.length ? "" : "<p>No saved messages.</p>"}
`;
  const body = messages.map((message) => {
    const blocks = message.blocks.map((block) => {
      if (block.kind === "text") return `<div class="bs-chat-markdown">${renderMarkdown(block.text)}</div>`;
      if (block.kind === "attachment") return '<div class="bs-chat-attachment">Attachment</div>';
      return `<details class="bs-chat-tool"><summary>${escapeMarkup(toolLabel(block))}</summary><pre>${escapeMarkup(block.text)}</pre></details>`;
    }).join("");
    return `<article class="bs-chat-message" data-role="${escapeMarkup(message.role)}"><header>${roleLabel[message.role]}</header>${blocks}</article>\n`;
  });
  const url = URL.createObjectURL(new Blob([header, ...body, "</main></body></html>\n"], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `bookshell-claude-${binding.session.id}.html`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function Conversation(props: { binding: ClaudeBinding }) {
  const [messages, setMessages] = createSignal<ClaudeMessage[]>([]);
  const [before, setBefore] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string>();
  const [skipped, setSkipped] = createSignal(false);
  const [pending, setPending] = createSignal<"latest" | "older" | "newer">();
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<string>();
  let cursor: ClaudeCursor | undefined;
  let timer: number | undefined;
  let disposed = false;
  let scroll!: HTMLDivElement;

  function scheduleRefresh() {
    window.clearTimeout(timer);
    if (!disposed && !exporting()) {
      timer = window.setTimeout(() => void load(cursor ? "newer" : "latest"), error() ? 8000 : 2600);
    }
  }

  async function load(mode: "latest" | "older" | "newer") {
    if (disposed || exporting() || pending() || (mode === "older" && before() === null)) return;
    window.clearTimeout(timer);
    setPending(mode);
    const { source, project, session } = props.binding;
    try {
      const page = await api.claudeTranscript(
        source, project, session.id, mode === "older" ? before()! : undefined, mode === "newer" ? cursor : undefined,
      );
      if (disposed) return;
      const oldHeight = scroll.scrollHeight;
      const oldTop = scroll.scrollTop;
      const nearEnd = oldHeight - oldTop - scroll.clientHeight < 60;
      const replace = page.reset || mode === "latest";
      if (replace || mode === "older") setBefore(page.before);
      if (replace || mode === "newer") cursor = page.after;
      setSkipped(page.skipped || (!replace && skipped()));
      setError(undefined);
      if (page.messages.length || replace) {
        setMessages((current) => mergeMessages(replace ? [] : current, page.messages));
        if (replace || (mode === "newer" && nearEnd)) scroll.scrollTop = scroll.scrollHeight;
        else if (mode === "older") scroll.scrollTop = oldTop + scroll.scrollHeight - oldHeight;
      }
    } catch (failure) {
      if (!disposed) setError(String(failure));
    } finally {
      if (!disposed) {
        setPending(undefined);
        scheduleRefresh();
      }
    }
  }

  async function exportHtml() {
    if (disposed || exporting()) return;
    setExporting(true);
    setExportError(undefined);
    window.clearTimeout(timer);
    const { source, project, session } = props.binding;
    const pages: ClaudeMessage[][] = [];
    let hasSkipped = false;
    let older: number | undefined;
    try {
      do {
        const page = await api.claudeTranscript(source, project, session.id, older);
        if (disposed) return;
        if (page.reset || (older !== undefined && page.before !== null && page.before >= older)) {
          throw new Error("The transcript changed during export. Try downloading it again.");
        }
        pages.push(page.messages);
        hasSkipped ||= page.skipped;
        older = page.before ?? undefined;
      } while (older !== undefined);
      downloadConversationHtml(props.binding, mergeMessages([], pages.reverse().flat()), hasSkipped);
    } catch (failure) {
      if (!disposed) setExportError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!disposed) {
        setExporting(false);
        scheduleRefresh();
      }
    }
  }

  onMount(() => void load("latest"));
  onCleanup(() => {
    disposed = true;
    window.clearTimeout(timer);
  });

  return (
    <>
      <div class="bs-chat-conversation-header">
        <div>
          <strong>{props.binding.session.title || "Claude Code session"}</strong>
          <span title={props.binding.session.cwd || props.binding.project}>
            {props.binding.session.cwd || props.binding.project} · {props.binding.session.id}
          </span>
        </div>
        <div class="bs-chat-conversation-actions">
          <button
            class="bs-btn"
            style={button("ghost", "compact")}
            aria-label="Download HTML"
            aria-busy={exporting()}
            title={exporting() ? "Exporting conversation…" : "Download conversation as HTML"}
            disabled={exporting()}
            onClick={() => void exportHtml()}
          >
            <Icon name={exporting() ? "refresh-cw" : "download"} size={14} class={exporting() ? "bs-spin" : undefined} />
          </button>
          <button class="bs-btn" style={button("ghost", "compact")} disabled={!!pending() || exporting()} onClick={() => void load("latest")}>
            Reload
          </button>
        </div>
      </div>
      <Show when={error()}>{(failure) => <Notice tone="error">{failure()}</Notice>}</Show>
      <Show when={exportError()}>
        {(failure) => <div role="alert"><Notice tone="error">HTML export failed. {failure()}</Notice></div>}
      </Show>
      <div
        ref={scroll}
        class="bs-chat-scroll"
        onScroll={() => {
          if (scroll.scrollTop < 24 && scroll.scrollHeight > scroll.clientHeight && before() !== null) void load("older");
        }}
      >
        <div class="bs-chat-messages">
          <Show when={before() !== null}>
            <button class="bs-btn bs-chat-older" style={button("secondary", "compact")} disabled={!!pending() || exporting()} onClick={() => void load("older")}>
              {pending() === "older" ? "Loading…" : "Load earlier messages"}
            </button>
          </Show>
          <Show when={skipped()}>
            <Notice tone="info">Some oversized transcript records could not be displayed.</Notice>
          </Show>
          <Show when={!messages().length && !error() && before() === null}>
            <p role="status">{pending() === "latest" ? "Reading transcript…" : "No saved messages yet."}</p>
          </Show>
          <For each={messages()}>
            {(message) => (
              <article class="bs-chat-message" data-role={message.role}>
                <header style={{ ...T[11], color: C.text2 }}>{roleLabel[message.role]}</header>
                <For each={message.blocks}>{(block) => <ChatBlockView block={block} />}</For>
              </article>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
