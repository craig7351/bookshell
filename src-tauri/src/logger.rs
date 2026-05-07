use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

pub struct LoggerHandle {
    pub tx: mpsc::Sender<Vec<u8>>,
    pub path: PathBuf,
}

pub fn logs_dir() -> PathBuf {
    if let Some(dirs) = directories::UserDirs::new() {
        if let Some(docs) = dirs.document_dir() {
            return docs.join("BOOKSHELL").join("logs");
        }
    }
    if let Some(home) = directories::BaseDirs::new() {
        return home.home_dir().join("BOOKSHELL").join("logs");
    }
    PathBuf::from("logs")
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// Start a per-session logger. Returns a handle whose `tx` should receive each
/// PTY chunk (raw bytes including ANSI). Drop the sender to close the file.
pub async fn start_logger(label: &str) -> Result<LoggerHandle, String> {
    let dir = logs_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create log dir {}: {}", dir.display(), e))?;

    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safe_label = sanitize(label);
    let path = dir.join(format!("{}_{}.log", stamp, safe_label));

    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(64);
    let path_for_task = path.clone();

    tokio::spawn(async move {
        let mut file = match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path_for_task)
            .await
        {
            Ok(f) => f,
            Err(e) => {
                log::warn!("open log {}: {}", path_for_task.display(), e);
                return;
            }
        };

        let header = format!(
            "\n===== Session started at {} =====\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        let _ = file.write_all(header.as_bytes()).await;

        let mut last_flush = Instant::now();
        while let Some(bytes) = rx.recv().await {
            if let Err(e) = file.write_all(&bytes).await {
                log::warn!("log write {}: {}", path_for_task.display(), e);
                break;
            }
            if last_flush.elapsed() > Duration::from_secs(1) {
                let _ = file.flush().await;
                last_flush = Instant::now();
            }
        }
        let _ = file.flush().await;

        let footer = format!(
            "===== Session ended at {} =====\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        let _ = file.write_all(footer.as_bytes()).await;
        let _ = file.flush().await;
    });

    Ok(LoggerHandle { tx, path })
}

#[tauri::command]
pub async fn logger_open_dir() -> Result<(), String> {
    let dir = logs_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create log dir: {}", e))?;
    open_in_explorer(&dir)
}

#[tauri::command]
pub async fn logger_dir_path() -> Result<String, String> {
    Ok(logs_dir().to_string_lossy().into_owned())
}

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub name: String,
    pub size: u64,
    pub modified_unix_ms: i64,
}

/// List all `.log` files in the logs directory, sorted by mtime descending
/// (newest first). Used by the in-app log viewer.
#[tauri::command]
pub async fn logs_list() -> Result<Vec<LogEntry>, String> {
    let dir = logs_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| format!("read_dir {}: {}", dir.display(), e))?;
    while let Some(ent) = rd.next_entry().await.map_err(|e| format!("read entry: {}", e))? {
        let path = ent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("log") {
            continue;
        }
        let meta = match ent.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let modified_unix_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        entries.push(LogEntry {
            name,
            size: meta.len(),
            modified_unix_ms,
        });
    }
    entries.sort_by(|a, b| b.modified_unix_ms.cmp(&a.modified_unix_ms));
    Ok(entries)
}

/// Read a single log file by name. The name must be a bare filename (no path
/// separators) and must resolve to a file inside the logs directory — this
/// guards against arbitrary file reads via path traversal.
#[tauri::command]
pub async fn logs_read(name: String) -> Result<Vec<u8>, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid log name".into());
    }
    let dir = logs_dir();
    let path = dir.join(&name);
    let canonical_dir = tokio::fs::canonicalize(&dir)
        .await
        .map_err(|e| format!("canonicalize logs dir: {}", e))?;
    let canonical_path = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("canonicalize {}: {}", path.display(), e))?;
    if !canonical_path.starts_with(&canonical_dir) {
        return Err("path escapes logs directory".into());
    }
    tokio::fs::read(&canonical_path)
        .await
        .map_err(|e| format!("read {}: {}", canonical_path.display(), e))
}

/// Show a native "Save As…" dialog and write `content` to the chosen path.
/// Returns the saved path, or `None` if the user cancelled.
///
/// Native dialogs (rfd → IFileDialog on Windows) need a real OS thread, so
/// the dialog itself runs inside spawn_blocking. The default location is the
/// existing logs directory.
#[tauri::command]
pub async fn transcript_save_dialog(
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let default_dir = logs_dir();
    let _ = tokio::fs::create_dir_all(&default_dir).await;

    let path = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Save transcript")
            .set_file_name(&suggested_name)
            .set_directory(&default_dir)
            .add_filter("Text", &["txt"])
            .add_filter("All files", &["*"])
            .save_file()
    })
    .await
    .map_err(|e| format!("dialog task: {}", e))?;

    let Some(path) = path else { return Ok(None) };
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Open an http(s) URL in the user's default browser. Restricted to those two
/// schemes so a malicious server can't trigger `file://` or custom-handler
/// invocations through the terminal's link-click hook.
#[tauri::command]
pub async fn url_open(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http(s) URLs allowed".into());
    }
    open_url(&url)
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<(), String> {
    // `cmd /c start "" "<url>"` lets the shell pick the registered handler.
    // The empty "" is the window title slot — required when the URL is quoted.
    std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn()
        .map_err(|e| format!("start: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_url(url: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd)
        .arg(url)
        .spawn()
        .map_err(|e| format!("{}: {}", cmd, e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_in_explorer(path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| format!("explorer: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_in_explorer(path: &std::path::Path) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd)
        .arg(path)
        .spawn()
        .map_err(|e| format!("{}: {}", cmd, e))?;
    Ok(())
}
