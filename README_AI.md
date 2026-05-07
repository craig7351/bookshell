# BOOKSHELL — README for AI Agents

> **Target reader:** AI coding assistants (Claude Code, Copilot, etc.) dropped into this repo. Read this first before exploring any source file.

---

## What is this project?

BOOKSHELL is a **desktop SSH/local-shell terminal emulator designed for AI agent automation**. It runs as a native app (Tauri 2) and lets human operators—or AI agents—open multiple terminal sessions (SSH or local), view Git state, and run saved command macros.

The signature feature is **AI Passthrough Mode**: when active, nearly all keyboard shortcuts bypass the app and reach the remote shell directly, allowing an AI agent controlling the keyboard to operate freely without fighting the app's own hotkeys.

Current state: **Phase 1** (actively developed). The codebase is clean and modular. Two files have uncommitted changes at conversation start: `src-tauri/src/git.rs` and `src/components/GitPanel.tsx`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri 2 (Rust backend + WebView frontend) |
| Frontend UI | Solid.js + TypeScript (via Vite) |
| Terminal emulation | xterm.js 5 with WebGL, Search, and Fit addons |
| SSH client | `russh` 0.46 (pure-Rust, no OpenSSH dependency) |
| Local PTY | `portable-pty` 0.8 (Windows + Unix) |
| Async runtime | Tokio (full features) |
| State persistence | TOML (connections), JSON (buttons, tabs, settings) |
| Concurrent session map | `dashmap` |

---

## Repository Layout

```
bookshell/
├── src/                        # Frontend — TypeScript + Solid.js
│   ├── App.tsx                 # Root component; hotkey wiring, dialog orchestration
│   ├── main.tsx                # Entry point
│   ├── components/
│   │   ├── Terminal.tsx        # xterm.js wrapper; search overlay; password prompt
│   │   ├── TabBar.tsx          # Tab switcher UI
│   │   ├── CommandBar.tsx      # Custom command macro buttons
│   │   ├── ConnectionDialog.tsx # SSH / local-shell profile form
│   │   ├── GitPanel.tsx        # Git status / log / diff side panel
│   │   ├── SideTerminal.tsx    # Secondary PTY on same session
│   │   ├── MarkCwdDialog.tsx   # Save working directory to tab
│   │   ├── SettingsDialog.tsx  # Font size, scrollback, backup/restore
│   │   ├── ButtonEditor.tsx    # Edit custom command buttons
│   │   ├── ContextMenu.tsx     # Right-click menu
│   │   └── CloseX.tsx          # Reusable ✕ button
│   ├── stores/                 # Solid.js reactive state (signals + stores)
│   │   ├── tabs.ts             # Tabs list, active tab, passthrough flag
│   │   ├── connections.ts      # Connection profiles
│   │   ├── buttons.ts          # Custom macro buttons
│   │   ├── git.ts              # Git panel view state
│   │   ├── general.ts          # Font size, scrollback
│   │   ├── search.ts           # Terminal search state
│   │   └── sideTerm.ts         # Side-terminal visibility
│   └── ipc/
│       └── api.ts              # All `invoke()` calls to Rust backend
│
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── main.rs             # Binary entry (Tauri builder)
│       ├── lib.rs              # App setup; all `#[tauri::command]` handlers registered
│       ├── ssh.rs              # SSH sessions: connect, PTY, write, resize, exec
│       ├── local_pty.rs        # Local shell PTY: spawn, read/write threads
│       ├── git.rs              # Git commands over SSH exec or local process; parsing
│       ├── config.rs           # Connection profiles — TOML read/write
│       ├── buttons.rs          # Macro buttons — JSON read/write
│       ├── tabs.rs             # Tab list — JSON persistence
│       ├── general.rs          # Settings — JSON persistence
│       ├── logger.rs           # File + stderr logging setup
│       └── webview.rs          # Windows WebView2 GPU/DPI flags
│
├── index.html                  # HTML template (dark Catppuccin theme)
├── package.json                # npm deps + scripts
├── vite.config.ts              # Vite config (port 5173, Solid plugin)
├── tsconfig.json               # TypeScript (ES2022, strict, JSX = solid-js)
└── src-tauri/tauri.conf.json   # Window config, bundle targets, identifier
```

---

## IPC Architecture

All communication between frontend and backend crosses a Tauri `invoke()` boundary. The frontend **never** touches the filesystem or network directly.

```
Frontend (TypeScript)          Backend (Rust)
src/ipc/api.ts  ──invoke──►   src-tauri/src/lib.rs  (dispatch table)
                                    │
                    ┌───────────────┼──────────────────┐
                    ▼               ▼                  ▼
                 ssh.rs        local_pty.rs          git.rs
             (SSH sessions)   (local shells)     (git commands)
```

### Key IPC calls (api.ts → lib.rs)

| Frontend call | Rust handler | Purpose |
|---|---|---|
| `connect(profile)` | `ssh_connect` / `local_pty_connect` | Open SSH or local PTY session |
| `write(sessionId, data)` | `session_write` | Send keystrokes to session |
| `resize(sessionId, cols, rows)` | `session_resize` | Terminal resize |
| `disconnect(sessionId)` | `session_disconnect` | Close session |
| `git_status(sessionId)` | `git_status` | Staged/unstaged file list |
| `git_log(sessionId)` | `git_log` | Commit graph |
| `git_diff(sessionId, ...)` | `git_diff` | File or commit diff |
| `save_connection(profile)` | `save_connection` | Persist connection to TOML |
| `load_connections()` | `load_connections` | Read saved profiles |
| `save_tabs(tabs)` | `save_tabs` | Persist tab list |
| `load_tabs()` | `load_tabs` | Restore tabs on startup |

---

## Features

### 1. Multi-Tab Sessions
- Each tab = one SSH session **or** one local PTY
- Tabs persist across restarts (JSON); auto-reconnect if password saved
- Hotkeys: `Ctrl+Shift+T` new, `Ctrl+Shift+W` close, `Ctrl+Tab` cycle, `Ctrl+1–9` jump

### 2. SSH Connectivity
- Pure-Rust russh client — no system OpenSSH needed
- Password auth; profiles stored in TOML at OS config dir
- Auto-reconnect with saved password + optional `cd <cwd>` after 500 ms
- **TODO (Phase 1G):** key-based auth; DPAPI encryption for stored passwords

### 3. Local Shell Support
- PowerShell on Windows; `$SHELL` or bash on Unix
- Identical IPC API to SSH — same `session_write` / `session_resize` commands
- Supports custom initial working directory

### 4. Terminal Emulation
- xterm.js with WebGL renderer; 256-color; dark theme
- `Ctrl+F` incremental search with visible highlight
- Dynamic resize via `ResizeObserver` + fit addon

### 5. AI Passthrough Mode (`Ctrl+Shift+P`)
- **OFF (default):** app captures `Ctrl+*` shortcuts (new tab, search, etc.)
- **ON:** app only captures `Ctrl+Shift+P` itself; everything else reaches the shell
- Single-modifier shell sequences (`Ctrl+R`, `Shift+Tab`, `Alt+.`) always pass through regardless of mode
- Designed so AI agents can drive the terminal without key-capture conflicts

### 6. Git Panel
- Right-side panel opened with 🌿 header button
- Shows: working tree status, staged changes, commit graph, file diff, commit-to-commit diff
- Routes via SSH exec channel for remote sessions; `tokio::process` for local sessions
- Split-pane layout: file list left, diff content right

### 7. Side Terminal
- 📟 header button opens a secondary PTY panel sharing the same session
- Respects 📍 marked cwd — spawns at the saved working directory
- Useful for parallel shell access (e.g., one pane running a server, another for commands)

### 8. Working Directory Marker (📍)
- Manually pin a working directory to a tab via `MarkCwdDialog`
- Auto-detect via shell-aware probe: reads `$PWD` / `cd` output depending on shell type
- On reconnect, app sends `cd <cwd>` after ~500 ms delay

### 9. Custom Command Buttons
- Define reusable shell macros with icon, label, optional confirm dialog
- Multi-line commands supported; optional auto-CR per line
- Persisted as JSON

### 10. Settings & Backup
- Font size (8–24 px), scrollback buffer (100–50 000 lines)
- JSON export/import of tabs + connections + buttons (full backup)

---

## State Management (Frontend)

Solid.js signals and stores — **no Redux, no Context API**.

| Store file | What it holds |
|---|---|
| `tabs.ts` | `tabs[]`, `activeTabId`, `passthroughMode` signal |
| `connections.ts` | Connection profile list (synced from backend) |
| `buttons.ts` | Custom macro button list |
| `git.ts` | Git panel open/closed, current view (status/log/diff), selected file |
| `general.ts` | `fontSize`, `scrollback` |
| `search.ts` | Search query, match index, search panel visible |
| `sideTerm.ts` | Side terminal visible, session ID |

---

## Session ID Convention

Sessions are UUIDs generated in Rust at connect time. They are strings passed back to the frontend and used as the first argument to all subsequent IPC calls. A `DashMap<String, Session>` in each backend module (`ssh.rs`, `local_pty.rs`) keyed by this UUID holds live state.

---

## Data Persistence Locations

Tauri resolves these via the `directories` crate:

| File | Path (Windows example) | Format |
|---|---|---|
| Connection profiles | `%APPDATA%\bookshell\connections.toml` | TOML |
| Buttons | `%APPDATA%\bookshell\buttons.json` | JSON |
| Tab list | `%APPDATA%\bookshell\tabs.json` | JSON |
| General settings | `%APPDATA%\bookshell\general.json` | JSON |
| Log file | `%LOCALAPPDATA%\bookshell\logs\bookshell.log` | Text |

---

## Build & Dev Commands

```bash
# Install frontend deps
npm install

# Dev mode (hot-reload frontend + Tauri window)
npm run tauri dev

# Production build
npm run tauri build

# Type-check only
npx tsc --noEmit
```

Rust toolchain: stable, minimum 1.77. The Tauri CLI is installed via npm (`@tauri-apps/cli`).

---

## Known Limitations / Active TODOs

| ID | Item | Status |
|---|---|---|
| Phase 1G | SSH key-based auth (Ed25519, RSA) | Not started |
| Phase 1G | DPAPI / keychain encryption for stored passwords | Not started |
| — | Git panel: stage/unstage/commit actions (currently read-only) | Not started |
| — | Connection profile import from `~/.ssh/config` | Not started |
| — | macOS / Linux testing | Untested |

---

## Keyboard Shortcuts Reference

| Shortcut | Action | Passthrough-safe? |
|---|---|---|
| `Ctrl+Shift+P` | Toggle AI passthrough mode | Always captured |
| `Ctrl+Shift+T` | New tab | Captured when OFF |
| `Ctrl+Shift+W` | Close tab | Captured when OFF |
| `Ctrl+Tab` | Next tab | Captured when OFF |
| `Ctrl+F` | Toggle terminal search | Captured when OFF |
| `Ctrl+R` | Shell reverse-search | Always passes through |
| `Shift+Tab` | Shell completion | Always passes through |
| `Alt+.` | Shell last-arg | Always passes through |

---

## For AI Agents Operating in This Codebase

- **IPC boundary is strict**: never bypass `src/ipc/api.ts` on the frontend side. All backend access goes through `invoke()`.
- **Adding a backend command**: (1) write `#[tauri::command]` fn in the appropriate `src-tauri/src/*.rs` file, (2) register it in `lib.rs` `generate_handler![]`, (3) add a typed wrapper in `src/ipc/api.ts`.
- **Adding a frontend component**: create in `src/components/`, import into `App.tsx` or the parent component. Use Solid.js signals — no React hooks.
- **Stores are the source of truth**: components read from stores, call IPC to mutate backend, then update stores on success.
- **Session routing**: check `tab.kind` (`"ssh"` | `"local"`) before routing commands — `git.rs` dispatches differently for each kind.
- **No global CSS framework**: styles are inline or in `<style>` blocks inside components. Color palette is Catppuccin Mocha (`#1e1e2e` bg, `#cdd6f4` fg, `#89b4fa` accent).
