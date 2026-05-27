use crate::AppState;
use async_trait::async_trait;
use dashmap::DashMap;
use russh::client::{self, Handle};
use russh::{ChannelId, ChannelMsg, Disconnect};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

pub struct SessionHandle {
    pub tx: mpsc::Sender<Cmd>,
    /// `Some` only for SSH sessions; `None` for local PTYs which don't have
    /// a russh Handle to share. `run_exec` and other SSH-only helpers refuse
    /// to operate on a None session.
    pub session: Option<Arc<Mutex<Handle<Client>>>>,
    /// True for the primary session created by ssh_connect; false for child
    /// PTYs sharing the same authenticated session (side terminals).
    /// Closing a non-primary handle only closes its channel, never the
    /// underlying SSH connection.
    pub is_primary: bool,
}

pub struct ExecResult {
    pub stdout: String,
    #[allow(dead_code)]
    pub stderr: String,
    pub exit_code: Option<u32>,
}

/// Run a one-shot command on a fresh SSH exec channel piggybacking on an
/// existing authenticated session. Used by features (git view, future SFTP
/// listings, …) that want non-interactive output without polluting the user's
/// shell.
pub async fn run_exec(
    state: &AppState,
    session_id: &str,
    command: &str,
    max_bytes: usize,
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    run_exec_with_sessions(&state.sessions, session_id, command, max_bytes, timeout_ms).await
}

/// Same as `run_exec` but takes the sessions map directly so background tasks
/// (git watcher polling loop) can call it without holding a `State<AppState>`.
pub async fn run_exec_with_sessions(
    sessions: &DashMap<String, SessionHandle>,
    session_id: &str,
    command: &str,
    max_bytes: usize,
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    let session = sessions
        .get(session_id)
        .and_then(|h| h.session.clone())
        .ok_or_else(|| "session not an SSH session (local PTY?)".to_string())?;

    let mut channel = {
        let g = session.lock().await;
        g.channel_open_session()
            .await
            .map_err(|e| format!("open exec channel: {}", e))?
    };
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("exec: {}", e))?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit: Option<u32> = None;

    let timeout = tokio::time::sleep(std::time::Duration::from_millis(timeout_ms));
    tokio::pin!(timeout);

    // Drain order is implementation-defined: many servers send Eof BEFORE
    // ExitStatus. Don't break on Eof or we'll miss the exit code. Break only
    // on Close (the channel is actually torn down), the channel ending
    // unexpectedly, or our timeout. Once we've seen both Eof and ExitStatus
    // we can exit immediately too.
    let mut got_eof = false;
    loop {
        tokio::select! {
            _ = &mut timeout => break,
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if stdout.len() < max_bytes {
                            stdout.extend_from_slice(&data);
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        if ext == 1 && stderr.len() < max_bytes {
                            stderr.extend_from_slice(&data);
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit = Some(exit_status);
                        if got_eof { break; }
                    }
                    Some(ChannelMsg::Eof) => {
                        got_eof = true;
                        if exit.is_some() { break; }
                    }
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = channel.close().await;

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code: exit,
    })
}

/// Run a command on a fresh exec channel, piping `stdin_bytes` into its stdin
/// and closing stdin with EOF before draining the channel. Used by the file
/// upload path to write binary data with `cat > path`. Bytes are chunked at
/// 32 KiB so we don't outrun the SSH window.
pub async fn run_exec_with_stdin(
    sessions: &DashMap<String, SessionHandle>,
    session_id: &str,
    command: &str,
    stdin_bytes: &[u8],
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    let session = sessions
        .get(session_id)
        .and_then(|h| h.session.clone())
        .ok_or_else(|| "session not an SSH session (local PTY?)".to_string())?;

    let mut channel = {
        let g = session.lock().await;
        g.channel_open_session()
            .await
            .map_err(|e| format!("open exec channel: {}", e))?
    };
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("exec: {}", e))?;

    const CHUNK: usize = 32 * 1024;
    for chunk in stdin_bytes.chunks(CHUNK) {
        channel
            .data(chunk)
            .await
            .map_err(|e| format!("write stdin: {}", e))?;
    }
    channel
        .eof()
        .await
        .map_err(|e| format!("close stdin: {}", e))?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit: Option<u32> = None;

    let timeout = tokio::time::sleep(std::time::Duration::from_millis(timeout_ms));
    tokio::pin!(timeout);

    let mut got_eof = false;
    loop {
        tokio::select! {
            _ = &mut timeout => break,
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if stdout.len() < 64 * 1024 {
                            stdout.extend_from_slice(&data);
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        if ext == 1 && stderr.len() < 64 * 1024 {
                            stderr.extend_from_slice(&data);
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit = Some(exit_status);
                        if got_eof { break; }
                    }
                    Some(ChannelMsg::Eof) => {
                        got_eof = true;
                        if exit.is_some() { break; }
                    }
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = channel.close().await;

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code: exit,
    })
}

pub enum Cmd {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

pub struct Client;

#[async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Phase 0 prototype: accept all host keys.
        // TODO Phase 1: implement known_hosts verification.
        Ok(true)
    }
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    host: String,
    port: u16,
    user: String,
    password: String,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let config = Arc::new(client::Config {
        // Server idle timeouts (sshd ClientAliveInterval ~5min) drop us long
        // before any sane user-idle window. Send a keepalive every 30s; if 3
        // in a row go unanswered russh closes the connection on its own. The
        // 1h inactivity_timeout is just a backstop for genuinely dead links.
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let mut session = client::connect(config, (host.as_str(), port), Client)
        .await
        .map_err(|e| format!("connect: {}", e))?;

    let auth = session
        .authenticate_password(&user, &password)
        .await
        .map_err(|e| format!("auth: {}", e))?;
    if !auth {
        return Err("authentication failed".into());
    }

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("open channel: {}", e))?;

    channel
        .request_pty(
            true,
            "xterm-256color",
            cols,
            rows,
            0,
            0,
            &[
                (russh::Pty::ECHO, 1),
                (russh::Pty::TTY_OP_ISPEED, 14400),
                (russh::Pty::TTY_OP_OSPEED, 14400),
            ],
        )
        .await
        .map_err(|e| format!("request pty: {}", e))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("request shell: {}", e))?;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Cmd>(64);
    let session_arc = Arc::new(Mutex::new(session));
    let channel_id = channel.id();

    let handle = SessionHandle {
        tx: cmd_tx.clone(),
        session: Some(session_arc.clone()),
        is_primary: true,
    };
    state.sessions.insert(session_id.clone(), handle);

    let app_clone = app.clone();
    let sid_clone = session_id.clone();
    let sessions_clone = state.sessions.clone();
    let session_for_task = session_arc.clone();

    tokio::spawn(async move {
        let close_reason = run_session(
            app_clone.clone(),
            sid_clone.clone(),
            channel,
            channel_id,
            session_for_task,
            &mut cmd_rx,
            true,
        )
        .await;
        sessions_clone.remove(&sid_clone);
        let _ = app_clone.emit(&format!("ssh://close/{}", sid_clone), close_reason);
    });

    Ok(session_id)
}

/// Open an additional interactive PTY on an existing authenticated session.
/// The new PTY is registered as its own session_id so the frontend can drive
/// it through the normal ssh_write / ssh_resize / ssh_disconnect commands and
/// receive ssh://data/<sid> events. Closing this sub-session only closes its
/// channel — the parent SSH connection stays alive for other PTYs.
#[tauri::command]
pub async fn ssh_open_pty(
    app: AppHandle,
    state: State<'_, AppState>,
    parent_session_id: String,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let parent_session = state
        .sessions
        .get(&parent_session_id)
        .and_then(|h| h.session.clone())
        .ok_or_else(|| "parent session not found or not an SSH session".to_string())?;

    let session_id = uuid::Uuid::new_v4().to_string();

    let channel = {
        let g = parent_session.lock().await;
        g.channel_open_session()
            .await
            .map_err(|e| format!("open channel: {}", e))?
    };

    channel
        .request_pty(
            true,
            "xterm-256color",
            cols,
            rows,
            0,
            0,
            &[
                (russh::Pty::ECHO, 1),
                (russh::Pty::TTY_OP_ISPEED, 14400),
                (russh::Pty::TTY_OP_OSPEED, 14400),
            ],
        )
        .await
        .map_err(|e| format!("request pty: {}", e))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("request shell: {}", e))?;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Cmd>(64);
    let channel_id = channel.id();

    let handle = SessionHandle {
        tx: cmd_tx.clone(),
        session: Some(parent_session.clone()),
        is_primary: false,
    };
    state.sessions.insert(session_id.clone(), handle);

    let app_clone = app.clone();
    let sid_clone = session_id.clone();
    let sessions_clone = state.sessions.clone();
    let session_for_task = parent_session.clone();

    tokio::spawn(async move {
        let close_reason = run_session(
            app_clone.clone(),
            sid_clone.clone(),
            channel,
            channel_id,
            session_for_task,
            &mut cmd_rx,
            false,
        )
        .await;
        sessions_clone.remove(&sid_clone);
        let _ = app_clone.emit(&format!("ssh://close/{}", sid_clone), close_reason);
    });

    Ok(session_id)
}

/// Base64-encode bytes and emit them as a single event. Base64 keeps the
/// payload a compact JSON string (~1.33x) instead of Tauri's default
/// `Vec<u8>` → JSON number-array encoding (~3-10x size + per-byte parse on the
/// UI thread), which was the main cause of UI freezes under heavy output.
fn emit_b64(app: &AppHandle, event: &str, bytes: &[u8]) {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit(event, encoded);
}

/// Spawn a per-session task that coalesces terminal output: bytes pushed to the
/// returned sender are buffered and flushed at most every 16 ms (or sooner once
/// the buffer passes 64 KiB), then emitted base64-encoded on `event`. Batching
/// collapses an output flood into a few events per frame instead of one per
/// read, keeping the webview main thread responsive. Dropping the sender
/// flushes the tail and ends the task.
pub fn spawn_output_coalescer(app: AppHandle, event: String) -> mpsc::UnboundedSender<Vec<u8>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    tokio::spawn(async move {
        const MAX_BUF: usize = 64 * 1024;
        let mut buf: Vec<u8> = Vec::new();
        let mut ticker = tokio::time::interval(Duration::from_millis(16));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                maybe = rx.recv() => match maybe {
                    Some(bytes) => {
                        buf.extend_from_slice(&bytes);
                        if buf.len() >= MAX_BUF {
                            emit_b64(&app, &event, &buf);
                            buf.clear();
                        }
                    }
                    None => {
                        if !buf.is_empty() {
                            emit_b64(&app, &event, &buf);
                        }
                        break;
                    }
                },
                _ = ticker.tick() => {
                    if !buf.is_empty() {
                        emit_b64(&app, &event, &buf);
                        buf.clear();
                    }
                }
            }
        }
    });
    tx
}

async fn run_session(
    app: AppHandle,
    session_id: String,
    mut channel: russh::Channel<russh::client::Msg>,
    channel_id: ChannelId,
    session: Arc<Mutex<Handle<Client>>>,
    cmd_rx: &mut mpsc::Receiver<Cmd>,
    is_primary: bool,
) -> String {
    let data_event = format!("ssh://data/{}", session_id);
    let out_tx = spawn_output_coalescer(app, data_event);
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let _ = out_tx.send(data.to_vec());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = out_tx.send(data.to_vec());
                    }
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        return format!("exit {}", exit_status);
                    }
                    Some(ChannelMsg::Close) => {
                        return "remote closed".into();
                    }
                    None => {
                        return "channel ended".into();
                    }
                    _ => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(Cmd::Write(bytes)) => {
                        if let Err(e) = channel.data(&bytes[..]).await {
                            return format!("write error: {}", e);
                        }
                    }
                    Some(Cmd::Resize(cols, rows)) => {
                        if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                            log::warn!("resize failed: {}", e);
                        }
                    }
                    Some(Cmd::Close) | None => {
                        let _ = channel.close().await;
                        if is_primary {
                            let _ = session
                                .lock()
                                .await
                                .disconnect(Disconnect::ByApplication, "bye", "en")
                                .await;
                        }
                        let _ = channel_id;
                        return "closed by client".into();
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let entry = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    entry
        .tx
        .send(Cmd::Write(data.into_bytes()))
        .await
        .map_err(|e| format!("send: {}", e))
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let entry = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    entry
        .tx
        .send(Cmd::Resize(cols, rows))
        .await
        .map_err(|e| format!("send: {}", e))
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    if let Some((_, handle)) = state.sessions.remove(&session_id) {
        let _ = handle.tx.send(Cmd::Close).await;
    }
    Ok(())
}

/// Upload a local file to `/tmp/bookshell-clip/<basename>` on the remote host
/// piggybacking on the existing SSH session's exec channel. Used by the
/// clipboard image paste flow on SSH tabs. Returns the absolute remote path
/// on success.
#[tauri::command]
pub async fn ssh_upload_file(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
) -> Result<String, String> {
    let bytes = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("read {}: {}", local_path, e))?;

    let basename = std::path::Path::new(&local_path)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "local path has no filename".to_string())?;

    // Allow only safe characters in the basename — UUID-named clipboard files
    // satisfy this trivially; reject anything else so the unquoted insertion
    // into the shell command below stays safe.
    if !basename
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("unsafe basename: {}", basename));
    }

    let remote_dir = "/tmp/bookshell-clip";
    let remote_path = format!("{}/{}", remote_dir, basename);
    let cmd = format!("mkdir -p {} && cat > {}", remote_dir, remote_path);

    let res = run_exec_with_stdin(&state.sessions, &session_id, &cmd, &bytes, 30_000).await?;
    match res.exit_code {
        Some(0) => Ok(remote_path),
        Some(code) => Err(format!(
            "remote exit {}: {}",
            code,
            res.stderr.trim().chars().take(200).collect::<String>()
        )),
        None => Err("remote command did not finish (timeout)".to_string()),
    }
}
