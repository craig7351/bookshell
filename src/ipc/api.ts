import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AuthMethod = "password";
export type ConnectionKind = "ssh" | "local";

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

  onSshData: (sessionId: string, cb: (bytes: Uint8Array) => void) =>
    listen<number[]>(`ssh://data/${sessionId}`, (e) =>
      cb(new Uint8Array(e.payload)),
    ),

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

  // Logging
  loggerOpenDir: () => invoke<void>("logger_open_dir"),
  loggerDirPath: () => invoke<string>("logger_dir_path"),
  logsList: () => invoke<LogEntry[]>("logs_list"),
  logsRead: (name: string) =>
    invoke<number[]>("logs_read", { name }).then((arr) => new Uint8Array(arr)),
  sshLogPath: (sessionId: string) =>
    invoke<string | null>("ssh_log_path", { sessionId }),
  /** Open a native Save As dialog and write `content` to the chosen path.
   *  Returns the saved path, or null if the user cancelled. */
  transcriptSaveDialog: (suggestedName: string, content: string) =>
    invoke<string | null>("transcript_save_dialog", { suggestedName, content }),
  /** Open an http(s) URL in the user's default browser. */
  urlOpen: (url: string) => invoke<void>("url_open", { url }),

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
}

export interface TabsFile {
  tabs: TabState[];
  active_tab_id?: string | null;
}

export interface LogEntry {
  name: string;
  size: number;
  modified_unix_ms: number;
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
