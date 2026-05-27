use log::{Level, Log, Metadata, Record};
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
pub struct SystemStats {
    pub rss_mb: u64,
    pub cpu_pct: f32,
}

struct MonitorState {
    sys: System,
    pid: Pid,
}

static MONITOR: OnceLock<Mutex<MonitorState>> = OnceLock::new();

/// Snapshot RSS + CPU% for the BOOKSHELL process. CPU% is delta since the
/// previous call, so the very first call returns 0; subsequent calls reflect
/// usage over the poll interval (frontend polls every 2 s).
#[tauri::command]
pub async fn system_stats() -> Result<SystemStats, String> {
    let monitor = MONITOR.get_or_init(|| {
        let pid = sysinfo::get_current_pid().unwrap_or_else(|_| Pid::from(0));
        Mutex::new(MonitorState {
            sys: System::new(),
            pid,
        })
    });
    let mut g = monitor.lock().map_err(|e| format!("lock: {}", e))?;
    let pid = g.pid;
    g.sys.refresh_all();
    let proc = g.sys.process(pid).ok_or("process not found")?;
    Ok(SystemStats {
        rss_mb: proc.memory() / (1024 * 1024),
        cpu_pct: proc.cpu_usage(),
    })
}

#[derive(serde::Serialize, Clone)]
struct DiagEntry {
    ts_ms: i64,
    level: &'static str,
    target: String,
    message: String,
}

/// Wraps env_logger so every WARN/ERROR record also fires a Tauri event the
/// frontend status footer subscribes to. INFO/DEBUG/TRACE only go to stderr.
struct DiagLogger {
    inner: env_logger::Logger,
    app: OnceLock<AppHandle>,
}

static LOGGER: OnceLock<DiagLogger> = OnceLock::new();

impl Log for DiagLogger {
    fn enabled(&self, m: &Metadata) -> bool {
        self.inner.enabled(m)
    }
    fn log(&self, record: &Record) {
        self.inner.log(record);
        if record.level() <= Level::Warn {
            if let Some(app) = self.app.get() {
                let level = match record.level() {
                    Level::Error => "error",
                    Level::Warn => "warn",
                    _ => "info",
                };
                let entry = DiagEntry {
                    ts_ms: chrono::Local::now().timestamp_millis(),
                    level,
                    target: record.target().to_string(),
                    message: format!("{}", record.args()),
                };
                let _ = app.emit("diag://log", entry);
            }
        }
    }
    fn flush(&self) {
        self.inner.flush();
    }
}

/// Replace `env_logger::init` — built once at startup, attaches its inner
/// env_logger so stderr output keeps working. The AppHandle is plugged in
/// later via `attach_app` once Tauri has finished setup.
pub fn init_logger() {
    let inner =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).build();
    let max_level = inner.filter();
    let logger = DiagLogger {
        inner,
        app: OnceLock::new(),
    };
    if LOGGER.set(logger).is_err() {
        return;
    }
    let _ = log::set_logger(LOGGER.get().unwrap());
    log::set_max_level(max_level);
}

/// Plug the AppHandle into the global logger so subsequent log records can be
/// forwarded to the frontend.
pub fn attach_app(app: AppHandle) {
    if let Some(l) = LOGGER.get() {
        let _ = l.app.set(app);
    }
}

// ──────────────────────────────────────────────────────────────────────
// Persistent debug log — the "black box" for post-mortem after a hang or
// crash. Unlike the in-app diagnostics buffer (RAM, lost on exit), this is
// a file under ~/Documents/BOOKSHELL that survives a freeze/restart. See
// debug.md for how to read it.
// ──────────────────────────────────────────────────────────────────────

/// Absolute path of the persistent debug log file.
pub fn debug_log_path() -> PathBuf {
    let dir = if let Some(dirs) = directories::UserDirs::new() {
        dirs.document_dir()
            .map(|d| d.join("BOOKSHELL"))
            .unwrap_or_else(|| PathBuf::from("BOOKSHELL"))
    } else {
        PathBuf::from("BOOKSHELL")
    };
    dir.join("bookshell-debug.log")
}

/// Append one timestamped line to the debug log. Best-effort: any IO error is
/// swallowed (we must never panic from inside the panic hook / watchdog).
fn append_debug(line: &str) {
    let path = debug_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", ts, line);
    }
}

/// Record an app-startup marker. Call once at launch so each session is
/// delimited in the file. `version` should be the real app version from
/// tauri.conf.json (Cargo's version is deliberately left at 0.0.1).
pub fn log_startup(version: &str) {
    let pid = std::process::id();
    append_debug(&format!("===== SESSION-START v{} pid={} =====", version, pid));
}

/// Forward Rust panics to the debug file before the process unwinds/aborts.
/// `panic = "abort"` in release still runs the hook before aborting.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(no message)".to_string());
        append_debug(&format!("RUST-PANIC at {} : {}", loc, msg));
        default(info);
    }));
}

// ──────────────────────────────────────────────────────────────────────
// Heartbeat watchdog — the frontend calls `heartbeat` on a timer. A Rust
// thread checks the gap; if the frontend stops pinging (main thread frozen),
// it writes a timestamped breadcrumb to the debug file. This survives a total
// UI freeze, which the frontend's own stall detector cannot.
// ──────────────────────────────────────────────────────────────────────

// `None` until the very first heartbeat arrives — so the watchdog stays quiet
// during startup / webview cold-load instead of false-flagging the gap before
// the frontend has had a chance to ping.
static LAST_HEARTBEAT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn heartbeat_cell() -> &'static Mutex<Option<Instant>> {
    LAST_HEARTBEAT.get_or_init(|| Mutex::new(None))
}

/// Frontend liveness ping. Called every few seconds while the UI event loop
/// is healthy; silence implies the main thread is blocked.
#[tauri::command]
pub fn heartbeat() {
    if let Ok(mut g) = heartbeat_cell().lock() {
        *g = Some(Instant::now());
    }
}

/// Frontend-detected main-thread stall (interval drift). Persisted so a later
/// full freeze doesn't bury the lead-up evidence.
#[tauri::command]
pub fn diag_record_stall(gap_ms: u64) {
    append_debug(&format!(
        "FRONTEND-STALL main thread stalled ~{:.1}s",
        gap_ms as f64 / 1000.0
    ));
}

/// Spawn the watchdog thread. Wakes every 5 s; if no heartbeat has arrived for
/// longer than `threshold`, logs one UNRESPONSIVE line (deduped) and a
/// RECOVERED line when pings resume.
pub fn start_watchdog() {
    let cell = heartbeat_cell();
    std::thread::spawn(move || {
        let threshold = Duration::from_secs(10);
        let mut outage = false;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            // No heartbeat seen yet → frontend still loading, stay quiet.
            let Some(gap) = cell.lock().ok().and_then(|g| *g).map(|t| t.elapsed()) else {
                continue;
            };
            if gap > threshold {
                if !outage {
                    append_debug(&format!(
                        "FRONTEND-UNRESPONSIVE no heartbeat for {:.1}s (UI likely frozen; \
                         if you just woke the machine from sleep this may be a false positive)",
                        gap.as_secs_f64()
                    ));
                    outage = true;
                }
            } else if outage {
                append_debug("FRONTEND-RECOVERED heartbeat resumed");
                outage = false;
            }
        }
    });
}
