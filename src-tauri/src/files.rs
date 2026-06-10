//! File-browser backend: directory listing, open-with-default, native file/dir
//! pickers, and recursive upload/download (streamed over SFTP for SSH tabs,
//! local recursive copy for local tabs).
//!
//! Listing/transfer work over the *same* authenticated session as the tab:
//!   - local PTY tabs (session is None) use the local filesystem directly;
//!   - SSH tabs open a fresh SFTP subsystem channel on the shared russh Handle.
//!
//! `fs_download_file` is a no-op passthrough for local tabs, so the frontend
//! can always call download → open without branching on local vs. remote.

use crate::git::is_local_session;
use crate::AppState;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
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
                let child = posix_join(&dir, &name);
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

// ──────────────────────────────────────────────────────────────────────
// Native picker dialogs (rfd). These run on the OS file dialog so the user
// chooses local paths; the frontend then hands the result to upload/download.
// ──────────────────────────────────────────────────────────────────────

/// Pick one or more local files. Returns absolute paths, or empty if the user
/// cancelled. Used as the source for "upload file(s)".
#[tauri::command]
pub async fn fs_pick_files() -> Result<Vec<String>, String> {
    let picked = rfd::AsyncFileDialog::new().pick_files().await;
    Ok(picked
        .map(|files| {
            files
                .into_iter()
                .map(|f| f.path().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default())
}

/// Pick a single local directory. Returns the path, or None if cancelled.
/// Used both as the source for "upload folder" and the destination for
/// "download to…".
#[tauri::command]
pub async fn fs_pick_dir() -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(picked.map(|d| d.path().to_string_lossy().into_owned()))
}

/// Join a remote (POSIX) directory and a child name.
fn posix_join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

// Caps on a single recursive transfer, to bound disk usage / work from a huge
// or malicious tree. A compromised or MITM'd SFTP server is in scope (host keys
// aren't verified). Streaming already keeps peak *memory* bounded — these bound
// *disk*, *file count*, and *recursion depth*.
const MAX_TRANSFER_BYTES: u64 = 20 * 1024 * 1024 * 1024; // 20 GiB cumulative
const MAX_TRANSFER_FILES: u64 = 200_000;
const MAX_TRANSFER_DEPTH: u32 = 64;

/// Running tally + caps threaded through a recursive transfer.
#[derive(Default)]
struct Budget {
    bytes: u64,
    files: u64,
}

impl Budget {
    /// Account for one transferred file of `n` bytes; error if a cap is hit.
    fn add_file(&mut self, n: u64) -> Result<(), String> {
        self.files += 1;
        if self.files > MAX_TRANSFER_FILES {
            return Err(format!("transfer aborted: exceeded {MAX_TRANSFER_FILES} files"));
        }
        self.bytes = self.bytes.saturating_add(n);
        if self.bytes > MAX_TRANSFER_BYTES {
            return Err(format!(
                "transfer aborted: exceeded {} GiB total",
                MAX_TRANSFER_BYTES / (1024 * 1024 * 1024)
            ));
        }
        Ok(())
    }
}

/// Validate that a server- or filesystem-supplied entry name is a single, safe
/// path component before it is `join()`ed onto a local destination. Rejects
/// empty / `.` / `..`, any path separator (POSIX `/` or Windows `\`), and the
/// Windows drive/ADS colon — so a malicious SFTP server can't use a crafted
/// filename (`..\..\evil`, `C:\Windows\evil`) to escape the chosen directory.
fn safe_component(name: &str) -> Result<&str, String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("refusing unsafe entry name: {name:?}"));
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err(format!("refusing unsafe entry name: {name:?}"));
    }
    Ok(name)
}

/// Create a remote directory if it doesn't already exist, propagating genuine
/// failures (permission / quota / read-only) instead of silently swallowing
/// them — `let _ = create_dir(..)` would hide a real mkdir failure and report a
/// misleading per-file error (or a false success for an empty source dir).
async fn ensure_remote_dir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    match sftp.metadata(path.to_string()).await {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(format!("remote path exists and is not a directory: {path}")),
        Err(_) => sftp
            .create_dir(path.to_string())
            .await
            .map_err(|e| format!("mkdir {path}: {e}")),
    }
}

// ── Upload: local path(s) → remote dir ─────────────────────────────────

/// Recursively upload one local path (file or directory) into `remote_dir`
/// over SFTP. Boxed because async recursion needs an explicit indirection.
fn sftp_upload<'a>(
    sftp: &'a SftpSession,
    local: PathBuf,
    remote_dir: &'a str,
    depth: u32,
    budget: &'a mut Budget,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if depth > MAX_TRANSFER_DEPTH {
            return Err(format!(
                "upload aborted: directory nesting exceeds {MAX_TRANSFER_DEPTH}"
            ));
        }
        let name = local
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("invalid local path: {}", local.display()))?
            .to_string();
        let remote_path = posix_join(remote_dir, &name);

        // symlink_metadata (lstat) so we DON'T follow links: a symlinked dir
        // could point outside the selected tree, and a cyclic link would recurse
        // forever. Skip links entirely.
        let meta = tokio::fs::symlink_metadata(&local)
            .await
            .map_err(|e| format!("stat {}: {e}", local.display()))?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }

        if meta.is_dir() {
            ensure_remote_dir(sftp, &remote_path).await?;
            let mut rd = tokio::fs::read_dir(&local)
                .await
                .map_err(|e| format!("read_dir {}: {e}", local.display()))?;
            while let Some(ent) = rd
                .next_entry()
                .await
                .map_err(|e| format!("read_dir {}: {e}", local.display()))?
            {
                sftp_upload(sftp, ent.path(), &remote_path, depth + 1, budget).await?;
            }
        } else {
            let mut input = tokio::fs::File::open(&local)
                .await
                .map_err(|e| format!("open {}: {e}", local.display()))?;
            let mut remote = sftp
                .create(remote_path.clone())
                .await
                .map_err(|e| format!("sftp create {remote_path}: {e}"))?;
            let n = tokio::io::copy(&mut input, &mut remote)
                .await
                .map_err(|e| format!("upload {}: {e}", local.display()))?;
            // shutdown() flushes and closes the remote handle — it also surfaces
            // server-side write errors (quota / disk-full) the Drop close swallows.
            use tokio::io::AsyncWriteExt;
            remote
                .shutdown()
                .await
                .map_err(|e| format!("finalize {remote_path}: {e}"))?;
            budget.add_file(n)?;
        }
        Ok(())
    })
}

/// Recursively copy one local path (file or directory) into `dest_dir` on the
/// local filesystem. Used for local tabs, where "upload"/"download" are just
/// local copies.
fn local_copy<'a>(
    src: PathBuf,
    dest_dir: &'a Path,
    depth: u32,
    budget: &'a mut Budget,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if depth > MAX_TRANSFER_DEPTH {
            return Err(format!(
                "copy aborted: directory nesting exceeds {MAX_TRANSFER_DEPTH}"
            ));
        }
        let name = src
            .file_name()
            .ok_or_else(|| format!("invalid path: {}", src.display()))?
            .to_owned();
        let dest = dest_dir.join(&name);
        // lstat: don't follow symlinks (cycle / out-of-tree escape).
        let meta = tokio::fs::symlink_metadata(&src)
            .await
            .map_err(|e| format!("stat {}: {e}", src.display()))?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        if meta.is_dir() {
            tokio::fs::create_dir_all(&dest)
                .await
                .map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
            let mut rd = tokio::fs::read_dir(&src)
                .await
                .map_err(|e| format!("read_dir {}: {e}", src.display()))?;
            while let Some(ent) = rd
                .next_entry()
                .await
                .map_err(|e| format!("read_dir {}: {e}", src.display()))?
            {
                local_copy(ent.path(), &dest, depth + 1, budget).await?;
            }
        } else {
            let n = tokio::fs::copy(&src, &dest)
                .await
                .map_err(|e| format!("copy {}: {e}", src.display()))?;
            budget.add_file(n)?;
        }
        Ok(())
    })
}

/// Upload local paths (files and/or directories) into `remote_dir`. For SSH
/// tabs this streams over SFTP; for local tabs it's a recursive local copy.
/// Returns the number of files transferred (directories aren't counted).
#[tauri::command]
pub async fn fs_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<u64, String> {
    let mut budget = Budget::default();
    if is_local_session(&state, &session_id) {
        let dest = PathBuf::from(&remote_dir);
        for p in &local_paths {
            local_copy(PathBuf::from(p), &dest, 0, &mut budget).await?;
        }
    } else {
        let sftp = open_sftp(&state, &session_id).await?;
        for p in &local_paths {
            sftp_upload(&sftp, PathBuf::from(p), &remote_dir, 0, &mut budget).await?;
        }
    }
    Ok(budget.files)
}

// ── Download: remote path → local dir ──────────────────────────────────

/// Recursively download a remote path into `local_dir` over SFTP. `name` is the
/// (already validated) local leaf to create under `local_dir`; `is_dir`
/// describes this entry. Child names come from the server's READDIR and are
/// validated with `safe_component` before being join()ed locally, so a
/// malicious server can't traverse out of the chosen destination.
fn sftp_download<'a>(
    sftp: &'a SftpSession,
    remote_path: String,
    name: String,
    is_dir: bool,
    local_dir: &'a Path,
    depth: u32,
    budget: &'a mut Budget,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if depth > MAX_TRANSFER_DEPTH {
            return Err(format!(
                "download aborted: directory nesting exceeds {MAX_TRANSFER_DEPTH}"
            ));
        }
        let dest = local_dir.join(&name);

        if is_dir {
            tokio::fs::create_dir_all(&dest)
                .await
                .map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
            let read = sftp
                .read_dir(remote_path.clone())
                .await
                .map_err(|e| format!("sftp read_dir {remote_path}: {e}"))?;
            for ent in read {
                let child_name = ent.file_name();
                // The server controls this name; reject anything that isn't a
                // single safe component before using it as a local leaf.
                let safe = safe_component(&child_name)?.to_string();
                let child_remote = posix_join(&remote_path, &safe);
                let child_is_dir = ent.file_type().is_dir();
                sftp_download(sftp, child_remote, safe, child_is_dir, &dest, depth + 1, budget)
                    .await?;
            }
        } else {
            let remote = sftp
                .open(remote_path.clone())
                .await
                .map_err(|e| format!("sftp open {remote_path}: {e}"))?;
            let mut out = tokio::fs::File::create(&dest)
                .await
                .map_err(|e| format!("create {}: {e}", dest.display()))?;
            // Hard-cap a single stream so a malicious/endless remote file can't
            // fill the disk; +1 byte lets us detect overflow past the budget.
            let remaining = MAX_TRANSFER_BYTES.saturating_sub(budget.bytes);
            use tokio::io::AsyncReadExt;
            let mut limited = remote.take(remaining.saturating_add(1));
            let n = tokio::io::copy(&mut limited, &mut out)
                .await
                .map_err(|e| format!("download {remote_path}: {e}"))?;
            if n > remaining {
                let _ = tokio::fs::remove_file(&dest).await;
                return Err(format!(
                    "download aborted: exceeded {} GiB total",
                    MAX_TRANSFER_BYTES / (1024 * 1024 * 1024)
                ));
            }
            budget.add_file(n)?;
        }
        Ok(())
    })
}

/// Download a remote entry (file or directory) into a local destination
/// directory. For SSH tabs this streams over SFTP; for local tabs it's a
/// recursive local copy. Returns the number of files transferred.
#[tauri::command]
pub async fn fs_download(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
    dest_dir: String,
) -> Result<u64, String> {
    let mut budget = Budget::default();
    let dest = PathBuf::from(&dest_dir);
    if is_local_session(&state, &session_id) {
        local_copy(PathBuf::from(&path), &dest, 0, &mut budget).await?;
    } else {
        // Validate the top-level leaf too, so even the first entry can't escape
        // the chosen destination dir.
        let leaf = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
        let name = safe_component(leaf)?.to_string();
        let sftp = open_sftp(&state, &session_id).await?;
        sftp_download(&sftp, path, name, is_dir, &dest, 0, &mut budget).await?;
    }
    Ok(budget.files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_component_rejects_traversal() {
        // Exactly the vectors a malicious/MITM SFTP server can return as a
        // READDIR entry name to escape the chosen download dir.
        for bad in [
            "",
            ".",
            "..",
            "../etc/passwd",
            "..\\..\\..\\Windows\\System32\\evil.dll",
            "C:\\Windows\\evil.dll",
            "C:/Windows/evil.dll",
            "foo/bar",
            "foo\\bar",
            "\\\\server\\share\\evil",
            "stream:ads",
        ] {
            assert!(safe_component(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn safe_component_accepts_plain_names() {
        for ok in ["file.txt", "My Folder", "a.tar.gz", "report-2024", "项目"] {
            assert_eq!(safe_component(ok).unwrap(), ok);
        }
    }

    #[test]
    fn budget_enforces_caps() {
        let mut b = Budget::default();
        assert!(b.add_file(10).is_ok());
        assert_eq!(b.files, 1);
        assert_eq!(b.bytes, 10);
        // One byte over the cumulative byte cap is rejected.
        let mut b = Budget::default();
        assert!(b.add_file(MAX_TRANSFER_BYTES + 1).is_err());
    }

    #[test]
    fn posix_join_handles_trailing_slash() {
        assert_eq!(posix_join("/a/b", "c"), "/a/b/c");
        assert_eq!(posix_join("/a/b/", "c"), "/a/b/c");
        assert_eq!(posix_join("/", "c"), "/c");
    }
}
