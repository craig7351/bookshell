//! File-browser backend: directory listing, download, and open-with-default.
//!
//! Listing/download work over the *same* authenticated session as the tab:
//!   - local PTY tabs (session is None) use the local filesystem directly;
//!   - SSH tabs open a fresh SFTP subsystem channel on the shared russh Handle.
//!
//! `fs_download_file` is a no-op passthrough for local tabs, so the frontend
//! can always call download → open without branching on local vs. remote.

use crate::git::is_local_session;
use crate::AppState;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// Refuse to buffer absurdly large files into memory on download.
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Serialize)]
pub struct FsEntry {
    name: String,
    /// Absolute path of this entry, computed server-side so the frontend never
    /// has to do cross-platform path joining.
    path: String,
    is_dir: bool,
    size: u64,
}

#[derive(Serialize)]
pub struct DirListing {
    /// The absolute directory that was actually listed.
    path: String,
    /// Parent directory, or None at the filesystem root.
    parent: Option<String>,
    entries: Vec<FsEntry>,
}

/// Open a one-shot SFTP session over the tab's shared SSH handle. Each call
/// opens its own subsystem channel (stateless, mirrors `run_exec`); the session
/// is dropped by the caller when the operation finishes.
async fn open_sftp(state: &AppState, session_id: &str) -> Result<SftpSession, String> {
    let session = state
        .sessions
        .get(session_id)
        .and_then(|h| h.session.clone())
        .ok_or_else(|| "session is not an SSH session (local PTY?)".to_string())?;

    let channel = {
        let g = session.lock().await;
        g.channel_open_session()
            .await
            .map_err(|e| format!("open sftp channel: {e}"))?
    };
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("request sftp subsystem: {e}"))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("sftp init: {e}"))
}

/// POSIX parent of a remote path (SFTP paths are always `/`-separated).
fn posix_parent(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return None; // already root "/"
    }
    match trimmed.rfind('/') {
        Some(0) => Some("/".to_string()),
        Some(i) => Some(trimmed[..i].to_string()),
        None => None,
    }
}

fn home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn sort_entries(entries: &mut [FsEntry]) {
    // Directories first, then case-insensitive name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

#[tauri::command]
pub async fn fs_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<DirListing, String> {
    if is_local_session(&state, &session_id) {
        let dir = if path.is_empty() {
            home_dir()
        } else {
            PathBuf::from(&path)
        };
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| format!("read_dir {}: {e}", dir.display()))?;

        let mut entries = Vec::new();
        while let Some(ent) = rd.next_entry().await.map_err(|e| e.to_string())? {
            let child = ent.path();
            // metadata() follows symlinks so symlinked dirs are navigable.
            let (is_dir, size) = match tokio::fs::metadata(&child).await {
                Ok(m) => (m.is_dir(), m.len()),
                Err(_) => (false, 0),
            };
            entries.push(FsEntry {
                name: ent.file_name().to_string_lossy().into_owned(),
                path: child.to_string_lossy().into_owned(),
                is_dir,
                size,
            });
        }
        sort_entries(&mut entries);
        Ok(DirListing {
            parent: dir.parent().map(|p| p.to_string_lossy().into_owned()),
            path: dir.to_string_lossy().into_owned(),
            entries,
        })
    } else {
        let sftp = open_sftp(&state, &session_id).await?;
        // Resolve to an absolute path (empty → the SFTP default dir = $HOME).
        let dir = sftp
            .canonicalize(if path.is_empty() { ".".to_string() } else { path })
            .await
            .map_err(|e| format!("resolve path: {e}"))?;

        let read = sftp
            .read_dir(dir.clone())
            .await
            .map_err(|e| format!("sftp read_dir {dir}: {e}"))?;

        let mut entries: Vec<FsEntry> = read
            .map(|e| {
                let name = e.file_name();
                let child = if dir.ends_with('/') {
                    format!("{dir}{name}")
                } else {
                    format!("{dir}/{name}")
                };
                FsEntry {
                    is_dir: e.file_type().is_dir(),
                    size: e.metadata().size.unwrap_or(0),
                    name,
                    path: child,
                }
            })
            .collect();
        sort_entries(&mut entries);
        Ok(DirListing {
            parent: posix_parent(&dir),
            path: dir,
            entries,
        })
    }
}

/// Make a remote file available locally and return its local path. Local tabs
/// pass through unchanged. Remote files are pulled via SFTP into a temp dir.
#[tauri::command]
pub async fn fs_download_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    if is_local_session(&state, &session_id) {
        return Ok(path);
    }

    let sftp = open_sftp(&state, &session_id).await?;

    if let Ok(meta) = sftp.metadata(path.clone()).await {
        if let Some(size) = meta.size {
            if size > MAX_DOWNLOAD_BYTES {
                return Err(format!(
                    "file is too large to open ({} MB; limit {} MB)",
                    size / (1024 * 1024),
                    MAX_DOWNLOAD_BYTES / (1024 * 1024)
                ));
            }
        }
    }

    // file_name() strips any directory component, so the basename can't escape
    // the download dir via path traversal.
    let basename = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "remote path has no filename".to_string())?;

    let dir = std::env::temp_dir().join("bookshell-downloads");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create download dir: {e}"))?;
    let local = dir.join(basename);

    // Stream remote → local in chunks instead of buffering the whole file.
    // Peak memory stays at the copy buffer size regardless of file size —
    // a 256 MB read used to allocate 256 MB+ in one shot, which is exactly
    // the kind of burst that can trip an OOM abort on a loaded machine.
    let mut remote = sftp
        .open(path.clone())
        .await
        .map_err(|e| format!("sftp open {path}: {e}"))?;
    let mut out = tokio::fs::File::create(&local)
        .await
        .map_err(|e| format!("create {}: {e}", local.display()))?;
    tokio::io::copy(&mut remote, &mut out)
        .await
        .map_err(|e| format!("download {path}: {e}"))?;

    Ok(local.to_string_lossy().into_owned())
}

/// Open a *local* path with the OS default application.
#[tauri::command]
pub fn fs_open_path(path: String) -> Result<(), String> {
    open::that_detached(&path).map_err(|e| format!("open {path}: {e}"))
}
