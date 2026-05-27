# KKTerm 對比分析 — 為什麼它不會 hang，我們能借鏡什麼

分析對象：[ryantsai/KKTerm](https://github.com/ryantsai/KKTerm)（Tauri + Rust + React/TS
的終端工作站，含 SSH/SFTP/RDP/VNC）。目標：找出它在大量終端輸出下不凍結 UI 的原因，
對照 bookshell「跑久了整個視窗凍住」的問題，列出可採用的改進。

## TL;DR

兩個專案的架構**幾乎一模一樣**（Tauri + Rust 後端 + xterm.js + WebGL、8KB PTY read
buffer、每個 chunk 一個 Tauri event、global event 而非 Channel、都沒有 output batching）。
KKTerm 並沒有什麼神奇設計 —— 這代表 bookshell 的凍結來自一個**具體的分歧點**，而非整體架構較差。

**那個分歧點就是 IPC 的 byte 編碼方式：**

- **bookshell**：後端 `app.emit(data.to_vec())` 送 `Vec<u8>` → Tauri 序列化成 **JSON 數字陣列**
  `[27,91,51,...]` → 前端 `listen<number[]>` → `new Uint8Array(e.payload)`。
- **KKTerm**：後端 `emit_terminal_output(.., String::from_utf8_lossy(&data).to_string())` 送
  **String** → 前端 `terminal.write(event.payload.data)` 直接寫入。

一個 8KB 的 chunk 用數字陣列表示，會膨脹成 **~30KB 的 JSON 文字**，而且前端主執行緒得把
8192 個 JS number 一個個 parse 出來、配置一個陣列、再轉 Uint8Array —— **每個 event 都來一次**。
遠端狂噴輸出時（`cat bigfile`、`yes`、npm/build log），主執行緒就淹死在 JSON parsing 裡，
正好就是你看到的「整個視窗凍住、滑鼠鍵盤沒反應」。這是 Tauri 已知的效能地雷：number array
走 IPC bridge 慢得病態。KKTerm 送 String 就完全避開了。

## 架構對比

| 面向 | bookshell | KKTerm | 差異 |
|------|-----------|--------|------|
| 後端 stack | Rust + russh + portable-pty | Rust + russh + portable-pty | 相同 |
| PTY read buffer | 8192 bytes | 8192 bytes | 相同 |
| 輸出送法 | 每個 chunk 一個 event | 每個 chunk 一個 event | 相同 |
| **IPC payload** | **`Vec<u8>` → number[]** | **`String`** | **關鍵差異** |
| 前端寫入 | `term.write(Uint8Array)` | `term.write(string)` | 連動上面 |
| 終端 library | xterm.js + WebGL | xterm.js + WebGL | 相同 |
| Output batching/throttle | 無 | 無 | 都沒有 |
| Tauri Channel API | 沒用（global event） | 沒用（global event） | 相同 |
| scrollback 預設 / 上限 | 10000 / **200000** | 5000 / 100000 | 我們上限偏高 |
| Hang/crash 診斷 | 有（watchdog + debug log） | 無 | 我們較好 |

`src-tauri/src/ssh.rs:424` / `local_pty.rs:136` 是 bookshell 的 emit 點；
`src/ipc/api.ts:60-62` 是前端 `listen<number[]>` 的解碼點。

## 可採用的改進（依效益排序）

### 1.（最大效益）把 PTY/SSH 資料通道從 byte array 改掉

這是直接對應你凍結症狀的根因。三個選項，由易到優：

- **(a) 學 KKTerm 送 String**：後端 `String::from_utf8_lossy(&data)`、前端 `term.write(string)`。
  最簡單，立刻消除 number-array 膨脹。**Caveat**：`from_utf8_lossy` 會在多 byte UTF-8 字元
  剛好被切在兩個 8KB chunk 邊界時，把半個字元變成 ``。中文/emoji 高機率踩到 —— KKTerm
  其實也有這個潛在 bug。
- **(b)（建議）用 Tauri v2 的 raw bytes 機制**：`tauri::ipc::Channel<&[u8]>` 或回傳
  `tauri::ipc::Response`，bytes 走 binary 而非 JSON 數字陣列，沒有膨脹也沒有 per-byte parse。
- **(c) 配合前端 streaming UTF-8 decode**：用 `new TextDecoder("utf-8")` 並以
  `decoder.decode(chunk, { stream: true })` 解碼，正確處理跨 chunk 的多 byte 字元。
  這點可以**做得比 KKTerm 更好**（它沒處理邊界切字問題）。

最佳組合是 **(b) + (c)**：binary channel 傳 bytes、前端 streaming decode。

### 2. 加上 output coalescing（時間窗合併）

兩個專案都沒做，但這是凍結的第二道保險。在 Rust reader 端用一個 `Vec<u8>` 緩衝、每 ~16ms
透過 `tokio::interval` flush 一次（把短時間內多個小 chunk 合成一個 event）。KKTerm 沒做也能撐，
主要是因為 String 夠便宜；但我們加上去能再降低 event 數量級，對極端洪流更穩。

### 3. 降低 scrollback 上限

bookshell 允許到 **200000** 行（`SettingsDialog.tsx:106`、`general.rs` 預設 10000），
KKTerm 上限 100000、預設 5000。200k 行 × 多個分頁長時間累積，是長 uptime 記憶體成長 / GC
頓挫的真實風險（你 footer 的 🧠 RSS 可以驗證）。建議把上限收到 100000，預設維持或降到 5000。

## bookshell 已經做得一樣好或更好的地方

- **WebGL + context-loss 處理**：兩邊都有，bookshell 也有 `webgl.onContextLoss` 的 dispose 處理。
- **執行緒模型**：SSH 用 tokio、local PTY 用專屬 OS thread，與 KKTerm 一致。
- **Hang/crash 診斷**：bookshell 剛加的 heartbeat watchdog + 持久 debug log + panic hook
  （見 `debug.md`），KKTerm 完全沒有這類黑盒子。這是我們的優勢，保留。

## 結論

KKTerm 不會 hang **不是因為它架構更先進**，而是因為它在資料通道上送 String 而非
number array，剛好避開了 Tauri 最大的 IPC 效能地雷 —— 那正是 bookshell 凍結的最可能主因。

**動手順序**：先做 #1（換掉 byte-array 通道，建議 binary channel + streaming decode），
這一項預期就能解掉大多數凍結；再視情況加 #2 的 16ms coalescing 當保險、#3 收 scrollback 上限。
我們既有的 watchdog/debug log 則能在改完後驗證凍結是否真的消失。
