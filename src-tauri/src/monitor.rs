use log::{Level, Log, Metadata, Record};
use std::sync::{Mutex, OnceLock};
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
