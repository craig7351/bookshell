import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AuthMethod = "password";
export type ConnectionKind = "ssh" | "local";

/** Decode a base64 string (terminal output payload) into raw bytes. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  user: string;
  auth: AuthMethod;
  password?: string | null;
  /** Local-only: shell command, e.g. "powershell.exe", "/bin/bash". */
  shell?: string | null;
  /** Local-only: initial working directory. */
  cwd?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface FsEntry {
  name: string;
  /** Absolute path of this entry (server-computed). */
  path: string;
  is_dir: boolean;
  size: number;
}

export interface DirListing {
  /** Absolute directory that was listed. */
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  entries: FsEntry[];
}

export const api = {
  // SSH
  sshConnect: (params: {
    host: string;
    port: number;
    user: string;
    password: string;
    cols: number;
    rows: number;
  }) => invoke<string>("ssh_connect", params),

  sshOpenPty: (parentSessionId: string, cols: number, rows: number) =>
    invoke<string>("ssh_open_pty", { parentSessionId, cols, rows }),

  localOpenPty: (params: {
    shell?: string | null;
    cwd?: string | null;
    cols: number;
    rows: number;
  }) => invoke<string>("local_open_pty", params),

  sshWrite: (sessionId: string, data: string) =>
    invoke<void>("ssh_write", { sessionId, data }),

  sshResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("ssh_resize", { sessionId, cols, rows }),

  sshDisconnect: (sessionId: string) =>
    invoke<void>("ssh_disconnect", { sessionId }),

  /** Upload a local file to /tmp/bookshell-clip/<basename> on the remote
   *  host. Returns the absolute remote path. Used by clipboard image paste
   *  on SSH tabs. */
  sshUploadFile: (sessionId: string, localPath: string) =>
    invoke<string>("ssh_upload_file", { sessionId, localPath }),

  // Terminal output arrives base64-encoded (the backend coalesces reads and
  // sends a compact JSON string instead of a Vec<u8> → number-array payload,
  // which used to flood and freeze the UI thread). Decode to raw bytes and let
  // xterm's write() do the streaming UTF-8 decode.
  onSshData: (sessionId: string, cb: (bytes: Uint8Array) => void) =>
    listen<string>(`ssh://data/${sessionId}`, (e) => cb(b64ToBytes(e.payload))),

  onSshClose: (sessionId: string, cb: (reason: string) => void) =>
    listen<string>(`ssh://close/${sessionId}`, (e) => cb(e.payload)),

  // Config
  listConnections: () => invoke<Connection[]>("config_list_connections"),

  saveConnection: (connection: Connection) =>
    invoke<void>("config_save_connection", { connection }),

  deleteConnection: (id: string) =>
    invoke<void>("config_delete_connection", { id }),

  reorderConnections: (ids: string[]) =>
    invoke<void>("config_reorder_connections", { ids }),

  /** Open an http(s) URL in the user's default browser. */
  urlOpen: (url: string) => invoke<void>("url_open", { url }),

  /** Read an image from the OS clipboard, save it as PNG to a temp file, and
   *  return the absolute path. Returns null when the clipboard holds no
   *  image (text-only or empty). */
  clipboardSaveImage: () => invoke<string | null>("clipboard_save_image"),

  /** Write plain text to the OS clipboard via arboard (avoids WebKitGTK clipboard API hangs). */
  clipboardWriteText: (text: string) => invoke<void>("clipboard_write_text", { text }),

  /** Read plain text from the OS clipboard. Returns null when empty or image-only. */
  clipboardReadText: () => invoke<string | null>("clipboard_read_text"),

  /** Return raw UTF-8 content of a file from the git object store.
   *  rev = undefined → working-tree file, "staged" → index, any hash → commit. */
  gitShowFileContent: (sessionId: string, cwd: string, path: string, rev?: string) =>
    invoke<string>("git_show_file_content", { sessionId, cwd, path, rev: rev ?? null }),

  // File browser (local fs for local tabs, SFTP for SSH tabs)
  /** List a directory. Empty path resolves to the session's home dir.
   *  Paths in the result are absolute and computed server-side. */
  fsListDir: (sessionId: string, path: string) =>
    invoke<DirListing>("fs_list_dir", { sessionId, path }),
  /** Make a file available locally and return its local path. Local tabs pass
   *  through; remote files are pulled via SFTP into a temp dir. */
  fsDownloadFile: (sessionId: string, path: string) =>
    invoke<string>("fs_download_file", { sessionId, path }),
  /** Open a local path with the OS default application. */
  fsOpenPath: (path: string) => invoke<void>("fs_open_path", { path }),
  /** Native picker: choose one or more local files. Empty array if cancelled. */
  fsPickFiles: () => invoke<string[]>("fs_pick_files"),
  /** Native picker: choose a single local directory. Null if cancelled. */
  fsPickDir: () => invoke<string | null>("fs_pick_dir"),
  /** Upload local files/dirs into a remote (or local) directory. Recursive for
   *  directories; streams over SFTP for SSH tabs. Returns files transferred. */
  fsUpload: (sessionId: string, localPaths: string[], remoteDir: string) =>
    invoke<number>("fs_upload", { sessionId, localPaths, remoteDir }),
  /** Download a remote entry (file or dir) into a local destination directory.
   *  Recursive for directories. Returns files transferred. */
  fsDownload: (sessionId: string, path: string, isDir: boolean, destDir: string) =>
    invoke<number>("fs_download", { sessionId, path, isDir, destDir }),

  /** Snapshot of BOOKSHELL process resource usage (RSS in MB, CPU %). */
  systemStats: () => invoke<SystemStats>("system_stats"),

  /** Subscribe to backend WARN/ERROR log records. Fires once per record. */
  onDiagLog: (cb: (entry: DiagLogEntry) => void) =>
    listen<DiagLogEntry>("diag://log", (e) => cb(e.payload)),

  /** Frontend liveness ping for the backend watchdog. */
  heartbeat: () => invoke<void>("heartbeat"),

  /** Persist a frontend-detected main-thread stall to the debug file. */
  diagRecordStall: (gapMs: number) =>
    invoke<void>("diag_record_stall", { gapMs }),

  // Command buttons
  buttonsList: () => invoke<CommandButton[]>("buttons_list"),
  buttonsSave: (button: CommandButton) =>
    invoke<void>("buttons_save", { button }),
  buttonsDelete: (id: string) => invoke<void>("buttons_delete", { id }),
  buttonsReorder: (ids: string[]) => invoke<void>("buttons_reorder", { ids }),

  // General settings
  generalGet: () => invoke<GeneralSettings>("general_get"),
  generalSet: (settings: GeneralSettings) =>
    invoke<void>("general_set", { settings }),

  // Tab state persistence
  tabsLoadState: () => invoke<TabsFile>("tabs_load_state"),
  tabsSaveState: (state: TabsFile) => invoke<void>("tabs_save_state", { state }),

  // Run a command on a fresh SSH exec channel; never touches the PTY.
  // Rejects with "local" for local-PTY sessions.
  sessionExecCapture: (sessionId: string, cmd: string) =>
    invoke<string>("session_exec_capture", { sessionId, cmd }),

  // Git view auto-refresh watcher (SSH polling / local FS watch).
  gitWatchStart: (tabId: string, sessionId: string, cwd: string, pollSecs: number) =>
    invoke<void>("git_watch_start", { tabId, sessionId, cwd, pollSecs }),
  gitWatchStop: (tabId: string) =>
    invoke<void>("git_watch_stop", { tabId }),
  onGitChanged: (tabId: string, cb: () => void) =>
    listen<void>(`git://changed/${tabId}`, cb),

  // Git view
  gitView: (sessionId: string, cwd: string) =>
    invoke<GitViewData>("git_view", { sessionId, cwd }),
  gitDiff: (sessionId: string, cwd: string, path: string, staged: boolean) =>
    invoke<string>("git_diff", { sessionId, cwd, path, staged }),
  gitShow: (sessionId: string, cwd: string, rev: string) =>
    invoke<string>("git_show", { sessionId, cwd, rev }),
  gitShowUntracked: (sessionId: string, cwd: string, path: string) =>
    invoke<string>("git_show_untracked", { sessionId, cwd, path }),
  gitCommitDetail: (sessionId: string, cwd: string, rev: string) =>
    invoke<GitCommitDetail>("git_commit_detail", { sessionId, cwd, rev }),
  gitCommitFileDiff: (sessionId: string, cwd: string, rev: string, path: string) =>
    invoke<string>("git_commit_file_diff", { sessionId, cwd, rev, path }),
};

export interface GitViewData {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  status: GitStatusEntry[];
  log: GitLogLine[];
  not_a_repo: boolean;
  error: string | null;
  cwd: string;
}

export interface GitStatusEntry {
  staged: string;
  work: string;
  path: string;
  orig_path: string | null;
}

export interface GitLogLine {
  graph: string;
  commit: GitCommitInfo | null;
}

export interface GitCommitInfo {
  hash: string;
  hash_short: string;
  author: string;
  time_relative: string;
  refs: string;
  subject: string;
}

export interface GitCommitDetail {
  hash: string;
  hash_short: string;
  author: string;
  author_date: string;
  committer: string;
  committer_date: string;
  parents: string[];
  subject: string;
  body: string;
  files: GitCommitFile[];
}

export interface GitCommitFile {
  status: string;
  path: string;
  orig_path: string | null;
}

export interface TabState {
  id: string;
  name: string;
  connection_id: string | null;
  color?: string | null;
  icon?: string | null;
  passthrough: boolean;
  cwd?: string | null;
  git_width?: number | null;
  group_id?: string | null;
}

export interface TabGroupState {
  id: string;
  name: string;
  collapsed?: boolean;
  color?: string | null;
}

export interface TabsFile {
  tabs: TabState[];
  active_tab_id?: string | null;
  groups?: TabGroupState[];
}

export interface SystemStats {
  rss_mb: number;
  cpu_pct: number;
}

export interface DiagLogEntry {
  ts_ms: number;
  level: "warn" | "error";
  target: string;
  message: string;
}

export interface GeneralSettings {
  scrollback: number;
  font_size: number;
  side_font_size: number;
  git_poll_secs: number;
}

export interface CommandButton {
  id: string;
  label: string;
  command: string;
  send_enter: boolean;
  confirm: boolean;
  confirm_text?: string | null;
  hotkey?: string | null;
  color?: string | null;
  icon?: string | null;
}

export type { UnlistenFn };
