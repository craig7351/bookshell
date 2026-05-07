# BOOKSHELL

SSH terminal for AI agents — a Tauri 2 + SolidJS desktop app with multi-tab xterm sessions.

![BOOKSHELL screenshot](bookshell.png)

## Screenshots

**Pin a tab's working directory** — right-click a tab and set `cwd`. The path is remembered, so next time you launch BOOKSHELL the tab opens directly in that folder.
透過 tab 右鍵 `cwd` 可固定該分頁的工作目錄；下次重開軟體會自動進入設定的資料夾。

![Pin tab cwd](docs/image1.jpg)

**Logs panel** — the top-right Logs view automatically records every tab's content, including conversations with your AI agent.
右上角 Logs 自動記錄所有 tab 的內容，包含跟 AI agent 的對話。

![Logs panel](docs/image2.jpg)

**Git view** — inspect the changes inside any commit by SHA.
Git view 可直接檢視某個 SHA 內所修改的內容。

![Git view by SHA](docs/image3.jpg)

[English](#english) | [中文](#中文)

---

## English

### Features

- Multi-tab SSH and local shell sessions (xterm.js + WebGL renderer)
- Side terminal panel with independent font size
- Clickable URLs, middle-click paste, scrollback search
- Persistent SSH sessions with keepalive past server idle timeouts
- Transcript export and in-app log viewer with ANSI replay
- Tab cycling via `Shift+Up` / `Shift+Down` from anywhere

### Development

```bash
npm install
npm run tauri dev
```

### Building

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/`.

### Releases

Push a tag matching `v*` to trigger a multi-platform GitHub Actions release build:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds installers for Windows, macOS (Apple Silicon and Intel), and Linux, then uploads them to a draft release on GitHub.

### License

See `LICENSE`.

---

## 中文

專為 AI agent 工作流設計的 SSH 終端機 —— 基於 Tauri 2 + SolidJS 的桌面應用程式，支援多分頁 xterm 連線。

### 功能特色

- 多分頁 SSH 與本機 shell 連線（xterm.js + WebGL 渲染）
- 獨立字體大小設定的 side terminal 面板
- 可點擊網址、中鍵貼上、scrollback 搜尋
- SSH 連線保持機制，可穿越伺服器 idle timeout
- Transcript 匯出與內建 log viewer（含 ANSI 重播）
- 全域快捷鍵 `Shift+Up` / `Shift+Down` 切換分頁

### 開發

```bash
npm install
npm run tauri dev
```

### 編譯

```bash
npm run tauri build
```

產物會放在 `src-tauri/target/release/bundle/`。

### 發行版本

Push 一個符合 `v*` 格式的 tag，即會觸發 GitHub Actions 多平台 build：

```bash
git tag v0.1.0
git push origin v0.1.0
```

Workflow 會自動 build 出 Windows、macOS（Apple Silicon 與 Intel）、Linux 的安裝檔，並上傳到 GitHub 的 draft release。

### 授權

請見 `LICENSE`。
