//! Read saved Claude Code conversations without sending anything to the PTY.
use crate::{files::open_sftp, AppState};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt, SeekFrom};
use uuid::Uuid;

const SCAN_BYTES: u64 = 512 * 1024;
const PREVIEW_BYTES: u64 = 16 * 1024;
const PAGE_SIZE: usize = 50;
const SESSIONS_PER_PAGE: usize = 12;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSource {
    ssh_session_id: Option<String>,
    config_dir: Option<String>,
}

enum Repository {
    Local(PathBuf),
    Remote(Box<SftpSession>, String),
}

struct Entry {
    name: String,
    is_dir: bool,
    modified: u64,
}

trait ReadSeek: AsyncRead + AsyncSeek + Unpin + Send {}
impl<T: AsyncRead + AsyncSeek + Unpin + Send> ReadSeek for T {}

fn error(message: impl std::fmt::Display) -> String {
    message.to_string()
}

fn remote_join(dir: &str, child: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), child)
}

fn project_name(project: &str) -> bool {
    !project.is_empty()
        && project != "."
        && project != ".."
        && !project.contains(['/', '\\', ':'])
        && !project.chars().any(char::is_control)
        && Path::new(project)
            .file_name()
            .is_some_and(|part| part == project)
}

fn modified(time: std::io::Result<SystemTime>) -> u64 {
    time.ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_secs())
}

impl Repository {
    async fn connect(state: &AppState, source: ClaudeSource) -> Result<Self, String> {
        let configured = source.config_dir.filter(|path| !path.is_empty());
        if let Some(id) = source.ssh_session_id {
            let sftp = open_sftp(state, &id)
                .await
                .map_err(|_| "Could not open SFTP for this SSH tab.".to_string())?;
            let config = configured.unwrap_or_else(|| ".claude".to_string());
            let root = sftp
                .canonicalize(remote_join(&config, "projects"))
                .await
                .map_err(|_| "Claude projects folder is unavailable over SFTP. Check the config folder and permissions.".to_string())?;
            Ok(Self::Remote(Box::new(sftp), root))
        } else {
            let config = configured
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var_os("CLAUDE_CONFIG_DIR")
                        .filter(|path| !path.is_empty())
                        .map(PathBuf::from)
                })
                .or_else(|| {
                    directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".claude"))
                })
                .ok_or_else(|| "Could not find your Claude config folder.".to_string())?;
            let root = tokio::fs::canonicalize(config.join("projects"))
                .await
                .map_err(|_| {
                    "Claude projects folder is unavailable. Check the Claude config folder."
                        .to_string()
                })?;
            Ok(Self::Local(root))
        }
    }

    async fn entries(&self, project: Option<&str>) -> Result<Vec<Entry>, String> {
        if project.is_some_and(|name| !project_name(name)) {
            return Err("Invalid Claude project folder.".into());
        }
        let mut entries = Vec::new();
        match self {
            Self::Local(root) => {
                let path = if let Some(project) = project {
                    let path = tokio::fs::canonicalize(root.join(project))
                        .await
                        .map_err(error)?;
                    if path.parent() != Some(root) {
                        return Err(
                            "Claude project is outside the configured projects folder.".into()
                        );
                    }
                    path
                } else {
                    root.clone()
                };
                let mut dir = tokio::fs::read_dir(path).await.map_err(error)?;
                while let Some(item) = dir.next_entry().await.map_err(error)? {
                    let Ok(name) = item.file_name().into_string() else {
                        continue;
                    };
                    let Ok(kind) = item.file_type().await else {
                        continue;
                    };
                    if kind.is_dir() || kind.is_file() {
                        let time = item
                            .metadata()
                            .await
                            .ok()
                            .map(|meta| modified(meta.modified()));
                        entries.push(Entry {
                            name,
                            is_dir: kind.is_dir(),
                            modified: time.unwrap_or(0),
                        });
                    }
                }
            }
            Self::Remote(sftp, root) => {
                let dir =
                    project.map_or_else(|| root.clone(), |project| remote_join(root, project));
                if project.is_some() && sftp.canonicalize(&dir).await.map_err(error)? != dir {
                    return Err("Claude project resolves to a different folder.".into());
                }
                let listing = sftp.read_dir(dir).await.map_err(error)?;
                for item in listing {
                    let kind = item.file_type();
                    if kind.is_dir() || kind.is_file() {
                        entries.push(Entry {
                            name: item.file_name(),
                            is_dir: kind.is_dir(),
                            modified: modified(item.metadata().modified()),
                        });
                    }
                }
            }
        }
        entries.sort_unstable_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
        Ok(entries)
    }

    async fn open(&self, project: &str, id: &str) -> Result<(Box<dyn ReadSeek>, u64), String> {
        if !project_name(project) || !session_id(id) {
            return Err("Invalid Claude transcript selection.".into());
        }
        let name = format!("{id}.jsonl");
        match self {
            Self::Local(root) => {
                let dir = tokio::fs::canonicalize(root.join(project))
                    .await
                    .map_err(error)?;
                let path = dir.join(name);
                let path = tokio::fs::canonicalize(&path).await.map_err(error)?;
                if dir.parent() != Some(root) || path.parent() != Some(&dir) {
                    return Err("Claude transcript is outside the selected project.".into());
                }
                if !tokio::fs::metadata(&path).await.map_err(error)?.is_file() {
                    return Err("Claude transcript is not a regular file.".into());
                }
                let file = tokio::fs::File::open(path).await.map_err(error)?;
                let size = file.metadata().await.map_err(error)?.len();
                Ok((Box::new(file), size))
            }
            Self::Remote(sftp, root) => {
                let path = remote_join(&remote_join(root, project), &name);
                if sftp.canonicalize(&path).await.map_err(error)? != path {
                    return Err("Claude transcript resolves to a different file.".into());
                }
                if !sftp
                    .metadata(&path)
                    .await
                    .map_err(error)?
                    .file_type()
                    .is_file()
                {
                    return Err("Claude transcript is not a regular file.".into());
                }
                let file = sftp.open(path).await.map_err(error)?;
                let size = file.metadata().await.map_err(error)?.len();
                Ok((Box::new(file), size))
            }
        }
    }
}

fn session_id(id: &str) -> bool {
    id.len() == 36 && Uuid::parse_str(id).is_ok()
}

#[tauri::command]
pub async fn claude_projects(
    state: State<'_, AppState>,
    source: ClaudeSource,
) -> Result<Vec<String>, String> {
    Ok(Repository::connect(&state, source)
        .await?
        .entries(None)
        .await?
        .into_iter()
        .filter(|entry| entry.is_dir && project_name(&entry.name))
        .map(|entry| entry.name)
        .collect())
}

#[derive(Serialize)]
pub struct SessionSummary {
    id: String,
    title: Option<String>,
    cwd: Option<String>,
    modified: u64,
}

#[derive(Serialize)]
pub struct SessionList {
    sessions: Vec<SessionSummary>,
    next: Option<usize>,
}

#[tauri::command]
pub async fn claude_sessions(
    state: State<'_, AppState>,
    source: ClaudeSource,
    project: String,
    offset: usize,
    previews: bool,
) -> Result<SessionList, String> {
    let repository = std::sync::Arc::new(Repository::connect(&state, source).await?);
    let mut entries = repository
        .entries(Some(&project))
        .await?
        .into_iter()
        .filter(|entry| !entry.is_dir && entry.name.strip_suffix(".jsonl").is_some_and(session_id))
        .skip(offset)
        .take(SESSIONS_PER_PAGE + 1)
        .collect::<Vec<_>>();
    let next = (entries.len() > SESSIONS_PER_PAGE).then(|| offset + SESSIONS_PER_PAGE);
    entries.truncate(SESSIONS_PER_PAGE);
    if !previews {
        let sessions = entries
            .into_iter()
            .map(|entry| SessionSummary {
                id: entry.name.trim_end_matches(".jsonl").to_string(),
                title: None,
                cwd: None,
                modified: entry.modified,
            })
            .collect();
        return Ok(SessionList { sessions, next });
    }
    let mut jobs = tokio::task::JoinSet::new();
    for (index, entry) in entries.into_iter().enumerate() {
        let repository = repository.clone();
        let project = project.clone();
        jobs.spawn(async move {
            let id = entry.name.trim_end_matches(".jsonl").to_string();
            let preview = tokio::time::timeout(Duration::from_secs(5), async {
                let (mut file, _) = repository.open(&project, &id).await?;
                let bytes = read_window(&mut *file, 0, PREVIEW_BYTES).await?;
                Ok::<_, String>(session_preview(&bytes))
            })
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
            (
                index,
                SessionSummary {
                    id,
                    title: preview.0,
                    cwd: preview.1,
                    modified: entry.modified,
                },
            )
        });
    }
    let mut sessions = Vec::new();
    while let Some(result) = jobs.join_next().await {
        sessions.push(result.map_err(error)?);
    }
    sessions.sort_unstable_by_key(|(index, _)| *index);
    Ok(SessionList {
        sessions: sessions.into_iter().map(|(_, session)| session).collect(),
        next,
    })
}

fn session_preview(bytes: &[u8]) -> (Option<String>, Option<String>) {
    let mut title = None;
    let mut cwd = None;
    for line in bytes.split(|byte| *byte == b'\n') {
        let Ok(entry) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if hidden_entry(&entry) {
            continue;
        }
        if cwd.is_none() {
            cwd = entry["cwd"].as_str().map(|value| shortened(value, 400));
        }
        if let Some(label) = entry["customTitle"]
            .as_str()
            .or_else(|| entry["aiTitle"].as_str())
        {
            title = Some(shortened(label, 140));
        } else if title.is_none() && entry["type"] == "user" {
            let content = &entry["message"]["content"];
            let text = content.as_str().or_else(|| {
                content
                    .as_array()?
                    .iter()
                    .find(|block| block["type"] == "text")?["text"]
                    .as_str()
            });
            title = text
                .map(str::trim)
                .filter(|text| !text.is_empty() && !text.starts_with("<local-command"))
                .map(|text| shortened(text, 140));
        }
    }
    (title, cwd)
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    offset: u64,
    skip_partial: bool,
}

#[derive(Serialize)]
pub struct ChatBlock {
    kind: &'static str,
    label: Option<String>,
    text: String,
}

#[derive(Serialize)]
pub struct Message {
    offset: u64,
    id: Option<String>,
    role: &'static str,
    blocks: Vec<ChatBlock>,
}

#[derive(Serialize)]
pub struct TranscriptPage {
    messages: Vec<Message>,
    before: Option<u64>,
    after: Cursor,
    reset: bool,
    skipped: bool,
}

#[tauri::command]
pub async fn claude_transcript(
    state: State<'_, AppState>,
    source: ClaudeSource,
    project: String,
    id: String,
    before: Option<u64>,
    after: Option<Cursor>,
) -> Result<TranscriptPage, String> {
    tokio::time::timeout(Duration::from_secs(18), async {
        let repository = Repository::connect(&state, source).await?;
        let (mut file, size) = repository.open(&project, &id).await?;
        let requested_offset = before.or(after.map(|cursor| cursor.offset));
        let reset = requested_offset.is_some_and(|offset| offset > size);
        if let Some(cursor) = after.filter(|_| !reset) {
            let bytes = read_window(
                &mut *file,
                cursor.offset,
                SCAN_BYTES.min(size - cursor.offset),
            )
            .await?;
            return Ok(parse_page(
                &bytes,
                cursor.offset,
                cursor.skip_partial,
                true,
                false,
            ));
        }

        let end = before.filter(|_| !reset).unwrap_or(size);
        let start = end.saturating_sub(SCAN_BYTES);
        let read_start = start.saturating_sub(1);
        let bytes = read_window(&mut *file, read_start, end - read_start).await?;
        let bytes = bytes.as_slice();
        if start > 0 {
            return Ok(parse_page(
                bytes.get(1..).unwrap_or_default(),
                start,
                bytes.first() != Some(&b'\n'),
                false,
                reset,
            ));
        }
        Ok(parse_page(bytes, start, false, false, reset))
    })
    .await
    .map_err(|_| "Timed out reading the Claude transcript.".to_string())?
}

async fn read_window(file: &mut dyn ReadSeek, start: u64, length: u64) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(start)).await.map_err(error)?;
    let mut result = Vec::with_capacity(length as usize);
    file.take(length)
        .read_to_end(&mut result)
        .await
        .map_err(error)?;
    Ok(result)
}

fn parse_page(
    bytes: &[u8],
    start: u64,
    skip_first: bool,
    forward: bool,
    reset: bool,
) -> TranscriptPage {
    let mut cursor = start;
    let mut first_line = start;
    let mut skip_partial = skip_first;
    let mut skipped = false;
    let mut messages = Vec::new();
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if !line.ends_with(b"\n") {
            break;
        }
        let offset = cursor;
        cursor += line.len() as u64;
        if skip_partial {
            skip_partial = false;
            first_line = cursor;
            continue;
        }
        if let Some(message) = parse_message(line, offset) {
            messages.push(message);
            if forward && messages.len() == PAGE_SIZE {
                break;
            }
        }
    }
    // Advance across a record bigger than the read window. Keep dropping
    // its fragments on later reads until the terminating newline arrives.
    if cursor == start && bytes.len() as u64 >= SCAN_BYTES {
        cursor += bytes.len() as u64;
        skip_partial = true;
        skipped = true;
    }
    let before = if forward {
        None
    } else if messages.len() > PAGE_SIZE {
        messages.drain(..messages.len() - PAGE_SIZE);
        messages
            .first()
            .map(|message| message.offset)
            .filter(|offset| *offset > 0)
    } else {
        if skip_first && messages.is_empty() && first_line == start + bytes.len() as u64 {
            skipped = true;
            first_line = start;
        }
        (first_line > 0).then_some(first_line)
    };
    TranscriptPage {
        messages,
        before,
        after: Cursor {
            offset: cursor,
            skip_partial,
        },
        reset,
        skipped,
    }
}

fn hidden_entry(entry: &Value) -> bool {
    entry["isSidechain"] == true || entry["isMeta"] == true || entry["teamName"].is_string()
}

fn shortened(value: &str, limit: usize) -> String {
    match value.char_indices().nth(limit) {
        Some((index, _)) => format!("{}…", &value[..index]),
        None => value.to_string(),
    }
}

fn parse_message(line: &[u8], offset: u64) -> Option<Message> {
    let entry = serde_json::from_slice::<Value>(line).ok()?;
    if hidden_entry(&entry) {
        return None;
    }
    let role = match entry["type"].as_str()? {
        "user" if entry["isCompactSummary"] == true => "summary",
        "user" => "user",
        "assistant" => "assistant",
        _ => return None,
    };
    let content = &entry["message"]["content"];
    let blocks = if let Some(text) = content.as_str() {
        vec![ChatBlock {
            kind: "text",
            label: None,
            text: shortened(text, 48_000),
        }]
    } else {
        content
            .as_array()?
            .iter()
            .filter_map(|block| {
                let (kind, label, text) = match block["type"].as_str()? {
                    "text" => ("text", None, shortened(block["text"].as_str()?, 48_000)),
                    "tool_use" => (
                        "tool",
                        block["name"].as_str().map(|name| shortened(name, 60)),
                        shortened(&block["input"].to_string(), 8_000),
                    ),
                    "tool_result" => {
                        let result = &block["content"];
                        let text = if let Some(parts) = result.as_array() {
                            parts
                                .iter()
                                .map(|part| part["text"].as_str().unwrap_or("[Attachment]"))
                                .collect::<Vec<_>>()
                                .join("\n")
                        } else {
                            result
                                .as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| result.to_string())
                        };
                        ("result", None, shortened(&text, 8_000))
                    }
                    "image" | "document" => ("attachment", None, "Attachment".to_string()),
                    _ => return None,
                };
                Some(ChatBlock { kind, label, text })
            })
            .collect()
    };
    if blocks.is_empty() {
        return None;
    }
    let role = if role == "user" && blocks.iter().all(|block| block.kind == "result") {
        "tool"
    } else {
        role
    };
    Some(Message {
        offset,
        id: entry["uuid"].as_str().map(|id| shortened(id, 64)),
        role,
        blocks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": text },
            })
        )
    }

    #[test]
    fn returns_a_recent_page_and_a_cursor_for_every_older_message() {
        let transcript: String = (0..65).map(|i| user(&format!("message {i}"))).collect();
        let latest = parse_page(transcript.as_bytes(), 0, false, false, false);
        assert_eq!(latest.messages.len(), 50);
        assert_eq!(latest.messages[0].blocks[0].text, "message 15");
        assert_eq!(latest.after.offset as usize, transcript.len());

        let end = latest.before.unwrap() as usize;
        let earlier = parse_page(&transcript.as_bytes()[..end], 0, false, false, false);
        assert_eq!(earlier.messages.len(), 15);
        assert_eq!(earlier.messages[14].blocks[0].text, "message 14");
        assert_eq!(earlier.before, None);
    }

    #[test]
    fn partial_lines_are_read_once_the_writer_finishes_them() {
        let first = user("already saved");
        let second = user("next 日本語");
        let pending = format!("{first}{}", &second[..second.len() - 1]);
        let page = parse_page(pending.as_bytes(), 0, false, false, false);
        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.after.offset as usize, first.len());
        let appended = parse_page(
            second.as_bytes(),
            page.after.offset,
            page.after.skip_partial,
            true,
            false,
        );
        assert_eq!(appended.messages[0].blocks[0].text, "next 日本語");
        assert_eq!(appended.after.offset as usize, first.len() + second.len());
    }

    #[test]
    fn earlier_cursor_restores_a_record_cut_by_the_read_boundary() {
        let first = user("cut by initial read");
        let second = user("continue");
        let transcript = format!("{first}{second}");
        let recent = parse_page(&transcript.as_bytes()[5..], 5, true, false, false);
        assert_eq!(recent.messages.len(), 1);
        assert_eq!(recent.before, Some(first.len() as u64));
        let earlier = parse_page(first.as_bytes(), 0, false, false, false);
        assert_eq!(earlier.messages[0].blocks[0].text, "cut by initial read");
    }

    #[test]
    fn oversized_fragments_advance_the_cursor_without_rendering_partial_json() {
        let chunk = vec![b'x'; SCAN_BYTES as usize];
        let page = parse_page(&chunk, 0, false, true, false);
        assert!(page.skipped);
        assert!(page.after.skip_partial);
        assert_eq!(page.after.offset, SCAN_BYTES);
        let tail = format!("end\n{}", user("next full record"));
        let page = parse_page(tail.as_bytes(), SCAN_BYTES, true, true, false);
        assert_eq!(page.messages[0].blocks[0].text, "next full record");
        assert!(!page.after.skip_partial);
    }

    #[test]
    fn decodes_tool_records_but_excludes_sidechains_and_thinking() {
        let record = br#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"example"}},{"type":"thinking","thinking":"private"},{"type":"text","text":"Done"}]}}"#;
        let message = parse_message(record, 0).unwrap();
        assert_eq!(message.blocks.len(), 2);
        assert_eq!(message.blocks[0].label.as_deref(), Some("Read"));
        let result =
            br#"{"type":"user","message":{"content":[{"type":"tool_result","content":"output"}]}}"#;
        assert_eq!(parse_message(result, 0).unwrap().role, "tool");
        let sidechain = br#"{"type":"user","isSidechain":true,"message":{"content":"Skip this"}}"#;
        assert!(parse_message(sidechain, 0).is_none());
    }
}
