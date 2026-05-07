use crate::ssh::{self, SessionHandle};
use crate::AppState;
use dashmap::DashMap;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

pub struct GitWatchState {
    handles: Arc<DashMap<String, tokio::task::AbortHandle>>,
}

impl GitWatchState {
    pub fn new() -> Self {
        Self {
            handles: Arc::new(DashMap::new()),
        }
    }
}

/// Start auto-refresh for a git panel tab.
///   - SSH session  → poll `git status --porcelain` every `poll_secs` seconds
///   - Local PTY    → watch the `cwd` directory with OS file-system events
/// Emits `git://changed/{tab_id}` when a change is detected.
#[tauri::command]
pub async fn git_watch_start(
    app: AppHandle,
    app_state: State<'_, AppState>,
    watch_state: State<'_, GitWatchState>,
    tab_id: String,
    session_id: String,
    cwd: String,
    poll_secs: u64,
) -> Result<(), String> {
    // Abort any previous watcher for this tab.
    if let Some((_, old)) = watch_state.handles.remove(&tab_id) {
        old.abort();
    }

    let event_name = format!("git://changed/{}", tab_id);
    let is_local = crate::git::is_local_session(&app_state, &session_id);

    let handle = if is_local {
        start_local_watch(app, &cwd, event_name)?
    } else {
        let sessions = app_state.sessions.clone();
        start_ssh_poll(app, sessions, session_id, cwd, poll_secs, event_name)
    };

    watch_state.handles.insert(tab_id, handle);
    Ok(())
}

/// Stop the watcher for a tab (called when the git panel closes).
#[tauri::command]
pub async fn git_watch_stop(
    watch_state: State<'_, GitWatchState>,
    tab_id: String,
) -> Result<(), String> {
    if let Some((_, handle)) = watch_state.handles.remove(&tab_id) {
        handle.abort();
    }
    Ok(())
}

// ─── Local: OS file-system watcher ──────────────────────────────────────────

fn start_local_watch(
    app: AppHandle,
    cwd: &str,
    event_name: String,
) -> Result<tokio::task::AbortHandle, String> {
    let (tx, mut rx) = mpsc::channel::<()>(16);

    let tx_cb = tx.clone();
    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = tx_cb.try_send(());
            }
        })
        .map_err(|e| format!("create watcher: {}", e))?;

    watcher
        .watch(Path::new(cwd), RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {}", cwd, e))?;

    let join = tokio::spawn(async move {
        let _watcher = watcher; // keep alive for the duration of this task
        let debounce = Duration::from_millis(500);
        loop {
            if rx.recv().await.is_none() {
                break;
            }
            // Drain rapid follow-up events then wait out the debounce window.
            tokio::time::sleep(debounce).await;
            while rx.try_recv().is_ok() {}
            app.emit(&event_name, ()).ok();
        }
    });

    Ok(join.abort_handle())
}

// ─── SSH: polling loop ───────────────────────────────────────────────────────

fn start_ssh_poll(
    app: AppHandle,
    sessions: Arc<DashMap<String, SessionHandle>>,
    session_id: String,
    cwd: String,
    poll_secs: u64,
    event_name: String,
) -> tokio::task::AbortHandle {
    let secs = poll_secs.max(1);
    let cmd = format!("git -C '{}' status --porcelain 2>/dev/null", cwd.replace('\'', "'\\''"));

    let join = tokio::spawn(async move {
        let mut last = String::new();
        loop {
            tokio::time::sleep(Duration::from_secs(secs)).await;
            match ssh::run_exec_with_sessions(&sessions, &session_id, &cmd, 64 * 1024, 5000).await
            {
                Ok(res) => {
                    let current = res.stdout;
                    if current != last {
                        last = current;
                        app.emit(&event_name, ()).ok();
                    }
                }
                Err(_) => {
                    // Session gone or SSH error — stop polling silently.
                    break;
                }
            }
        }
    });

    join.abort_handle()
}
