# BOOKSHELL v1.1.0

本版聚焦在 **介面整體質感**：一輪 UI 大改裝、新增檔案瀏覽器、加上多項操作細節。

## ✨ 新功能

### 📁 檔案瀏覽器（File Browser）
- 右側新增 **Files panel**，列出當前 tab 的目錄結構
- **本地 tab** 直接讀本機檔案系統；**SSH tab** 透過 SFTP 列遠端目錄
- 點檔案直接以 OS 預設應用程式開啟；遠端檔案會自動下載到暫存區再開
- **可編輯路徑列**：直接在頂部輸入路徑後按 Enter 跳轉，Esc 取消
- **隱藏檔切換**：header 上 `.` 按鈕一鍵顯示 / 隱藏 dotfile（預設隱藏，避免 SSH home 被 `.cache`、`.config` 洗版）
- 跟 Git panel / Side terminal 一樣的側邊欄體驗，可在三種佈局之間切換

### 🦶 Status Footer 顯示當前 tab context
- 左側自動帶出 `📍 cwd`、`🌿 git branch ↑2 ↓1`、`🤖 passthrough`
- 切 tab 時即時更新，terminal 內看不到路徑時隨時知道工作在哪裡
- 右側保留 process 指標（sessions / RSS / CPU / uptime）

### ⌨️ 連線視窗鍵盤操作
- Connection dialog 支援上下鍵 + Enter 直接選擇與連線，不必再切到滑鼠

### 🪟 Git File Viewer 最大化
- Git diff 檔案檢視 modal 新增 **最大化 / 還原** 切換鈕，方便看大檔變更

### ➕ 新分頁插入位置
- 新開分頁會插入在 active tab 旁邊，而不是丟到列表最尾端

## 🎨 UI / 視覺改善

### 介面層次重做
- 重新調整 surface 階層：**panel（左右側欄）變暗、main terminal 變亮**，主畫面自然成為視覺焦點，不再讓四個區塊一片同色
- **TabBar**：壓低 tab 高度（10 個 tab 多省一半空間）；active 樣式從「白底高亮」改為「左側 accent bar + 微藍背景」；close × 改 hover-only 顯示，靜止時更乾淨
- **連線狀態指示**：connected 狀態不再顯示綠點，只有 connecting / disconnected / error 才跳出來，避免一整排「正常」指示燈干擾視覺；connecting 加 pulse 動畫

### Context Menu 重構
- 右鍵選單新增 **icon 欄位** + **sublabel** 結構，不再把 emoji 跟長路徑塞進同一行 label
- 「Edit cwd」現在主標題下方獨立顯示 cwd 路徑（monospace 灰字），不會撐爆 menu 寬度
- 「Close」等危險操作 hover 時改紅底，回饋更直覺

### Quick Command 按鈕列
- 從滿底色改為 **ghost style**：透明背景 + 邊框，hover 才填色
- 使用者設色的按鈕現在用「邊框 + 文字」帶色，不再整顆塗滿，視覺重量降低
- ⚙ Edit 按鈕加入 divider 跟指令按鈕分組

### Git Diff 區可讀性
- `diff --git` 檔案標題：橘色粗體 + 上方分隔線 + **sticky 定位**，多檔案 commit diff 滾動時當前檔案標題會貼在頂部
- `@@` hunk header 改為卡片式區塊（淡青色背景 + 圓角）
- `+/-` 行背景延伸至全寬；context 行降為 `text2` 灰，讓改動行自然 pop

### Markdown Viewer
- 樣式改由 theme token 驅動，跟其他元件視覺一致
- HTML 內容統一 sanitize，避免 render race condition

### 跨平台
- macOS 紅綠燈裝飾改為**只在 macOS 顯示**，Windows / Linux 不再渲染這三顆假按鈕（跟原生 OS chrome 衝突）

## 📦 安裝

從 [Releases 頁面](https://github.com/craig7351/bookshell/releases/tag/v1.1.0) 下載對應平台的安裝檔：

- **Windows**：`.msi` 或 `.exe`
- **macOS**：`.dmg`（Apple Silicon 與 Intel 分開包）
- **Linux**：`.AppImage` / `.deb`

## 🙏 致謝

本版 UI 改造由 Claude Code 協助規劃與實作。
