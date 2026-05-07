use crate::logger;
use crate::ssh::{Cmd, SessionHandle};
use crate::AppState;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    "powershell.exe".to_string()
}
#[cfg(not(target_os = "windows"))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Spawn a local interactive shell on a fresh PTY. The session shows up in
/// the same `state.sessions` map as SSH PTYs and is driven by ssh_write /
/// ssh_resize / ssh_disconnect, so the frontend treats it identically.
#[tauri::command]
pub async fn local_open_pty(
    app: AppHandle,
    state: State<'_, AppState>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {}", e))?;

    let shell_path = shell
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(default_shell);

    let mut builder = CommandBuilder::new(&shell_path);
    if let Some(d) = cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        builder.cwd(d);
    }
    // Forward TERM so colors etc. work like a normal terminal.
    builder.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("spawn {}: {}", shell_path, e))?;
    drop(pair.slave);

    let master = Arc::new(StdMutex::new(pair.master));
    let reader = master
        .lock()
        .unwrap()
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {}", e))?;
    let writer = master
        .lock()
        .unwrap()
        .take_writer()
        .map_err(|e| format!("take writer: {}", e))?;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Cmd>(64);
    let data_event = format!("ssh://data/{}", session_id);
    let close_event = format!("ssh://close/{}", session_id);

    // Per-session logger — same scheme as SSH sessions, label is the shell's
    // basename so files like `20260501_..._powershell.exe.log` show up in
    // ~/Documents/BOOKSHELL/logs.
    let log_label = std::path::Path::new(&shell_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "local".to_string());
    let log_handle = logger::start_logger(&log_label).await.ok();
    let log_path = log_handle
        .as_ref()
        .map(|h| h.path.clone())
        .unwrap_or_default();
    let log_tx = log_handle.map(|h| h.tx);

    // Reader: blocking read in a dedicated OS thread, push bytes to frontend
    // and (if logging enabled) into the logger channel. Moving `log_tx` in
    // here means it's dropped when the PTY closes, which signals the logger
    // task to flush its footer and close the file.
    let app_for_reader = app.clone();
    let data_event_for_reader = data_event.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let bytes = buf[..n].to_vec();
                    if let Some(tx) = &log_tx {
                        // blocking_send: this is a plain std::thread, not a
                        // tokio task, so async .send() isn't usable here.
                        let _ = tx.blocking_send(bytes.clone());
                    }
                    let _ = app_for_reader.emit(&data_event_for_reader, bytes);
                }
                Err(_) => break,
            }
        }
    });

    // Writer + cmd handler. Writer is sync; PTY writes are tiny so we don't
    // bother spawn_blocking each one.
    let writer = Arc::new(StdMutex::new(writer));
    let writer_for_task = writer.clone();
    let master_for_task = master.clone();

    let app_for_close = app.clone();
    let session_id_clone = session_id.clone();
    let sessions_clone = state.sessions.clone();

    // We need `child` to be Send. portable-pty's Box<dyn Child + Send + Sync> is.
    let child_arc: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>> =
        Arc::new(Mutex::new(child as _));
    let child_for_task = child_arc.clone();

    tokio::spawn(async move {
        let close_reason = run_local(
            &mut cmd_rx,
            writer_for_task,
            master_for_task,
            child_for_task,
        )
        .await;
        sessions_clone.remove(&session_id_clone);
        let _ = app_for_close.emit(&close_event, close_reason);
    });

    // Watcher: when the child exits on its own (user typed `exit`, etc.),
    // tear the session down so the frontend learns about it.
    let cmd_tx_for_watcher = cmd_tx.clone();
    let child_for_watcher = child_arc.clone();
    std::thread::spawn(move || {
        // Acquiring the std::sync lock would be racy with the async task; use
        // a small poll loop on try_wait via tokio handle.
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            // Use try_lock; if busy, retry.
            if let Ok(mut g) = child_for_watcher.try_lock() {
                match g.try_wait() {
                    Ok(Some(_status)) => {
                        let _ = cmd_tx_for_watcher.try_send(Cmd::Close);
                        break;
                    }
                    Ok(None) => continue,
                    Err(_) => break,
                }
            }
        }
    });
    // The watcher thread captures `child_arc.clone()`; drop our local
    // reference here so only the runtime tasks keep it alive.
    drop(child_arc);

    let handle = SessionHandle {
        tx: cmd_tx,
        log_path,
        session: None,
        is_primary: true,
    };
    state.sessions.insert(session_id.clone(), handle);

    // Master and writer kept alive via Arc captures inside tasks.
    let _ = master;
    let _ = writer;

    Ok(session_id)
}

async fn run_local(
    cmd_rx: &mut mpsc::Receiver<Cmd>,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    master: Arc<StdMutex<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
) -> String {
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            Cmd::Write(bytes) => {
                if let Ok(mut w) = writer.lock() {
                    if w.write_all(&bytes).is_err() {
                        return "write error".into();
                    }
                    let _ = w.flush();
                }
            }
            Cmd::Resize(cols, rows) => {
                if let Ok(m) = master.lock() {
                    let _ = m.resize(PtySize {
                        rows: rows as u16,
                        cols: cols as u16,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
            Cmd::Close => {
                let mut g = child.lock().await;
                let _ = g.kill();
                return "closed by client".into();
            }
        }
    }
    "channel ended".into()
}
