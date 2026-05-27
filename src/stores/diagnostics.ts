import { createSignal } from "solid-js";
import { api, type DiagLogEntry } from "../ipc/api";

const CAP = 50;

const [entries, setEntries] = createSignal<DiagLogEntry[]>([]);
export { entries as diagEntries };

function push(entry: DiagLogEntry) {
  setEntries((prev) => {
    const next = [...prev, entry];
    if (next.length > CAP) next.splice(0, next.length - CAP);
    return next;
  });
}

export function clearDiag() {
  setEntries([]);
}

let initialized = false;

// Heartbeat: ping the backend watchdog while the UI event loop is healthy.
const HEARTBEAT_MS = 3000;
// Stall detector: a 1s timer that should drift very little. A gap past this
// threshold means the main thread was blocked — the lead-up to a freeze.
const STALL_TICK_MS = 1000;
const STALL_THRESHOLD_MS = 3000;

/** Wire up the diagnostics pipeline: patch console.error / console.warn so
 *  frontend issues land in the same buffer as backend log records, subscribe
 *  to the diag://log Tauri event, start the backend heartbeat, and run a
 *  main-thread stall detector. Idempotent — safe to call more than once. */
export function initDiagnostics() {
  if (initialized) return;
  initialized = true;

  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origErr(...args);
    push({
      ts_ms: Date.now(),
      level: "error",
      target: "frontend",
      message: args.map(formatArg).join(" "),
    });
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    push({
      ts_ms: Date.now(),
      level: "warn",
      target: "frontend",
      message: args.map(formatArg).join(" "),
    });
  };

  api.onDiagLog((entry) => push(entry)).catch(origErr);

  // Heartbeat sender — silence tells the backend watchdog the UI froze.
  api.heartbeat().catch(() => {});
  setInterval(() => api.heartbeat().catch(() => {}), HEARTBEAT_MS);

  // Stall detector — compares wall-clock gap against the expected tick. When
  // the main thread unblocks after a hitch this fires once with the duration,
  // recording both in the in-app buffer and the persistent debug file.
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap > STALL_THRESHOLD_MS) {
      push({
        ts_ms: now,
        level: "warn",
        target: "watchdog",
        message: `main thread stalled ~${(gap / 1000).toFixed(1)}s`,
      });
      api.diagRecordStall(gap).catch(() => {});
    }
  }, STALL_TICK_MS);
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
