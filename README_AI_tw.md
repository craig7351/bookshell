# BOOKSHELL — AI 代理人閱讀手冊

> **目標讀者：** 被丟進這個 repo 的 AI 編程助手（Claude Code、Copilot 等）。在探索任何原始碼之前，請先讀這份文件。

---

## 這個專案是什麼？

BOOKSHELL 是一款**專為 AI 代理人自動化設計的桌面 SSH／本機 Shell 終端模擬器**。它以原生應用程式（Tauri 2）運行，讓人類操作者或 AI 代理人開啟多個終端 Session（SSH 或本機），查看 Git 狀態，並執行已儲存的指令巨集。

核心特色是 **AI 直通模式（Passthrough Mode）**：啟用後，幾乎所有鍵盤快捷鍵都會繞過應用程式直接送達遠端 Shell，讓透過鍵盤控制終端的 AI 代理人不必與應用程式本身的快捷鍵衝突，可自由操作。

目前狀態：**Phase 1**（積極開發中）。程式碼庫結構清晰且模組化。對話開始時有兩個檔案含未提交的修改：`src-tauri/src/git.rs` 與 `src/components/GitPanel.tsx`。

---

## 技術堆疊

| 層級 | 技術 |
|---|---|
| 桌面框架 | Tauri 2（Rust 後端 + WebView 前端） |
| 前端 UI | Solid.js + TypeScript（透過 Vite） |
| 終端模擬 | xterm.js 5，含 WebGL、Search、Fit 插件 |
| SSH 客戶端 | `russh` 0.46（純 Rust，不依賴系統 OpenSSH） |
| 本機 PTY | `portable-pty` 0.8（Windows + Unix） |
| 非同步執行環境 | Tokio（完整功能） |
| 狀態持久化 | TOML（連線設定）、JSON（按鈕、分頁、設定） |
| 並行 Session 映射表 | `dashmap` |

---

## 目錄結構

```
bookshell/
├── src/                        # 前端 — TypeScript + Solid.js
│   ├── App.tsx                 # 根元件；快捷鍵綁定、對話框管理
│   ├── main.tsx                # 程式進入點
│   ├── components/
│   │   ├── Terminal.tsx        # xterm.js 包裝器；搜尋覆蓋層；密碼輸入提示
│   │   ├── TabBar.tsx          # 分頁切換 UI
│   │   ├── CommandBar.tsx      # 自訂指令巨集按鈕列
│   │   ├── ConnectionDialog.tsx # SSH／本機 Shell 連線設定表單
│   │   ├── GitPanel.tsx        # Git 狀態／記錄／差異側邊面板
│   │   ├── SideTerminal.tsx    # 共用同一 Session 的第二個 PTY
│   │   ├── MarkCwdDialog.tsx   # 將工作目錄儲存至分頁
│   │   ├── SettingsDialog.tsx  # 字型大小、捲動緩衝、備份／還原
│   │   ├── ButtonEditor.tsx    # 編輯自訂指令按鈕
│   │   ├── ContextMenu.tsx     # 右鍵選單
│   │   └── CloseX.tsx          # 可重複使用的 ✕ 按鈕
│   ├── stores/                 # Solid.js 響應式狀態（signals + stores）
│   │   ├── tabs.ts             # 分頁清單、作用中分頁、直通模式旗標
│   │   ├── connections.ts      # 連線設定檔
│   │   ├── buttons.ts          # 自訂巨集按鈕
│   │   ├── git.ts              # Git 面板檢視狀態
│   │   ├── general.ts          # 字型大小、捲動緩衝
│   │   ├── search.ts           # 終端搜尋狀態
│   │   └── sideTerm.ts         # 側邊終端可見性
│   └── ipc/
│       └── api.ts              # 所有對 Rust 後端的 `invoke()` 呼叫
│
├── src-tauri/                  # Rust 後端
│   └── src/
│       ├── main.rs             # 二進位進入點（Tauri builder）
│       ├── lib.rs              # 應用程式初始化；所有 `#[tauri::command]` 處理器註冊
│       ├── ssh.rs              # SSH Session：連線、PTY、寫入、調整大小、exec
│       ├── local_pty.rs        # 本機 Shell PTY：生成、讀寫執行緒
│       ├── git.rs              # 透過 SSH exec 或本機 process 執行 Git 指令並解析
│       ├── config.rs           # 連線設定檔 — TOML 讀寫
│       ├── buttons.rs          # 巨集按鈕 — JSON 讀寫
│       ├── tabs.rs             # 分頁清單 — JSON 持久化
│       ├── general.rs          # 一般設定 — JSON 持久化
│       ├── logger.rs           # 檔案 + stderr 日誌設定
│       └── webview.rs          # Windows WebView2 GPU／DPI 旗標
│
├── index.html                  # HTML 樣板（深色 Catppuccin 主題）
├── package.json                # npm 相依套件 + 腳本
├── vite.config.ts              # Vite 設定（port 5173、Solid 插件）
├── tsconfig.json               # TypeScript（ES2022、strict、JSX = solid-js）
└── src-tauri/tauri.conf.json   # 視窗設定、打包目標、應用程式識別碼
```

---

## IPC 架構

前後端之間所有通訊都透過 Tauri 的 `invoke()` 邊界。前端**絕不**直接存取檔案系統或網路。

```
前端（TypeScript）              後端（Rust）
src/ipc/api.ts  ──invoke──►   src-tauri/src/lib.rs  （分派表）
                                    │
                    ┌───────────────┼──────────────────┐
                    ▼               ▼                  ▼
                 ssh.rs        local_pty.rs          git.rs
             （SSH Sessions）  （本機 Shell）       （Git 指令）
```

### 主要 IPC 呼叫（api.ts → lib.rs）

| 前端呼叫 | Rust 處理器 | 用途 |
|---|---|---|
| `connect(profile)` | `ssh_connect` / `local_pty_connect` | 開啟 SSH 或本機 PTY Session |
| `write(sessionId, data)` | `session_write` | 傳送按鍵至 Session |
| `resize(sessionId, cols, rows)` | `session_resize` | 調整終端大小 |
| `disconnect(sessionId)` | `session_disconnect` | 關閉 Session |
| `git_status(sessionId)` | `git_status` | 已暫存／未暫存檔案清單 |
| `git_log(sessionId)` | `git_log` | 提交記錄圖 |
| `git_diff(sessionId, ...)` | `git_diff` | 檔案或提交差異 |
| `save_connection(profile)` | `save_connection` | 將連線設定持久化至 TOML |
| `load_connections()` | `load_connections` | 讀取已儲存的設定檔 |
| `save_tabs(tabs)` | `save_tabs` | 持久化分頁清單 |
| `load_tabs()` | `load_tabs` | 啟動時還原分頁 |

---

## 功能說明

### 1. 多分頁 Session
- 每個分頁 = 一個 SSH Session **或** 一個本機 PTY
- 分頁在重啟後持續存在（JSON）；若已儲存密碼則自動重連
- 快捷鍵：`Ctrl+Shift+T` 新增、`Ctrl+Shift+W` 關閉、`Ctrl+Tab` 循環切換、`Ctrl+1–9` 跳至指定分頁

### 2. SSH 連線
- 純 Rust 的 russh 客戶端 — 不需要系統安裝 OpenSSH
- 密碼驗證；設定檔以 TOML 儲存於 OS 設定目錄
- 以儲存的密碼自動重連，500 ms 後選擇性執行 `cd <cwd>`
- **TODO（Phase 1G）：** 金鑰驗證；DPAPI 加密儲存的密碼

### 3. 本機 Shell 支援
- Windows 使用 PowerShell；Unix 使用 `$SHELL` 或 bash
- IPC API 與 SSH 完全相同 — 同樣使用 `session_write` / `session_resize` 指令
- 支援自訂初始工作目錄

### 4. 終端模擬
- xterm.js 搭配 WebGL 渲染器；256 色；深色主題
- `Ctrl+F` 漸進式搜尋，含明顯高亮標示
- 透過 `ResizeObserver` + fit 插件動態調整大小

### 5. AI 直通模式（`Ctrl+Shift+P`）
- **關閉（預設）：** 應用程式攔截 `Ctrl+*` 快捷鍵（新分頁、搜尋等）
- **開啟：** 應用程式只攔截 `Ctrl+Shift+P` 本身；其餘所有按鍵直達 Shell
- 單修飾鍵的 Shell 序列（`Ctrl+R`、`Shift+Tab`、`Alt+.`）無論模式都永遠直通
- 設計目的：讓 AI 代理人能驅動終端，不與應用程式快捷鍵衝突

### 6. Git 面板
- 點擊標題列的 🌿 按鈕開啟右側面板
- 顯示：工作樹狀態、已暫存變更、提交記錄圖、檔案差異、提交間差異
- 遠端 Session 透過 SSH exec channel 執行；本機 Session 使用 `tokio::process`
- 分割窗格配置：左側檔案清單、右側差異內容

### 7. 側邊終端
- 點擊標題列的 📟 按鈕，在同一 Session 上開啟第二個 PTY 面板
- 遵守 📍 已標記的 cwd — 在儲存的工作目錄生成
- 適合並行存取（例如一個窗格執行伺服器，另一個窗格下指令）

### 8. 工作目錄標記（📍）
- 透過 `MarkCwdDialog` 手動將工作目錄固定至分頁
- 透過感知 Shell 的探測自動偵測：依 Shell 類型讀取 `$PWD` 或 `cd` 輸出
- 重連時，應用程式在約 500 ms 後傳送 `cd <cwd>`

### 9. 自訂指令按鈕
- 定義可重複使用的 Shell 巨集，含圖示、標籤、選擇性確認對話框
- 支援多行指令；可選擇每行後自動送出 CR
- 以 JSON 持久化儲存

### 10. 設定與備份
- 字型大小（8–24 px）、捲動緩衝（100–50,000 行）
- JSON 匯出／匯入分頁 + 連線設定 + 按鈕（完整備份）

---

## 狀態管理（前端）

使用 Solid.js signals 與 stores — **不使用 Redux，不使用 Context API**。

| Store 檔案 | 儲存內容 |
|---|---|
| `tabs.ts` | `tabs[]`、`activeTabId`、`passthroughMode` signal |
| `connections.ts` | 連線設定檔清單（與後端同步） |
| `buttons.ts` | 自訂巨集按鈕清單 |
| `git.ts` | Git 面板開關、目前檢視（status／log／diff）、選取的檔案 |
| `general.ts` | `fontSize`、`scrollback` |
| `search.ts` | 搜尋查詢字串、符合項目索引、搜尋面板可見性 |
| `sideTerm.ts` | 側邊終端可見性、Session ID |

---

## Session ID 慣例

Session 是在 Rust 連線時生成的 UUID，以字串形式回傳給前端，作為後續所有 IPC 呼叫的第一個引數。每個後端模組（`ssh.rs`、`local_pty.rs`）各維護一個以此 UUID 為鍵的 `DashMap<String, Session>` 存放活躍狀態。

---

## 資料持久化位置

Tauri 透過 `directories` crate 解析這些路徑：

| 檔案 | 路徑（Windows 範例） | 格式 |
|---|---|---|
| 連線設定檔 | `%APPDATA%\bookshell\connections.toml` | TOML |
| 按鈕 | `%APPDATA%\bookshell\buttons.json` | JSON |
| 分頁清單 | `%APPDATA%\bookshell\tabs.json` | JSON |
| 一般設定 | `%APPDATA%\bookshell\general.json` | JSON |
| 日誌檔案 | `%LOCALAPPDATA%\bookshell\logs\bookshell.log` | Text |

---

## 建置與開發指令

```bash
# 安裝前端相依套件
npm install

# 開發模式（前端熱重載 + Tauri 視窗）
npm run tauri dev

# 正式建置
npm run tauri build

# 僅型別檢查
npx tsc --noEmit
```

Rust 工具鏈：stable，最低版本 1.77。Tauri CLI 透過 npm 安裝（`@tauri-apps/cli`）。

---

## 已知限制／待辦事項

| ID | 項目 | 狀態 |
|---|---|---|
| Phase 1G | SSH 金鑰驗證（Ed25519、RSA） | 尚未開始 |
| Phase 1G | DPAPI／Keychain 加密儲存的密碼 | 尚未開始 |
| — | Git 面板：暫存／取消暫存／提交操作（目前唯讀） | 尚未開始 |
| — | 從 `~/.ssh/config` 匯入連線設定 | 尚未開始 |
| — | macOS／Linux 測試 | 未測試 |

---

## 鍵盤快捷鍵參考

| 快捷鍵 | 動作 | 直通模式下是否安全？ |
|---|---|---|
| `Ctrl+Shift+P` | 切換 AI 直通模式 | 永遠被應用程式攔截 |
| `Ctrl+Shift+T` | 新增分頁 | 關閉時被攔截 |
| `Ctrl+Shift+W` | 關閉分頁 | 關閉時被攔截 |
| `Ctrl+Tab` | 下一個分頁 | 關閉時被攔截 |
| `Ctrl+F` | 切換終端搜尋 | 關閉時被攔截 |
| `Ctrl+R` | Shell 反向搜尋 | 永遠直通 |
| `Shift+Tab` | Shell 補全 | 永遠直通 |
| `Alt+.` | Shell 最後引數 | 永遠直通 |

---

## 給在此程式碼庫工作的 AI 代理人

- **IPC 邊界是嚴格的**：前端側絕不繞過 `src/ipc/api.ts`。所有後端存取都必須透過 `invoke()`。
- **新增後端指令**：(1) 在對應的 `src-tauri/src/*.rs` 檔案中撰寫 `#[tauri::command]` 函式，(2) 在 `lib.rs` 的 `generate_handler![]` 中註冊，(3) 在 `src/ipc/api.ts` 中新增帶型別的包裝函式。
- **新增前端元件**：在 `src/components/` 建立，匯入至 `App.tsx` 或父元件。使用 Solid.js signals — 不使用 React hooks。
- **Stores 是唯一真實來源**：元件從 store 讀取，呼叫 IPC 修改後端，成功後再更新 store。
- **Session 路由**：執行指令前先確認 `tab.kind`（`"ssh"` | `"local"`）— `git.rs` 對兩種類型的分派方式不同。
- **沒有全域 CSS 框架**：樣式以 inline 或元件內的 `<style>` 區塊撰寫。色彩風格為 Catppuccin Mocha（背景 `#1e1e2e`、前景 `#cdd6f4`、強調色 `#89b4fa`）。
