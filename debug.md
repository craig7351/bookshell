# Debugging BOOKSHELL hangs & crashes

This is the entry point when BOOKSHELL freezes, crashes, or misbehaves after
running for a while. It tells you **where the evidence lives** and **how to read
it**. Start here.

## Where the debug files are

### 1. Persistent debug log (the black box) — read this first

A single append-only file that **survives a freeze, crash, and restart**:

| OS | Path |
|----|------|
| Windows | `%USERPROFILE%\Documents\BOOKSHELL\bookshell-debug.log` |
| macOS | `~/Documents/BOOKSHELL/bookshell-debug.log` |
| Linux | `~/Documents/BOOKSHELL/bookshell-debug.log` (falls back to `./BOOKSHELL/` if no Documents dir) |

Written by the Rust backend (`src-tauri/src/monitor.rs`). Every line is
timestamped `[YYYY-MM-DD HH:MM:SS.mmm]`. Line types:

| Prefix | Meaning | Emitted by |
|--------|---------|-----------|
| `SESSION-START` | App launched (includes version + pid). Delimits sessions. | `log_startup()` |
| `FRONTEND-STALL` | UI main thread blocked ~Ns then recovered. The lead-up to a freeze. | frontend stall detector → `diag_record_stall` |
| `FRONTEND-UNRESPONSIVE` | Backend got no heartbeat for >10s — **UI is frozen right now**. | `start_watchdog()` thread |
| `FRONTEND-RECOVERED` | Heartbeats resumed after an outage. | `start_watchdog()` thread |
| `RUST-PANIC` | Backend panicked (file:line + message). | panic hook |

### 2. In-app diagnostics popover (live, ephemeral)

Bottom status bar → click the `⚠ N` chip on the right. Shows the last 50
WARN/ERROR records (backend `log::warn!`/`error!` + patched frontend
`console.warn`/`console.error`). **Lost on restart** — for history use the file
above. Source: `src/stores/diagnostics.ts`, `src/components/StatusFooter.tsx`.

### 3. env_logger stderr (dev only)

When run via `npm run tauri dev`, all Rust `log::*` output goes to the terminal
running the command. In a packaged build there is no console — rely on the
debug file instead.

## How to diagnose a total freeze (window dead, mouse/keyboard ignored)

A full freeze = the **frontend main thread (WebView2 JS event loop) is blocked**.
The backend keeps running, which is why the watchdog can still write the file.

1. Open `bookshell-debug.log`, jump to the **last `SESSION-START`**.
2. Look for `FRONTEND-UNRESPONSIVE` near the freeze time → confirms a real UI
   freeze and gives the timestamp.
3. Look for `FRONTEND-STALL` lines *before* it. A series of growing stalls means
   a gradual problem (GC pressure / memory growth / runaway reactivity). A sudden
   freeze with no lead-up points to a single blocking operation.
4. Correlate with memory: watch the `🧠 RSS` figure in the footer over time. If
   it climbs monotonically into the GB range, the freeze is memory-driven
   (scrollback, leaked listeners, an ever-growing structure).
5. If the freeze correlates with a burst of terminal output, suspect PTY output
   flooding the webview message queue (no backpressure on `app.emit` →
   `term.write`).

### Known false positive

`FRONTEND-UNRESPONSIVE` right after the machine wakes from **sleep/hibernate** is
usually not a real hang — timers simply didn't run while suspended. The line
itself notes this. Check whether the timestamp lines up with a wake.

## Where the watchdog code lives

- Backend: `src-tauri/src/monitor.rs` — `debug_log_path`, `append_debug`,
  `heartbeat`, `diag_record_stall`, `start_watchdog`, `install_panic_hook`,
  `log_startup`. Wired in `src-tauri/src/lib.rs` (`run()` + `setup()`).
- Frontend: `src/stores/diagnostics.ts` — heartbeat sender (every 3s) and stall
  detector (1s tick, >3s gap = stall). Started from `initDiagnostics()` in
  `src/App.tsx` `onMount`.
- Thresholds: heartbeat 3s, watchdog checks every 5s, declares unresponsive
  after 10s. Adjust in those two files if too sensitive/lax.
