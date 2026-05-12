use crate::ssh::{self, ExecResult};
use crate::AppState;
use serde::Serialize;
use tauri::State;
use tokio::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Default, Clone, Serialize)]
pub struct GitViewData {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
    pub status: Vec<StatusEntry>,
    pub log: Vec<LogLine>,
    pub not_a_repo: bool,
    pub error: Option<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    /// Index status char from `git status --porcelain=v1` (column 1).
    pub staged: String,
    /// Worktree status char (column 2).
    pub work: String,
    pub path: String,
    /// For renames/copies: original path.
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    /// Graph prefix characters from `git log --graph` (e.g. `* ` or `|\`).
    pub graph: String,
    /// `Some` when this line carries commit metadata; `None` for graph-only
    /// connector lines like `|\` or `| |`.
    pub commit: Option<CommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub hash_short: String,
    pub author: String,
    pub time_relative: String,
    pub refs: String,
    pub subject: String,
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// True when this session was opened by local_open_pty (no russh handle).
pub(crate) fn is_local_session(state: &AppState, session_id: &str) -> bool {
    state
        .sessions
        .get(session_id)
        .map(|h| h.session.is_none())
        .unwrap_or(false)
}

/// Run a git command — locally via tokio::process for local-PTY tabs, or
/// over an SSH exec channel for remote tabs. `args` are passed verbatim
/// (no shell interpolation).
async fn run_git(
    state: &AppState,
    session_id: &str,
    cwd: &str,
    args: &[&str],
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    if is_local_session(state, session_id) {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(cwd).args(args);
        #[cfg(target_os = "windows")]
        cmd.as_std_mut().creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let out = cmd
            .output()
            .await
            .map_err(|e| format!("spawn git: {}", e))?;
        Ok(ExecResult {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code().map(|c| c as u32),
        })
    } else {
        let cwd_q = shell_quote(cwd);
        let args_q: Vec<String> = args.iter().map(|a| shell_quote(a)).collect();
        // Wrap in `bash -lc` so the user's login PATH is loaded — sshd's exec
        // channel runs a non-interactive non-login shell by default, which
        // skips .bashrc/.bash_profile, so `git` is often not on PATH even
        // though it works fine in the interactive PTY tab.
        let inner = format!("git -C {} {} 2>&1", cwd_q, args_q.join(" "));
        let cmd = format!("bash -lc {}", shell_quote(&inner));
        ssh::run_exec(state, session_id, &cmd, 1024 * 1024, timeout_ms).await
    }
}


#[tauri::command]
pub async fn git_view(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<GitViewData, String> {
    let mut data = GitViewData {
        cwd: cwd.clone(),
        ..Default::default()
    };

    // 1. Is this even a git repository?
    let repo_check = run_git(
        &state,
        &session_id,
        &cwd,
        &["rev-parse", "--is-inside-work-tree"],
        5000,
    )
    .await?;
    if repo_check.exit_code != Some(0) {
        // exit 128 with "fatal: not a git repository" is the expected
        // not-a-repo case. Anything else (e.g. exit 127 "git: command not
        // found", PATH issues) gets surfaced as an error so the user can
        // tell apart "this dir isn't a repo" from "git couldn't even run".
        let combined = format!("{}{}", repo_check.stdout.trim(), repo_check.stderr.trim());
        if combined.contains("not a git repository") {
            data.not_a_repo = true;
        } else {
            data.error = Some(format!(
                "git rev-parse failed (exit {:?}): {}",
                repo_check.exit_code,
                if combined.is_empty() {
                    "(no output)".to_string()
                } else {
                    combined
                },
            ));
        }
        return Ok(data);
    }

    // 2. Status (branch + porcelain).
    let status_res = run_git(
        &state,
        &session_id,
        &cwd,
        &["status", "--porcelain=v1", "-b"],
        8000,
    )
    .await?;
    parse_status(&status_res.stdout, &mut data);

    // 3. Recent log with graph.
    let log_res = run_git(
        &state,
        &session_id,
        &cwd,
        &[
            "log",
            "--graph",
            "--color=never",
            "--pretty=format:BSHCMT|%H|%h|%an|%ar|%d|%s",
            "-n",
            "40",
        ],
        8000,
    )
    .await?;
    data.log = parse_log(&log_res.stdout);

    Ok(data)
}

fn parse_status(block: &str, data: &mut GitViewData) {
    for raw in block.lines() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("## ") {
            parse_branch_line(rest, data);
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let mut chars = line.chars();
        let staged = chars.next().unwrap_or(' ');
        let work = chars.next().unwrap_or(' ');
        // Skip the separating space.
        let _ = chars.next();
        let rest: String = chars.collect();

        // Renames look like "R  oldname -> newname".
        let (path, orig) = if let Some(idx) = rest.find(" -> ") {
            (rest[idx + 4..].to_string(), Some(rest[..idx].to_string()))
        } else {
            (rest, None)
        };

        data.status.push(StatusEntry {
            staged: staged.to_string(),
            work: work.to_string(),
            path,
            orig_path: orig,
        });
    }
}

fn parse_branch_line(rest: &str, data: &mut GitViewData) {
    if rest.starts_with("HEAD (no branch)") {
        data.detached = true;
        return;
    }
    // Possible shapes:
    //   main
    //   main...origin/main
    //   main...origin/main [ahead 2]
    //   main...origin/main [ahead 2, behind 1]
    //   main...origin/main [behind 1]
    let (head, tail) = rest.split_once(' ').unwrap_or((rest, ""));
    if let Some((branch, upstream)) = head.split_once("...") {
        data.branch = Some(branch.to_string());
        data.upstream = Some(upstream.to_string());
    } else {
        data.branch = Some(head.to_string());
    }
    if let Some(start) = tail.find('[') {
        if let Some(end) = tail[start + 1..].find(']') {
            let inside = &tail[start + 1..start + 1 + end];
            for part in inside.split(',') {
                let p = part.trim();
                if let Some(n) = p.strip_prefix("ahead ") {
                    data.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = p.strip_prefix("behind ") {
                    data.behind = n.parse().unwrap_or(0);
                }
            }
        }
    }
}

fn parse_log(block: &str) -> Vec<LogLine> {
    let mut out = Vec::new();
    for raw in block.lines() {
        let line = raw.trim_end_matches('\r');
        if let Some(idx) = line.find("BSHCMT|") {
            let graph = line[..idx].trim_end().to_string();
            let rest = &line[idx + "BSHCMT|".len()..];
            let parts: Vec<&str> = rest.splitn(6, '|').collect();
            if parts.len() == 6 {
                out.push(LogLine {
                    graph,
                    commit: Some(CommitInfo {
                        hash: parts[0].to_string(),
                        hash_short: parts[1].to_string(),
                        author: parts[2].to_string(),
                        time_relative: parts[3].to_string(),
                        refs: parts[4].trim().to_string(),
                        subject: parts[5].to_string(),
                    }),
                });
                continue;
            }
        }
        // Graph-only or unparseable line — keep it so graph topology renders.
        if !line.trim().is_empty() {
            out.push(LogLine {
                graph: line.to_string(),
                commit: None,
            });
        }
    }
    out
}

#[tauri::command]
pub async fn git_diff(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    path: String,
    staged: bool,
) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    // Anchor pathspec to repo top — see git_commit_file_diff for rationale.
    let top_path = format!(":/{}", path);
    args.extend_from_slice(&["--no-color", "--", &top_path]);
    let res = run_git(&state, &session_id, &cwd, &args, 8000).await?;
    Ok(combine_out(&res))
}

#[tauri::command]
pub async fn git_show(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    rev: String,
) -> Result<String, String> {
    let res = run_git(
        &state,
        &session_id,
        &cwd,
        &["show", "--no-color", "--stat", "--patch", &rev],
        10000,
    )
    .await?;
    Ok(combine_out(&res))
}

fn combine_out(r: &ExecResult) -> String {
    if r.stderr.is_empty() {
        r.stdout.clone()
    } else if r.stdout.is_empty() {
        r.stderr.clone()
    } else {
        format!("{}{}", r.stdout, r.stderr)
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct CommitDetail {
    pub hash: String,
    pub hash_short: String,
    pub author: String,
    pub author_date: String,
    pub committer: String,
    pub committer_date: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub body: String,
    pub files: Vec<CommitFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitFile {
    /// Two-or-more char status from --name-status: M, A, D, R100, C75, etc.
    pub status: String,
    /// Path the file has *after* the commit. For renames/copies this is the
    /// destination path.
    pub path: String,
    /// For renames/copies only: original path before the rename.
    pub orig_path: Option<String>,
}

#[tauri::command]
pub async fn git_commit_detail(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    rev: String,
) -> Result<CommitDetail, String> {
    // Run two separate git invocations and stitch them together — works the
    // same on local Command and SSH exec channels.
    let format = "%H%n%h%n%an <%ae>%n%ad%n%cn <%ce>%n%cd%n%P%n__BSH_BODY__%n%B__BSH_END__";
    let pretty = format!("--pretty=format:{}", format);
    let meta = run_git(
        &state,
        &session_id,
        &cwd,
        &["show", "--no-color", "--no-patch", &pretty, &rev],
        8000,
    )
    .await?;
    let names = run_git(
        &state,
        &session_id,
        &cwd,
        &["show", "--no-color", "--name-status", "--pretty=format:", &rev],
        8000,
    )
    .await?;
    let combined = format!("{}\n__BSH_FILES__\n{}", meta.stdout, names.stdout);
    parse_commit_detail(&combined)
}

fn parse_commit_detail(s: &str) -> Result<CommitDetail, String> {
    let body_marker = "__BSH_BODY__";
    let body_end_marker = "__BSH_END__";
    let files_marker = "__BSH_FILES__";

    let body_idx = s
        .find(body_marker)
        .ok_or_else(|| format!("no body marker in: {}", &s[..s.len().min(200)]))?;
    let body_end_idx = s
        .find(body_end_marker)
        .ok_or_else(|| "no body-end marker".to_string())?;
    let files_idx = s
        .find(files_marker)
        .ok_or_else(|| "no files marker".to_string())?;

    let header = &s[..body_idx];
    let body_section = &s[body_idx + body_marker.len()..body_end_idx];
    let files_section = s[files_idx + files_marker.len()..].trim();

    let mut hd = header.lines();
    let hash = hd.next().unwrap_or("").to_string();
    let hash_short = hd.next().unwrap_or("").to_string();
    let author = hd.next().unwrap_or("").to_string();
    let author_date = hd.next().unwrap_or("").to_string();
    let committer = hd.next().unwrap_or("").to_string();
    let committer_date = hd.next().unwrap_or("").to_string();
    let parents: Vec<String> = hd
        .next()
        .unwrap_or("")
        .split_whitespace()
        .map(String::from)
        .collect();

    let body_text = body_section.trim_matches('\n');
    let (subject, body) = match body_text.split_once('\n') {
        Some((s, b)) => (s.to_string(), b.trim_start_matches('\n').trim_end().to_string()),
        None => (body_text.to_string(), String::new()),
    };

    let mut files = Vec::new();
    for line in files_section.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let status = parts.next().unwrap_or("").to_string();
        let p1 = parts.next().unwrap_or("").to_string();
        let p2 = parts.next().map(String::from);
        if p1.is_empty() {
            continue;
        }
        let (path, orig) = if (status.starts_with('R') || status.starts_with('C')) && p2.is_some() {
            (p2.unwrap(), Some(p1))
        } else {
            (p1, None)
        };
        files.push(CommitFile {
            status,
            path,
            orig_path: orig,
        });
    }

    Ok(CommitDetail {
        hash,
        hash_short,
        author,
        author_date,
        committer,
        committer_date,
        parents,
        subject,
        body,
        files,
    })
}

#[tauri::command]
pub async fn git_commit_file_diff(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    rev: String,
    path: String,
) -> Result<String, String> {
    // Paths from `--name-status` are relative to the repo top, but `git show
    // -- <pathspec>` resolves the pathspec from the current cwd. When `cwd` is
    // a subdirectory of the repo, that mismatch yields an empty diff. The `:/`
    // magic prefix anchors the pathspec to the repo root.
    let top_path = format!(":/{}", path);
    let res = run_git(
        &state,
        &session_id,
        &cwd,
        // --format= suppresses the commit metadata header (already shown in
        // the modal's CommitMeta block) so only the diff body comes back.
        &["show", "--no-color", "--format=", &rev, "--", &top_path],
        10000,
    )
    .await?;
    Ok(combine_out(&res))
}

/// Show an untracked file as a "new file" diff against /dev/null. Renders nicely
/// in the same diff viewer as tracked changes.
#[tauri::command]
pub async fn git_show_untracked(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    path: String,
) -> Result<String, String> {
    // Windows local doesn't have /dev/null but git accepts NUL as a sentinel
    // when the platform is Windows. Easier: just emit the file contents
    // unchanged with a header. Works everywhere.
    if is_local_session(&state, &session_id) {
        // Use `git diff --no-index` against an empty file we synthesise via
        // `--no-index` of two paths. Simpler: cat-style fake diff.
        let abs = format!("{}/{}", cwd.trim_end_matches('/'), path);
        let bytes = match tokio::fs::read(&abs).await {
            Ok(b) => b,
            Err(e) => return Err(format!("read {}: {}", abs, e)),
        };
        let header = format!(
            "diff --git a/{p} b/{p}\nnew file mode 100644\n--- /dev/null\n+++ b/{p}\n",
            p = path
        );
        let body: String = String::from_utf8_lossy(&bytes)
            .lines()
            .map(|l| format!("+{}\n", l))
            .collect();
        return Ok(format!("{}{}", header, body));
    }
    let cwd_q = shell_quote(&cwd);
    let path_q = shell_quote(&path);
    let cmd = format!(
        "git -C {} diff --no-index --no-color -- /dev/null {} 2>&1",
        cwd_q, path_q
    );
    let res = ssh::run_exec(&state, &session_id, &cmd, 1024 * 1024, 5000).await?;
    Ok(res.stdout)
}

/// Return the raw UTF-8 content of a file from the git object store.
///
/// `rev`:
///   - `None`       → working-tree file (reads from disk / SSH cat)
///   - `"staged"`   → index version (`git show :<path>`)
///   - any string   → specific commit (`git show <rev>:<path>`)
#[tauri::command]
pub async fn git_show_file_content(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    path: String,
    rev: Option<String>,
) -> Result<String, String> {
    match rev.as_deref() {
        None => {
            // Working-tree / untracked: read the actual file on disk.
            // Paths from `git status --porcelain` are relative to the repo root,
            // so resolve the root first.
            let root_res = run_git(
                &state, &session_id, &cwd,
                &["rev-parse", "--show-toplevel"],
                5000,
            ).await?;
            let root = root_res.stdout.trim().to_string();
            if root.is_empty() {
                return Err("could not determine repo root".into());
            }
            let abs = format!("{}/{}", root, path);
            if is_local_session(&state, &session_id) {
                let bytes = tokio::fs::read(&abs).await
                    .map_err(|e| format!("read {abs}: {e}"))?;
                String::from_utf8(bytes)
                    .map_err(|_| "file is not valid UTF-8".into())
            } else {
                let abs_q = shell_quote(&abs);
                let res = ssh::run_exec(
                    &state, &session_id, &format!("cat {abs_q}"),
                    4 * 1024 * 1024, 5000,
                ).await?;
                Ok(res.stdout)
            }
        }
        Some("staged") => {
            // Index version.
            let index_ref = format!(":{}", path);
            let res = run_git(&state, &session_id, &cwd, &["show", &index_ref], 10000).await?;
            Ok(combine_out(&res))
        }
        Some(rev_hash) => {
            // Committed version. Paths in the object store are always relative
            // to the repo root, so `<rev>:<path>` works regardless of cwd.
            let rev_ref = format!("{}:{}", rev_hash, path);
            let res = run_git(&state, &session_id, &cwd, &["show", &rev_ref], 10000).await?;
            Ok(combine_out(&res))
        }
    }
}

/// Run a single command on an SSH exec channel and return its stdout.
/// Returns an error for local-PTY sessions — callers should fall back to the
/// saved 📍 cwd rather than trying to probe the PTY.
#[tauri::command]
pub async fn session_exec_capture(
    state: State<'_, AppState>,
    session_id: String,
    cmd: String,
) -> Result<String, String> {
    if is_local_session(&state, &session_id) {
        return Err("local".into());
    }
    let res = ssh::run_exec(&state, &session_id, &cmd, 64 * 1024, 5000).await?;
    Ok(res.stdout.trim().to_string())
}
