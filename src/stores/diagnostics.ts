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

/** Wire up the diagnostics pipeline: patch console.error / console.warn so
 *  frontend issues land in the same buffer as backend log records, and
 *  subscribe to the diag://log Tauri event for backend WARN/ERROR records.
 *  Idempotent — safe to call more than once. */
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
