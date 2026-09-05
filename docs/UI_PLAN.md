# BOOKSHELL UI 精緻化計畫

> 產生日期 2026-09-05。方法：11 份元件／跨切面稽核（242 個發現，48 個 high）→ 3 個獨立設計方向 → 2 位評審 → 整合 → 2 位挑剔 reviewer 逐行核對原始碼（4 blocker、8 major 已修）→ 本版。
> 本文件只談外觀與互動質感，不改功能、store 資料形狀、IPC。

## 0. 結論摘要

- **方向**：保留 macOS dark DNA 但做到零誤差（QUARTZ 基底），移植 Calm Focus 的「呼吸而非旋轉」動效與 agent activity rail、GRAPHITE 的 inline/class 優先權紀律。刻意不換 accent、不引入 Inter、不改暖色調。
- **三件最影響觀感的事**：13 處 backdrop-filter 全部換成 opaque 表面＋1px 頂緣高光；chrome 內彩色 emoji 全換單色 Lucide 風 SVG；所有按鈕補齊 hover / press / focus-visible / disabled 四態。
- **一套尺度**：5 階 surface、4 階文字（text-3 對比從 2.4:1 修到 4.3:1）、6 階圓角、4pt 間距網格、3 階動效，唯一真相放在 theme.ts 的 RAW，開機 applyTokens 注入 CSS 變數。
- **工程策略**：不推翻 inline style。佈局與語意色留在 inline，狀態層交給 .bs-* class＋CSS 變數插槽；xterm 七條鐵律保護終端效能與 cell 量測。
- **工時**：核心 11 人日（Phase 1a 半天即見效），選配自訂標題列另 2 人日；第一小時有 11 個幾分鐘就能做的快贏。

## 1. 願景

完成後的 BOOKSHELL 仍是使用者熟悉的 macOS dark（#1c1c1e 終端、#0a84ff accent、系統字），但被「擦到零誤差」：終端是唯一的英雄——它成為浮在更深 chrome 畫布上的 8px 圓角卡片，四周有 6px 呼吸留白，canvas 上永遠沒有任何濾鏡、大陰影或非同步換字型。chrome 內零彩色 emoji，全部是跟著 currentColor 變色的單色 Lucide 風 SVG；工具列是無框 ghost 按鈕加一組 segmented 面板開關，只有「+ Connect」是實心藍。所有按鈕有 hover / 按下 scale(.97) / 焦點環 / disabled 四態；所有浮層是不透明表面 + 1px 頂緣高光 + 外圈黑 ring，在視覺上與 blur 無差卻省下一整層 GPU 合成。要讀的文字對比全部 ≥ 4.3:1，純裝飾另有一階；字級 6 階、圓角 6 階、間距 4pt 網格、動效 3 階，全 app 只有一套尺度，「選取 / 啟用」只有一種視覺語言。側欄每列有一條穩定的文字對齊線與 7px CSS 狀態圓點；agent 有輸出時終端卡片頂緣有一條 2px 呼吸 rail（只動 opacity、≤ 4Hz 更新），讓「agent 有沒有在動」變成環境光。深色自訂 tooltip 取代白底原生 title。整體感覺：安靜、有紀律、像 Zed / Linear 等級的原生產品，盯著 AI agent 跑幾小時也不累。

## 2. 方向選擇

| 方向 | 一句話 | 評審總分（20 滿分） | 處置 |
|---|---|---|---|
| QUARTZ — Refined Native | 保留現有 macOS dark DNA，但執行到零誤差：opaque 表面＋頂緣高光取代 blur、單色 SVG 取代 emoji、一套 token 收斂所有尺度、補齊四種互動狀態。 | 16 | 勝出（基底） |
| Calm Focus — Agent Cockpit | 為「盯著 agent 跑數小時」設計的暖中性駕駛艙：chrome 後退、終端卡片化、狀態靠柔光圓點與呼吸動效、tab 色條建立 session 身分。 | 16 | 移植動效語言與 rail |
| GRAPHITE — 石墨設計系統 | 換成近黑冷調的 Linear / Warp 語言：Inter + JetBrains Mono、去飽和語意色、accent 換 #2F7BFF。骨架與 QUARTZ 幾乎同構，多背品牌重塑風險。 | 14 | 移植工程紀律 |

評審分歧值得知道：「美感＋長時間人因」評審偏好 Calm Focus 的暖中性調色盤與呼吸動效（給 9 分）；「工程可行性」評審偏好 QUARTZ 不動品牌色與字體堆疊的保守路線（給 8 分）。兩者總分同為 16。最終以 QUARTZ 為基底是因為它讓 theme.ts 的 export 名稱 100% 保留、15 個元件零改動就能換膚，而 Calm Focus 真正對症的四個決策（呼吸動效、activity rail、tab 顏色 rail、runtime applyTokens）都已移植進來。**暖色調本身沒有採用**，這一點列在待決問題第 1 條。

整合說明：勝出：QUARTZ — Refined Native（工程風險最低、不動品牌色與字體堆疊、theme.ts export 名稱 100% 保留讓 15 個元件零改動換膚）。移植：(1) Calm Focus：runtime `applyTokens(RAW)` 取代 build-time codegen；「呼吸而非旋轉」的 agent-working 語言（activity rail、connecting 狀態點）；TabBar 3×14px 顏色 rail pill；自訂標題列獨立分支。(2) GRAPHITE：明文硬規則「凡交給 `.bs-*` class 控制 hover 的屬性，inline style 不得同時設定同一屬性（改用 `--btn-bg` 插槽或 box-shadow/filter）」；檔名在前目錄在後；uppercase PanelHeader；依可見度 ÷ 風險排遷移、一檔一 commit。(3) 評審一的對比修正方法論：text 四階（新增 text-2 .72、text-3 提至 .48、text-4 .30 純裝飾）。v2 依兩輪評審修正：Phase 1 拆為 1a（半天真快贏）/ 1b（清理與字型），並補 vite-env.d.ts、MarkdownViewer mermaid 改讀 RAW、webfont 以別名家族打包避開 xterm 量測、lint 改 node 腳本含 allowlist、hover 驗收移到逐檔 class 遷移的 phase、ButtonEditor 刪檔前先搬排序、activity rail 綁 onTabData 並節流、diff 行號用 text-3、捲軸粗細列為 open question、新增深色 tooltip 與「選取態單一語言」跨檔驗收、ANSI 調色盤保留舊版為可切換、WebGL context loss 復原、P8 補 Tauri capability。刻意不採用：accent 換色、Inter 字體、淺底深字主按鈕。

## 3. Design tokens

### 3.1 色彩與表面

| Token | 值 | 用途 |
|---|---|---|
| `--bg-0` | `#0e0e10` | 最沉的底：StatusFooter、scrollbar track |
| `--bg-1` | `#141416` | chrome：header、TabBar、右欄畫布、CommandBar（= 舊 C.bg2） |
| `--bg-2` | `#1c1c1e` | 英雄面：xterm 背景與終端卡片、右欄卡片內容面（= 舊 C.bg，必須 opaque，xtermTheme.background 綁 RAW.bg2 而非 var()） |
| `--bg-3` | `#242427` | 浮層：dialog、popover、context menu、搜尋膠囊、tooltip（取代 rgba(30,30,32,.97)+blur） |
| `--bg-4` | `#2e2e30` | 浮起控制項：input、segmented 軌道、badge 底（= 舊 C.bg3） |
| `--fill-hover / --fill-active / --fill-selected` | `rgba(255,255,255,.06) / .10 / .14` | 全 app 唯一的 hover / press / list-selected 三階疊層 |
| `--line / --line-sub` | `rgba(255,255,255,.09) / .055` | 容器外框 / 內部分隔；相鄰元素只允許一方畫線 |
| `--hl-top` | `inset 0 1px 0 rgba(255,255,255,.06)` | 浮層與 header 的頂緣高光，取代 backdrop-filter 的玻璃感 |
| `--text-1` | `#f2f2f7` | 主文、active tab、標題、diff 內容文字（取代原草案的裸 .92） |
| `--text-2` | `rgba(242,242,247,.72)` | 次要但要讀：檔名、log subject、helper、inactive tab、tooltip 文字 |
| `--text-3` | `rgba(242,242,247,.48)` | meta（≈4.3:1）：時間、大小、section label、footer 指標、diff 行號 gutter |
| `--text-4` | `rgba(242,242,247,.30)` | 純裝飾（≈2.6:1，不承擔可讀性）：分隔符、graph 連接線、placeholder、關閉鈕 idle 色 |
| `--accent / --accent-hover / --accent-press` | `#0a84ff / #3d9dff / #0870d8` | 只給 primary 動作、toggle-on、focus ring；品牌字標與 log hash 不再用藍 |
| `--accent-fill / --accent-line` | `rgba(10,132,255,.16) / .38` | toggle-on 底 / focus ring 與邊框；全 app『啟用 / 選取』只用 accent-fill（toggle）與 fill-selected（列表）兩種 |
| `--green / --yellow / --orange / --red / --purple / --cyan` | `#30d158 / #ffd60a / #ff9f0a / #ff453a / #bf5af2 / #5ac8fa` | 語意色，每色配 -fill（.14–.16）與 -line（.35） |
| `--scrim / --scrim-term / --scrim-drop` | `rgba(0,0,0,.55) / rgba(14,14,16,.78) / rgba(10,132,255,.08)` | dialog 遮罩 / 終端重連遮罩 / 拖放染色 |
| `RAW.ansi（純 hex，供 xterm；另保留 RAW.ansiLegacy = 現行表）` | `black #1c1c1e、brightBlack #7c7c80、brightGreen #5be37a、yellow #f0c541、brightYellow #ffe066、blue #3d9dff、brightBlue #6cb8ff、selectionInactiveBackground rgba(255,255,255,.10)` | 修正 ANSI 階序；兩套皆放 src/themes/，Settings › General 可切回舊版 |
| `RAW.highlight` | `[#ff453a, #ffd60a, #30d158, #0a84ff, #bf5af2]` | Terminal 關鍵字高亮色盤（從 Terminal.tsx:50 搬入，需維持純 hex 供 + "70" 串接與 <input type=color>），lint allowlist |
| `禁用色（lint 擋，allowlist 除外）` | `#1e1e2e #cdd6f4 #45475a #313244 #181825 #89b4fa #f38ba8 #fab387 #f9e2af #cba6f7 #515b78 #a06c2c` | Catppuccin 殘留（約 24 處，含 ButtonEditor JSX 內 5 處）一律換成對應 token；#fff 6 處保留於 allowlist |

### 3.2 間距與控件高度

4pt 網格 S = { 0.5: 2px, 1: 4px, 1.5: 6px, 2: 8px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px }。6px 是卡片 gutter 專用值。控件高度四檔用 height 鎖住、垂直 padding 一律 0：compact 22px（footer、面板工具列、icon-only）/ default 26px（header toolbar、CommandBar pill）/ roomy 30px（dialog 表單、HUD pill）/ TabBar row 28px 唯一例外。水平內距三檔 0 8px / 0 10px / 0 14px。gap 只允許 4 / 6 / 8 / 12 / 16。結構常數：header 40px、PanelHeader 32px、CommandBar 34px、StatusFooter 22px、xterm host padding 10px 8px 8px 12px。目標：54 種 padding 組合、9 種 gap 收斂到上述集合。

### 3.3 圓角

R = { xs: 4px（kbd、badge、tag、diff marker、tooltip）, sm: 6px（所有按鈕 / 輸入框 / 列表列 / tab / pill；theme.ts 的 btn* 與 inputStyle 從 8px 降到 6px）, md: 8px（終端卡片、右欄卡片、segmented 軌道、pre）, lg: 10px（popover、context menu、diag panel）, xl: 14px（dialog、ViewerModal）, full: 999px（分支 pill、狀態圓點、HUD pill、搜尋膠囊——凡稱『膠囊』一律 r-full 且 height 鎖定） }。刪除 3 / 5 / 7 / 12px 與 "4px 4px 0 0"。

### 3.4 字體與字級

--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif（不打包 Inter）。--font-mono（僅 UI chrome）: "BS Mono", "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, "Sarasa Mono TC", "Noto Sans Mono CJK TC", ui-monospace, monospace。「BS Mono」是我們自寫 @font-face 的別名家族，指向 @fontsource/jetbrains-mono 的 latin 400/700 woff2（約 60KB、OFL）；刻意不用套件自帶的 CSS，因為它會宣告 "JetBrains Mono" 家族名，而 Terminal.tsx:163 / SideTerminal.tsx:192 的 xterm fontFamily 已指名該家族，會在 term.open + fit 之後非同步換字破壞 cell 量測。xterm 的 fontFamily 維持只吃系統已安裝字型（FONT.term 另設，不含 BS Mono）。字級 6 階：--t-10 10/14、--t-11 11/16、--t-12 12/16（chrome 預設）、--t-13 13/18、--t-15 15/20、--t-20 20/26；body 基準 12px。字重 400 / 500 / 600，chrome 內不出現 700，裸 <strong> 全改 600。數字欄位 tabular-nums；letter-spacing 只有品牌 .08em 與 uppercase label .06em。

### 3.5 陰影／高度

三階，全部不含 blur：--sh-1 0 1px 2px rgba(0,0,0,.35)；--sh-2 0 8px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.35)（popover / menu / 搜尋膠囊 / diag panel / tooltip）；--sh-3 0 24px 64px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4), 0 0 0 1px rgba(0,0,0,.4)（dialog）。所有浮層再疊 --hl-top。硬規則：中央終端容器與其祖先 / 覆蓋層永不出現 backdrop-filter、filter、或 blur > 4px 的 box-shadow；現存 13 處 backdrop-filter 在 Phase 1b 一次歸零。

### 3.6 動效

--dur-1 90ms（hover / press）、--dur-2 140ms（popover、menu、tab、tooltip 延遲後淡入）、--dur-3 200ms（dialog、群組展開）、--dur-breathe 2600ms。--ease cubic-bezier(.2,0,0,1)、--ease-pop cubic-bezier(.2,.8,.2,1)。keyframes：bs-fade-in、bs-pop-in、bs-pop-up、bs-slide-down、bs-breathe（opacity 1→.45→1）、bs-spin、bs-flash、bs-pulse。只動 opacity / transform；按下統一 scale(.97)；面板開關不動欄寬。任何掛在 PTY 輸出路徑上的視覺（activity rail）signal 更新頻率 ≤ 4Hz。@media (prefers-reduced-motion: reduce) 關閉所有 animation / transition。

### 3.7 圖示

新增 src/icons.tsx：手工內嵌約 30 顆 Lucide 風 SVG（MIT；24 viewBox、stroke currentColor 1.75、round cap/join），零 npm 依賴。<Icon name size> 只允許 12 / 14 / 16。清單：terminal, git-branch, folder, folder-open, file, file-code, image, search, settings, sliders-horizontal, pencil, plus, x, chevron-right, chevron-down, arrow-up, arrow-down, refresh-cw, eye, eye-off, upload, download, map-pin, bot, plug, cpu, activity, clock, alert-triangle, check, maximize-2, minus, square, panel-right, columns-2, rows-2。⚙ 一符三義拆成 settings / pencil / cpu。狀態指示 ◐ ● ○ ! 全改 7px CSS 圓點 <StatusDot>。關閉符號統一 12px x SVG。emoji 只保留給使用者內容（自訂 tab icon、command button icon、ContextMenu Icon 子選單）。

## 4. 實作策略

【核心：雙軌分工，不推翻 inline style】inline style 繼續負責佈局與元件特有語意色；新增全域 CSS class（.bs-btn / .bs-iconbtn / .bs-row / .bs-pill / .bs-input / .bs-menu-item / .bs-resize / .bs-tip / kbd）負責 :hover / :active / :focus-visible / :disabled / keyframes / ::after。不引入 CSS framework 或 CSS modules。

【誠實的分期承諾】Phase 1 靠全域 `button` / `:focus-visible` selector 只能拿到：press scale(.97)、焦點環、原生控件深色、disabled 外觀。hover 底色必須等每檔遷移時把 inline `background` 換成 `--btn-bg` 插槽並加 class（步驡 c），因此「hover 有回饋」是 Phase 2–5 各檔的驗收項，不是 Phase 1 的。

【建置前置】build 是 `tsc && vite build`，tsconfig 無 vite/client 型別、src 無 .d.ts；任何 `import "*.css"` / 字型檔都會 TS2307。Phase 1a 第一個 commit 先加 src/vite-env.d.ts（`/// <reference types="vite/client" />`）。

【檔案結構】(1) src/styles/tokens.css：:root 全部 CSS 變數（值寫死一份作 var() fallback）。(2) src/styles/base.css：.bs-* 狀態規則、全域 focus-visible、color-scheme、accent-color、::selection、scrollbar（沿用現行 14px 規格但改 token 色）、keyframes、tooltip、reduced-motion。兩個 CSS 由 index.html `<link rel="stylesheet" href="/src/styles/…">` 載入（Vite build 會抽進 <head>），index.html 保留 html/body/#root 高度、背景、`* { box-sizing }` 的 critical block 避免冷啟動閃版；xterm.css 那條 link 改為 main.tsx `import "@xterm/xterm/css/xterm.css"`。(3) src/theme.ts：新增 `export const RAW`（純 hex/rgba 唯一真相，含 ansi / ansiLegacy / highlight）；C / xtermTheme / overlayStyle / dialogStyle / inputStyle / btnPrimary / btnSecondary / btnDanger 名稱不改，C 的值改為 "var(--…)"。凡在 JS 端消費顏色者（xtermTheme、mermaid themeVariables、hljs 注入、<input type=color>）一律吃 RAW，檔首註解明禁 var()。新增 R / S / T / SH / M / FONT / TYPO 尺度與 button(variant,size) / input(size) 工廠。(4) src/main.tsx：import 字型 woff2 的 @font-face（別名 BS Mono）、xterm.css，開機 applyTokens(RAW)。(5) src/themes/macos-dark.ts 與 macos-dark-legacy.ts：xterm 調色盤兩套，xtermTheme 依 general().terminal_palette 選（Rust general.rs 加一個 `#[serde(default)]` 欄位，約 6 行，是本計畫唯一的 Rust 改動）。

【inline 與 class 優先權硬規則（採 GRAPHITE）】任何交給 .bs-* 控制的屬性，inline 不得同時設定：.bs-btn { background: var(--btn-bg, transparent) }，inline 只設 --btn-bg；hover 態也可改用 inline 未指定的 box-shadow / filter。toggle 用 aria-pressed、列表用 aria-selected、導覽用 aria-current，CSS 統一：[aria-pressed=true] → accent-fill 底 + accent 前景；[aria-selected=true] / [aria-current] → fill-selected 底 + text-1 前景，不再各檔自訂 tint（消除 4 種選取語言）。disabled 只用 opacity .4 + cursor default，不用 pointer-events:none（保留 tooltip 可見與 HTML 原生擋點擊）。

【tooltip】.bs-tip[data-tip]::after 純 CSS 深色氣泡（bg-3、text-2、--t-11、r-xs、sh-2、hover 400ms 延遲後 bs-fade-in），header 4 顆 / CommandBar / StatusFooter / ContextMenu 的 19 處 title → data-tip；disabled 按鈕仍可 hover 顯示原因。

【共用原語，重複兩次再抽】src/icons.tsx、ui/PanelHeader、EmptyState、Notice、Kbd、DialogFrame、SettingsGroup/Row、StatusDot、CloseX(size)。

【遷移順序：可見度 ÷ 風險，一檔一 commit】theme.ts + styles → App.tsx + Terminal.tsx 卡片 → TabBar → 右欄三面板 → Dialogs + CommandBar/StatusFooter → Terminal 內部 → ContextMenu/Markdown → （選配）標題列。每檔四步：(a) hex/rgba → token；(b) 數值 → 尺度；(c) 互動元素加 class、把 hover 態屬性改 --btn-bg 插槽、移除 onMouseOver DOM 改寫（保留同 handler 內的非樣式副作用如 setHoverPath）；(d) emoji → <Icon>。純視覺，不動 store 的資料形狀、持久化格式、IPC 與事件邏輯（允許調整 store 內純數值 clamp 如 min-width）。

【xterm 七條鐵律（寫進 DESIGN.md）】1) 終端容器與其祖先 / 覆蓋層永不出現 backdrop-filter、filter、blur > 4px 陰影。2) xtermTheme.background 必須與 host background 同色（RAW.bg2）。3) 卡片化只用 Terminal.tsx root 的 border-radius + overflow:hidden，不加陰影。4) 改 padding / lineHeight / overviewRulerWidth 後用 htop、fzf、ls --color、Claude Code TUI、中英混排 diff 驗 cols/rows。5) 面板開關不動欄寬，只讓內容 fade in。6) 動畫只用 opacity / transform；掛在輸出路徑的 signal ≤ 4Hz。7) 終端字型只用系統已安裝字型；若日後要用 webfont，必須 `await document.fonts.load('16px "…"')` 後才 `new Terminal`，並在 `document.fonts.ready` 後 `term.clearTextureAtlas(); fit.fit()`。另補 WebGL context loss 復原：onContextLoss → dispose → 1s 後重試載入一次，失敗則寫入 diag log 並在 footer 顯示 notice。

【防回歸】scripts/lint-tokens.mjs（node，跨平台）：掃 src/components/** 與 src/App.tsx 的裸 hex / 裸 monospace / 尺度外 border-radius、font-size；allowlist：#fff、theme.ts、themes/、icons.tsx。package.json 加 "check": "tsc --noEmit && node scripts/lint-tokens.mjs"。每個 phase 的 acceptance 第一條固定為「npm run check 與 npm run build 通過」。docs/ui-baseline/ 存每 phase 結束的三張基準截圖（header+側欄、右欄三面板、對話框）供人工 A/B。DESIGN.md 約 40 行：三階 alpha、選取態單一語言、focus ring、時長、inline/class 優先權、tooltip、xterm 七條鐵律。

## 5. 分期路線圖

| # | Phase | 工時 | 目標 |
|---|---|---|---|
| 1 | Phase 1a — 地基（半天，真正的零風險快贏） | 0.5d | 只動 tsconfig 前置、theme.ts、兩個新 CSS 檔、main.tsx、index.html、MarkdownViewer 的 mermaid 初始化：build 不壞、全 app 有 press / focus / disabled 態、原生控件深色、對話框去 blur、text 對比修正。不碰任何元件結構，不承諾 hover。 |
| 2 | Phase 1b — 清理：backdrop-filter、Catppuccin、字型、ANSI、lint | 1d | 跨檔機械式置換：13 處 backdrop-filter 歸零、Catppuccin 殘留與裸 monospace 歸零、UI chrome 打包等寬字（不影響 xterm）、ANSI 階序修正且可切回舊版、lint 與 DESIGN.md 上線。 |
| 3 | Phase 2 — 單色圖示系統與 App shell | 1.5d | chrome 內 emoji 歸零、工具列從「一排表單框」變成 ghost + segmented、終端成為 6px gutter 的圓角卡片（圓角放在 Terminal.tsx root）、雙 hairline 消失、空狀態重做、深色 tooltip 上線、WebGL 復原——第一印象改變最大的一步，也是第一批拿到 hover 回饋的元件。 |
| 4 | Phase 3 — TabBar 側欄 row anatomy | 1d | 側欄從「功能齊備」拉到 Zed / Warp 等級：一條穩定的文字對齊線、fill-selected 單一 active 語言、CSS 狀態圓點、中性關閉鈕、顏色 rail pill；捲軸粗細維持現狀（除非 open question 回覆改細）。 |
| 5 | Phase 4 — 右欄面板共用原語與 Git 檢視器 | 2.5d | Git / Files / Side terminal 出自同一位設計師：統一 PanelHeader、EmptyState、列樣式、卡片化 right-split；GitPanel diff 升級為帶行號的三欄檢視器（先預解析）、LOG 從終端輸出變 commit 列表。 |
| 6 | Phase 5 — 對話框與底部 Dock | 2d | 五個 modal「來自同一位設計師」（DialogFrame、SettingsGroup/Row、hover 才浮現的列動作），把 ButtonEditor 的排序搬進 Settings 後才刪檔；CommandBar + StatusFooter 當成一個底座重新設計；跨檔覆核選取態單一語言。 |
| 7 | Phase 6 — 終端內部浮層與 agent 感知 | 1.5d | 英雄區塊本身的打磨：搜尋列升級為真膠囊、reconnect 改完整 empty state、HUD 非阻斷回饋、passthrough 畫布級指示、agent-working 呼吸 rail（綁在輸出路徑、節流 ≤ 4Hz）。 |
| 8 | Phase 7 — 右鍵選單與 Markdown 文件模式 | 1d | 右鍵選單補齊 macOS 原生選單資訊層次（可見 hover、disabled / checked / swatch / shortcut、邊界翻轉）；Markdown Preview 從「終端輸出」變成 Linear Docs 級閱讀體驗。 |
| 9 | Phase 8（選配，獨立分支驗收）— 自訂標題列與主題化 | 2d | header 就是標題列，省下約 32px；為 light theme / 更多終端調色盤鋪路。風險較高，不與主線綁定發版。 |

核心 Phase 1a–7 合計 11 人日；含選配 Phase 8 為 13 人日。每個 phase 可獨立出貨、一檔一 commit。

### 5.1 Phase 1a — 地基（半天，真正的零風險快贏）

**目標**：只動 tsconfig 前置、theme.ts、兩個新 CSS 檔、main.tsx、index.html、MarkdownViewer 的 mermaid 初始化：build 不壞、全 app 有 press / focus / disabled 態、原生控件深色、對話框去 blur、text 對比修正。不碰任何元件結構，不承諾 hover。

**工時**：0.5d

**任務**

1. **建置前置：vite-env.d.ts 與 CSS/字型匯入型別**
   - 檔案：`src/vite-env.d.ts`、`tsconfig.json`
   - 新增 src/vite-env.d.ts 內容 `/// <reference types="vite/client" />`（或 tsconfig compilerOptions 加 "types": ["vite/client"]）。沒有它，main.tsx 任何 CSS / woff2 import 都會讓 `tsc && vite build` 以 TS2307 失敗。
2. **tokens.css + theme.ts 的 RAW / applyTokens + MarkdownViewer 改讀 RAW**
   - 檔案：`src/theme.ts`、`src/styles/tokens.css`、`src/main.tsx`、`src/components/MarkdownViewer.tsx`
   - theme.ts 新增 RAW（bg-0…bg-4、fill/line/text 四階、accent 三態、6 語意色 + fill/line、scrim、ansi、ansiLegacy、highlight）；C 的值改成 "var(--…)" 但 key 不變。main.tsx 開機 applyTokens(RAW) setProperty 進 :root。MarkdownViewer.tsx:9-27 的 mermaid.initialize themeVariables 在模組載入時就吃 C，收到 var() 會讓 khroma 推導壞掉——同一 commit 內改讀 RAW（.md-viewer 注入的 CSS 字串可維持用 C）。
3. **base.css 狀態層、keyframes、全域 color-scheme / focus / selection / tooltip**
   - 檔案：`src/styles/base.css`、`index.html`
   - :root { color-scheme: dark } input,textarea,select { accent-color: var(--accent) } ::selection { background: var(--accent-fill) }。:focus { outline: none } :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }；input/textarea:focus-visible → border-color var(--accent-line) + box-shadow 0 0 0 3px var(--accent-fill)。button:active { transform: scale(.97) } button:disabled { opacity: .4; cursor: default }（不用 pointer-events:none）。.bs-btn / .bs-iconbtn / .bs-row / .bs-pill / .bs-input / .bs-menu-item / .bs-resize 規則以 var(--btn-bg) 插槽定義，此階段尚無元件掛上。.bs-tip[data-tip]::after 深色 tooltip。keyframes 全套 + prefers-reduced-motion。index.html：保留 critical block（html/body/#root、box-sizing），scrollbar 規則搬到 base.css 並改 token 色（維持 14px），加 <link rel=stylesheet href="/src/styles/tokens.css"> 與 base.css；xterm.css link 改由 main.tsx import；highlight.js github-dark link 保留到 Phase 7。
4. **theme.ts 尺度、工廠、overlay/dialog 去 blur、text 四階**
   - 檔案：`src/theme.ts`
   - 新增 R / S / T / SH / M / FONT / TYPO 與 button(variant,size) / input(size)。overlayStyle：刪 backdrop-filter blur(6px)，background → var(--scrim)。dialogStyle：刪 blur(40px) saturate，background → var(--bg-3) opaque，box-shadow → var(--sh-3), var(--hl-top)。inputStyle / btn* border-radius 8px → var(--r-sm)；刪 inputStyle 的 outline:none（交全域）。text2 .55→.72、text3 .28→.48，新增 text4 .30。FONT.mono（UI chrome，含 BS Mono）與 FONT.term（終端，只有系統字型）分開。

**驗收**

- [ ] npm run check 與 npm run build 通過（本 phase 起每 phase 第一條）
- [ ] 開啟任一對話框：checkbox / radio / number spinner 為深底藍勾；Tab 巡覽每個按鈕與輸入框有焦點環；按下任一按鈕有 scale(.97)；disabled 按鈕 hover 仍可看到 tooltip
- [ ] 對話框打開時 DevTools Layers 無 backdrop-filter 層；四個 dialog 為 opaque #242427 + 頂緣高光
- [ ] Markdown Preview 的 mermaid 圖顏色與改動前一致（未變成黑白或壞掉）
- [ ] GitPanel「3 days ago」欄、footer 指標、CommandBar 編輯鈕可讀（text3 .48）

### 5.2 Phase 1b — 清理：backdrop-filter、Catppuccin、字型、ANSI、lint

**目標**：跨檔機械式置換：13 處 backdrop-filter 歸零、Catppuccin 殘留與裸 monospace 歸零、UI chrome 打包等寬字（不影響 xterm）、ANSI 階序修正且可切回舊版、lint 與 DESIGN.md 上線。

**工時**：1d

**任務**

1. **移除全部 13 處 backdrop-filter**
   - 檔案：`src/components/Terminal.tsx`、`src/components/GitPanel.tsx`、`src/components/StatusFooter.tsx`、`src/components/SettingsDialog.tsx`、`src/components/ContextMenu.tsx`
   - Terminal 736/749/799/805/833、GitPanel 434/783、StatusFooter 250、SettingsDialog 915、ContextMenu 57/113。浮層改 background var(--bg-3) + border 1px var(--line) + box-shadow var(--sh-2), var(--hl-top)；reconnectOverlay → var(--scrim-term)；dropOverlay → var(--scrim-drop)；GitPanel diffFileHeader → opaque var(--bg-3)。
2. **清除 Catppuccin 殘留（約 24 處 / 全檔裸 hex 38 處）與 ButtonEditor 整檔換 token**
   - 檔案：`src/components/ButtonEditor.tsx`、`src/components/Terminal.tsx`、`src/components/GitPanel.tsx`、`src/components/MarkCwdDialog.tsx`、`src/components/SettingsDialog.tsx`
   - ButtonEditor：L158–228 本地樣式全刪改 import theme 的 C / overlayStyle / dialogStyle / inputStyle / btn*，且 JSX 內 L105/108/109/145/147 的 #fab387 / #45475a×2 / #f38ba8 / #cba6f7 一併換（原草案漏掉）。其餘 #f9e2af→C.yellow、#f38ba8→C.red、#cba6f7→C.purple、#5ac8fa→C.cyan。Terminal.tsx:50 DEFAULT_HIGHLIGHT_COLORS 搬到 RAW.highlight（維持純 hex 供 L146 `+ "70"` 串接與 L696 <input type=color>）。搜尋 decorations 改 match rgba(255,214,10,.30) / activeMatch rgba(255,159,10,.85)（overviewRulerWidth 移到 Phase 2 與幾何一起量）。
3. **FONT.mono 別名字型打包，置換 19 處裸 monospace + 1 處 ui-monospace**
   - 檔案：`src/theme.ts`、`src/main.tsx`、`src/styles/base.css`、`package.json`、`src/components/GitPanel.tsx`、`src/components/ContextMenu.tsx`、`src/components/FileBrowser.tsx`、`src/components/CommandBar.tsx`、`src/components/SettingsDialog.tsx`、`src/components/MarkCwdDialog.tsx`、`src/components/Terminal.tsx`、`src/components/SideTerminal.tsx`、`src/components/StatusFooter.tsx`、`src/components/ButtonEditor.tsx`
   - npm i @fontsource/jetbrains-mono，但不 import 其 CSS；base.css 自寫 @font-face { font-family: "BS Mono"; src: url(…/files/jetbrains-mono-latin-400-normal.woff2) } 400/700 兩條（main.tsx 以 `?url` import 取路徑），font-display: swap。這樣 Terminal.tsx:163 / SideTerminal.tsx:192 指名的 "JetBrains Mono" 不會被 webfont 非同步接管、cell 量測不受影響（鐵律 7）。所有 `"font-family": "monospace"`（19 處，含 ButtonEditor.tsx:102/125）與 StatusFooter.tsx:290 `ui-monospace, monospace` → FONT.mono。Terminal / SideTerminal 的 xterm fontFamily 改引用 FONT.term（內容不變）。
4. **xtermTheme ANSI 階序修正，兩套調色盤可切換**
   - 檔案：`src/theme.ts`、`src/themes/macos-dark.ts`、`src/themes/macos-dark-legacy.ts`、`src/stores/general.ts`、`src/ipc/api.ts`、`src-tauri/src/general.rs`、`src/components/Terminal.tsx`、`src/components/SideTerminal.tsx`
   - macos-dark：black #000000→#1c1c1e、brightBlack #636366→#7c7c80、brightGreen→#5be37a、yellow→#f0c541、brightYellow→#ffe066、blue→#3d9dff、brightBlue→#6cb8ff、補 selectionInactiveBackground rgba(255,255,255,.10)。legacy = 現行表原樣。GeneralSettings 加 `terminal_palette: Option<String>`（Rust `#[serde(default)]`，TS 型別同步），xtermTheme 改為函式 xtermThemeFor(general().terminal_palette)；Settings UI 下拉在 Phase 5 GeneralPane 補。
5. **防回歸：scripts/lint-tokens.mjs、npm run check、DESIGN.md、基準截圖**
   - 檔案：`scripts/lint-tokens.mjs`、`package.json`、`DESIGN.md`、`docs/ui-baseline/`
   - node 腳本掃 src/components/** 與 src/App.tsx：裸 #hex（allowlist #fff）、裸 monospace、尺度外 border-radius / font-size；theme.ts、themes/、icons.tsx 豁免。package.json "check": "tsc --noEmit && node scripts/lint-tokens.mjs"（Windows cmd 可跑）。DESIGN.md 約 40 行：三階 alpha、選取態單一語言（aria-pressed→accent-fill、aria-selected/current→fill-selected）、focus ring、時長、inline/class 優先權、tooltip、xterm 七條鐵律與 rail ≤ 4Hz。存三張 before 截圖。

**驗收**

- [ ] npm run check 與 npm run build 通過；grep -rn backdrop-filter src → 0
- [ ] Git 面板路徑、diag log、ContextMenu 在未安裝 JetBrains Mono 的 Windows 上顯示為 BS Mono；xterm 開啟瞬間與 1 秒後 term.cols / rows 不變、字型不換
- [ ] htop / ls --color：ANSI black 底不再純黑塊、dim 可讀、brightGreen 比 green 亮；把 terminal_palette 設為 legacy 後回到舊外觀
- [ ] ButtonEditor 與 ConnectionDialog 外觀同源（14px 圓角、同色按鈕），JSX 內無 Catppuccin hex
- [ ] Markdown Preview 與 Terminal 關鍵字高亮色票行為與改動前一致

### 5.3 Phase 2 — 單色圖示系統與 App shell

**目標**：chrome 內 emoji 歸零、工具列從「一排表單框」變成 ghost + segmented、終端成為 6px gutter 的圓角卡片（圓角放在 Terminal.tsx root）、雙 hairline 消失、空狀態重做、深色 tooltip 上線、WebGL 復原——第一印象改變最大的一步，也是第一批拿到 hover 回饋的元件。

**工時**：1.5d

**任務**

1. **建立 src/icons.tsx 與 <Icon> / <StatusDot>**
   - 檔案：`src/icons.tsx`、`src/components/ui/StatusDot.tsx`、`src/theme.ts`
   - 手工內嵌 Lucide 風 SVG，P2 先做 16 顆（terminal, git-branch, folder, search, settings, pencil, plus, x, chevron-right, map-pin, bot, plug, cpu, activity, clock, alert-triangle），其餘隨面板補。<StatusDot state> 7px 圓：connected green .7 / connecting yellow + bs-breathe / disconnected 1.5px text-4 空心 / error red + 2px red-fill 光暈。
2. **header 重做：ghost toolBtn、segmented、icon-only、aria-pressed、tooltip、hover 插槽**
   - 檔案：`src/App.tsx`
   - headerStyle：height 40px; padding 0 10px; box-shadow inset 0 -1px 0 var(--line-sub), var(--hl-top)。toolBtn（L577）：border → transparent、height 26px、padding 0 9px、color var(--text-3)、class bs-btn，inline 的 background 改為 `--btn-bg`（步驟 c，hover 才會動）。三顆 toggle 加 aria-pressed、刪三元運算。Terminal/Git/Files 包 segmented（bg-4、r-md、padding 2px）。Find / ⚙ 改 26×26 icon-only。19 處 title → data-tip class bs-tip。刪 L589 本地 btnPrimary，L416 / L449 改 button("primary","sm")（同一 commit，工廠已在 P1a 存在）。
3. **品牌字標、版本號、passthrough 徽章、狀態圓點**
   - 檔案：`src/App.tsx`
   - 品牌：color accent 13px → text-1 12px/600 .08em + 16px app glyph。版本號移到 Settings › About。passthrough：purple-fill / purple / 1px purple-line + bot 12px。L320 ◐ ! ○ → <StatusDot>。
4. **終端卡片化（Terminal.tsx root 裁切）+ resize handle + 雙線消滅 + WebGL 復原**
   - 檔案：`src/App.tsx`、`src/components/Terminal.tsx`
   - App.tsx:443 容器加 padding 6px 6px 0 0（三種 layout 各驗）。Terminal.tsx:478 root（position absolute inset 0）加 border-radius var(--r-md); overflow hidden; background var(--bg-2)——App.tsx 沒有 per-tab wrapper 可套，圓角必須放這裡；無陰影無濾鏡。刪 App.tsx L485 / L517 欄位 border-left 與 handle border-right；handle 改 class bs-resize（width 8px; margin 0 -4px; ::after 2px accent 條 hover .5 / dragging 1）；拖曳時 body.bs-dragging。Terminal.tsx:191 onContextLoss：dispose 後 setTimeout 1s 重試 loadAddon 一次，失敗寫 diag log。
5. **xterm host padding、lineHeight、overviewRulerWidth（一起量幾何）**
   - 檔案：`src/components/Terminal.tsx`、`src/components/SideTerminal.tsx`
   - Terminal.tsx:489 padding 4px → 10px 8px 8px 12px；options 加 lineHeight 1.2、fontWeightBold 600；搜尋 decorations 加 overviewRulerWidth 10（會保留右緣寬度、影響 cols，故在此與 padding 一併驗收）。SideTerminal host 4px → 6px 8px 4px 10px。host background = RAW.bg2 = xtermTheme.background。
6. **空狀態重做**
   - 檔案：`src/App.tsx`
   - 垂直堆疊 gap 12px max-width 360px：40px terminal SVG（text-4）→「No active session」（t-15/600 text-1）→ 副標（t-13 text-3）→ button("primary","md") → <Kbd> Ctrl+Shift+T / Ctrl+F。背景 radial-gradient(ellipse at 50% 40%, rgba(10,132,255,.06), transparent 60%)。
7. **StatusFooter 與 CommandBar 的 emoji 換 SVG、title → tooltip**
   - 檔案：`src/components/StatusFooter.tsx`、`src/components/CommandBar.tsx`
   - 📍🌿🤖🔌🧠⚙⏱⚠ → 12px SVG，color text-4，12px 固定寬 slot。CommandBar L79 ⚙ → 24×24 ghost pencil，data-tip「Edit command buttons」。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] header：只有 + Connect 是實心藍；Terminal/Git/Files 為同一組 segmented；toggle 開啟時文字與圖示一起變藍（accent-fill）；hover 任一 header 按鈕有 fill-hover 底色；hover 400ms 後出現深色 tooltip、disabled 按鈕亦然
- [ ] 終端四周 6px 深色 gutter 與 8px 圓角來自 Terminal.tsx root；三種 layout 下 term.cols/rows 與改動前相差僅 padding + ruler 差額；htop / Claude Code TUI 框線無錯位；console 無 WebGL fallback 警告
- [ ] 模擬 WebGL context loss（DevTools）後終端 1 秒內恢復 WebGL renderer，或 footer 出現 notice
- [ ] 無 tab 時空狀態有圖示、標題、副標、按鈕與 kbd chip

### 5.4 Phase 3 — TabBar 側欄 row anatomy

**目標**：側欄從「功能齊備」拉到 Zed / Warp 等級：一條穩定的文字對齊線、fill-selected 單一 active 語言、CSS 狀態圓點、中性關閉鈕、顏色 rail pill；捲軸粗細維持現狀（除非 open question 回覆改細）。

**工時**：1d

**任務**

1. **固定 row anatomy 與 leading slot**
   - 檔案：`src/components/TabBar.tsx`
   - 列改 [16px leading slot][name flex:1 truncate][trailing meta]，height 28px（含 cwd 40px），padding 0 8px 0 6px。L346 條件式狀態字元 / 🤖 / 📍 / icon 移出流：leading slot 永遠存在，放 <StatusDot> 或自訂 icon（有 icon 時狀態縮成右下 6px 小點）。cwdRowStyle（L595）padding-left 22px、font var(--font-mono)、color text-3。
2. **狀態圓點與 3px 顏色 rail pill**
   - 檔案：`src/components/TabBar.tsx`
   - 刪 statusGlyph（L42），改 <StatusDot>。tab 顏色從 border-left 改 absolute left 2px 3×14px r-2 pill。
3. **active / inactive 對比，選取態統一為 aria-selected**
   - 檔案：`src/components/TabBar.tsx`
   - inactive text-2/400、hover text-1、active text-1/500（不再 600）+ [aria-selected=true] → fill-selected（DESIGN.md 單一選取語言，刪 inset 2px accent 藍條）。有色 tab 的 active 底用 color-mix(in srgb, t.color 18%, transparent)，前置 fill-selected fallback。row 加 class bs-row，inline background 改 --row-bg 插槽。
4. **關閉鈕、trailing meta、CloseGlyph 共用**
   - 檔案：`src/components/TabBar.tsx`、`src/components/CloseX.tsx`
   - closeBtnStyle（L612）：18×18 flex center; r-xs; 12px x SVG; color text-4，hover fill-hover + text-1（用插槽）；visibility → opacity。🤖 / 📍 移到 trailing meta，hover 時讓位給 ×。CloseX 抽 CloseGlyph size="sm|md"。
5. **群組 header、+ New、捲軸漸隱、drop indicator、rename**
   - 檔案：`src/components/TabBar.tsx`、`src/styles/base.css`
   - 群組 header：transparent、t-11/600 uppercase .06em text-3、hover fill-hover、▸ rotate(90deg) 140ms、計數 r-full pill。+ New：ghost row 釘在底部、border-top line-sub、hover 浮現 <Kbd>。側欄捲軸沿用全域 14px（不反轉 ff7551b 的決定），只加 scrollbar-gutter: stable 與上下 12px mask-image 漸隱；若 open question 回覆同意變細，才切 .bs-scroll-slim 並同步套到 GitPanel / FileBrowser / Settings / MarkdownViewer 讓全 app 只有一套捲軸。drop before 線改獨立 2px 元素，刪每列常駐 border-top。rename input：13px; height 20px; bg-4; box-shadow 0 0 0 2px accent-line；autofocus select()。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] 10 個混合狀態的 tab 名稱起點 x 完全相同，cwd 副行與名稱左對齊；切換 active 時寬度與 × 位置不跳動
- [ ] active tab 底色 = Settings 側欄 active 底色 = GitPanel 選取列底色（同一 --fill-selected，Phase 5 覆核）
- [ ] 四種狀態圓點跨平台尺寸一致；error 紅光暈、connecting 呼吸；hover 列與關閉鈕有中性底色
- [ ] 側欄上下有漸隱、捲軸粗細與全 app 一致；+ New 固定在底部；F2 rename 列高不變
- [ ] 拖曳重排、群組收合、中鍵關閉、Ctrl+1..9 行為與改動前一致

### 5.5 Phase 4 — 右欄面板共用原語與 Git 檢視器

**目標**：Git / Files / Side terminal 出自同一位設計師：統一 PanelHeader、EmptyState、列樣式、卡片化 right-split；GitPanel diff 升級為帶行號的三欄檢視器（先預解析）、LOG 從終端輸出變 commit 列表。

**工時**：2.5d

**任務**

1. **建立 PanelHeader / EmptyState / Notice / Kbd 共用元件**
   - 檔案：`src/components/ui/PanelHeader.tsx`、`src/components/ui/EmptyState.tsx`、`src/components/ui/Notice.tsx`、`src/components/ui/Kbd.tsx`
   - PanelHeader：height 32px; padding 0 10px; border-bottom line-sub; 16px SVG（text-3）+ t-11/600 uppercase 標題 + meta slot + 22×22 CloseX(sm)。EmptyState：padding 40px 20px、28px SVG text-4、t-13/500 標題、t-12 text-3 說明；Skeleton 4 條 12px r-sm bg-4 + bs-breathe。
2. **三面板套 PanelHeader、right-split 卡片化、雙線消滅、min-width 統一**
   - 檔案：`src/components/GitPanel.tsx`、`src/components/FileBrowser.tsx`、`src/components/SideTerminal.tsx`、`src/App.tsx`、`src/stores/git.ts`、`src/stores/sideTerm.ts`
   - GitPanel L244、SideTerminal L91/158、FileBrowser 改 PanelHeader；FileBrowser L247 toolbar × 刪。right-split 每面板 margin 6px 6px 0; r-md; bg-2; border 1px line-sub; overflow hidden；刪 SideTerminal L70/118/125 handle border 與 GitPanel border-bottom。SideTerminal 容器與 header 統一 bg-1，只有 xterm host bg-2。min-width 統一 260px：clamp 在 stores/git.ts:57 與 stores/sideTerm.ts:37（240→260，純數值，不改資料形狀）。
3. **FileBrowser：ghost toolbar、breadcrumb、SVG 檔案圖示、膠囊列**
   - 檔案：`src/components/FileBrowser.tsx`
   - navBtn（L358）→ 22×22 ghost class bs-iconbtn，dotfile toggle 用 aria-pressed。pathInput（L345）→ bg-4、1px line-sub、r-sm、height 24px、font-mono；非編輯時 breadcrumb。iconFor（L13）→ folder(cyan) / file(text-4) / file-code(accent) / image(purple) 16px。列改 .bs-row height 26px r-sm；L282-289 handler 只移除 style.background 兩行、保留 setHoverPath（⬇ 下載鈕依賴它）；或改為 CSS `.bs-row:hover .bs-row-actions { opacity:1 }` 並刪 hoverPath——後者是行為改動，需另測下載入口。尾端固定 56px 插槽。
4. **GitPanel：文字對比、section label、StatusBadge、路徑兩段式、LOG chip 化**
   - 檔案：`src/components/GitPanel.tsx`
   - L260/272/394/402/620 text3 → text-2，刪 CommitMeta opacity .7。STATUS/LOG/FILES → TYPO.sectionLabel sticky。M/A/D → <StatusBadge> 16×16 r-xs。路徑拆檔名（text-1）+ 目錄（text-3 11px ellipsis）。LOG：subject font-ui 12px text-1、hash text-3 tabular、refs chip、時間壓成 3d。TabBtn / CommitFileList 選取改 aria-selected → fill-selected（單一選取語言）。
5. **Diff 預解析：hunk → 帶行號陣列（獨立估工）**
   - 檔案：`src/components/GitPanel.tsx`
   - DiffBody（L729）目前 `<For each={lines}>` 逐行 early-return，行號無法在 render function 內累加。新增 createMemo parseDiff(body) → { kind: 'file'|'path'|'hunk'|'add'|'del'|'ctx', text, oldNo?, newNo? }[]，解析 @@ -a,b +c,d @@ 起算；計算 maxDigits 供 gutter 寬度。約 0.5d。
6. **Diff 三欄檢視器與中性文字**
   - 檔案：`src/components/GitPanel.tsx`
   - 每行 grid-template-columns minmax(4ch, auto) minmax(4ch, auto) 2ch 1fr（依 maxDigits，不寫死 4ch）。行號 color var(--text-3)（要讀的定位資訊，非 text-4 裝飾）; text-align right; user-select none; tabular-nums; border-right line-sub。+/- 為 user-select:none marker span（green/red 600）。diffAdd/diffDel 文字 → var(--text-1)（不新增裸 .92 alpha），底色 green-fill / red-fill，gutter 深一階。hunk header 全寬 cyan-fill / cyan。diffFileHeader 單一路徑 + 14px file SVG。diff 行 font-mono 12px/1.55。ViewerModal 改 overlayStyle/dialogStyle + bs-pop-in。
7. **面板可點列、載入 / 空狀態、焦點感知**
   - 檔案：`src/components/GitPanel.tsx`、`src/components/FileBrowser.tsx`、`src/components/SideTerminal.tsx`
   - 可點 div 改 class bs-row role=button tabindex=0 + aria-selected，移除 onMouseOver 的 style 寫入（約 8 處，保留其他副作用）。GitPanel 首載 skeleton、clean 時綠點 +「Working tree clean」；FileBrowser loading 延遲 150ms skeleton、Empty 改 EmptyState。SideTerminal 監聽 term.textarea focus/blur：聚焦 header 標題 text-1 + 6px accent 圓點。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] right-split 同開三面板：header 32px、圖示、關閉鈕一致；面板間只有 6px 間隙；把手可拖到 260px
- [ ] Git 面板「3 days ago」、upstream、changes 計數 1x 螢幕可讀；選取列底色與 TabBar active 相同
- [ ] diff：雙行號 gutter 對比 ≥ 4:1、5 位數行號不截斷；複製不帶 +/-；刪除區塊為柔和紅底 + 紅記號、文字為 text-1
- [ ] FileBrowser：hover 列時 ⬇ 仍出現、檔名不重排；面板 260px 時檔名不先消失
- [ ] 三面板首開顯示 skeleton；SideTerminal 聚焦 header 有 accent 圓點

### 5.6 Phase 5 — 對話框與底部 Dock

**目標**：五個 modal「來自同一位設計師」（DialogFrame、SettingsGroup/Row、hover 才浮現的列動作），把 ButtonEditor 的排序搬進 Settings 後才刪檔；CommandBar + StatusFooter 當成一個底座重新設計；跨檔覆核選取態單一語言。

**工時**：2d

**任務**

1. **DialogFrame 與 Settings 版型原語、terminal_palette 選項**
   - 檔案：`src/components/ui/DialogFrame.tsx`、`src/components/ui/SettingsGroup.tsx`、`src/components/ConnectionDialog.tsx`、`src/components/SettingsDialog.tsx`、`src/components/MarkCwdDialog.tsx`
   - DialogFrame：flex column; padding 0; max-height 85vh；header 48px（t-15/600 + CloseX）/ body flex:1 overflow auto padding 16px 20px / footer border-top line-sub。SettingsGroup（sectionLabel + bg-4 卡片 r-md）+ SettingsRow（padding 10px 14px; border-top line-sub）；GeneralPane 加「Terminal palette: macOS Dark / Legacy」下拉（寫 updateGeneral），清 L166-168 佔位文字。dialog 加 role=dialog aria-modal、bs-pop-in 180ms。Settings 側欄項目 → <button aria-current> + 16px SVG，active 用 fill-selected（不是 accent-fill——那是 toggle 專用）。
2. **ButtonsPane 補排序，再刪 ButtonEditor.tsx**
   - 檔案：`src/components/SettingsDialog.tsx`、`src/components/ButtonEditor.tsx`、`src/components/CommandBar.tsx`、`src/App.tsx`
   - 先：SettingsDialog ButtonsPane（L843-861 目前只有 Edit / ×）import stores/buttons 的 moveButton，每列加 hover 浮現的 arrow-up / arrow-down ghost 鈕（首尾自動 disabled），加即時預覽 pill、7 顆色票 + 隱藏 <input type=color>（值吃 RAW.highlight 純 hex）、6×3 emoji 格。後：SettingsDialog 加 initialPane?: PaneId；App.tsx showButtonEditor → setShowSettings + "buttons"；刪 ButtonEditor.tsx。排序功能零損失才算完成。
3. **列表列改「整列可點 + 動作 hover 浮現」（限 ConnectionDialog 與 ButtonsPane）**
   - 檔案：`src/components/ConnectionDialog.tsx`、`src/components/SettingsDialog.tsx`
   - ConnectionDialog L133–161：row class bs-row 整列 onClick；Connect/Edit/Delete 改 28×28 ghost icon（Delete hover red-fill），.bs-row:not(:hover):not(:focus-within) .bs-row-actions { opacity: 0 }。▲▼（呼叫 moveConnection ±1，僅此檔有）維持上下箭頭語意：去邊框、arrow-up/down SVG、hover 浮現、刪 inline opacity 交給 :disabled；不用 grip-vertical / cursor grab（底下無拖曳實作，會誤導）。若日後要拖曳排序，另立 task 複用 TabBar 拖曳邏輯。SettingsDialog L770/858 只有 Edit / ×，同樣 hover 浮現。
4. **Backup / MarkCwd / Notice 細節**
   - 檔案：`src/components/SettingsDialog.tsx`、`src/components/MarkCwdDialog.tsx`、`src/components/ui/Notice.tsx`
   - L683 <input type=file> 隱藏 + ref，外放「Import backup…」或 dashed drop zone。狀態橫幅 → <Notice kind>。MarkCwd detecting 時 12px bs-spin，補 Cancel。49 處 opacity .6/.7 弱化文字 → 明確 text-2 / text-3。
5. **CommandBar 單行 dock 與 pill 語言**
   - 檔案：`src/components/CommandBar.tsx`、`src/styles/base.css`
   - height 34px; nowrap; overflow-x auto; scrollbar-width none（水平單行 strip 是全域捲軸規則的唯一例外，以右緣 24px mask 漸隱取代）；編輯鈕固定右側；onWheel deltaY→scrollLeft。pill class bs-pill height 26px padding 0 10px：有色 pill 改「6px 色點 + text-2 文字」，邊框 color-mix 35% 前置 var(--line) fallback；:active scale(.97)；送出後 bs-flash；hotkey 顯示 <Kbd>。確認框改錨定 popover（bg-3、r-lg、sh-2、無遮罩）。
6. **StatusFooter 降噪與 diag popover**
   - 檔案：`src/components/StatusFooter.tsx`
   - background → bg-0；border-top → line-sub。cellStyle tabular-nums；CPU 44px、RSS 58px、uptime 56px 固定寬。系統指標 text-4，footer hover 升 text-3；cwd/branch font-mono、cwd text-2。⚠ count 0 時 text-4 + 6px 綠點；>0 才 red + red-fill。popover bs-pop-up 160ms；log 列偶數列 rgba(255,255,255,.02)；level → tag pill；空狀態「No warnings or errors」。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] 四個 modal 標題高度、圓角、按鈕、關閉鈕一致；長列表捲動時標題與 footer 不動
- [ ] 從 CommandBar 編輯鈕進入 Settings › Command Buttons：可上下排序按鈕、預覽 pill 即時變化；ButtonEditor.tsx 已刪且 grep 無殘留 import
- [ ] 連線列表 idle 無實心紅藍方塊；hover 才出現動作鈕與 ▲▼；Tab 可巡覽
- [ ] 【跨檔選取態覆核】截圖並排 header toggle-on / TabBar active / Settings 側欄 active / GitPanel 選取列：toggle 為 accent-fill + accent，其餘三者皆為 fill-selected + text-1，無第三種 tint
- [ ] CommandBar 12 顆仍單行且終端高度不變；footer 數字不抖；0 錯誤時 ⚠ 不是視覺重心；Settings 切換 Terminal palette 即時生效

### 5.7 Phase 6 — 終端內部浮層與 agent 感知

**目標**：英雄區塊本身的打磨：搜尋列升級為真膠囊、reconnect 改完整 empty state、HUD 非阻斷回饋、passthrough 畫布級指示、agent-working 呼吸 rail（綁在輸出路徑、節流 ≤ 4Hz）。

**工時**：1.5d

**任務**

1. **搜尋列膠囊化與 segmented toggle**
   - 檔案：`src/components/Terminal.tsx`、`src/styles/base.css`
   - searchBarStyle（L736）改 height 30px; border-radius var(--r-full)（真膠囊，非 r-lg 10px）：左 search 14px SVG + 透明 input（bs-input）+ Aa/ab/.* segmented（bg-4 軌道 r-full padding 2px，內鈕 24×24 aria-pressed → accent-fill）+ tabular 計數 + ▲▼ + x SVG；下方 t-10 <Kbd> 提示。🎨 → highlighter SVG，highlight 面板變膠囊下展開抽屜（r-lg）。No match：input border red-line、計數 red。右緣預留 10px 不壓捲軸。
2. **reconnect 卡改完整 EmptyState**
   - 檔案：`src/components/Terminal.tsx`
   - reconnectCard（L805）：28px 圓形狀態 badge、t-15/600 標題、host chip mono text-2、errorMessage chip（bg-4 + line-sub + r-sm + mono）、btnPrimary + ghost「Edit connection」；min-width 360px；刪本地 primaryBtn（L858）/ pwInput 改 theme token。scrim radial-gradient(ellipse at center, rgba(14,14,16,.85), rgba(14,14,16,.95))。
3. **HUD pill、浮層動效、終端 crossfade**
   - 檔案：`src/components/Terminal.tsx`、`src/styles/base.css`
   - 上傳中 / 路徑已貼上 / passthrough 切換 / 自動複製 → 底部置中 HUD pill（bg-3; r-full; height 30px; padding 0 14px（尺度內，不用 6px 14px）; t-13/500; sh-1; bs-pop-in 160ms; 1.8s 後淡出）；全螢幕遮罩只留斷線與拖放。搜尋列 bs-slide-down、卡片 bs-pop-in、遮罩 bs-fade-in。tab 切換 visibility 硬切 → opacity 60–80ms crossfade。
4. **passthrough 內框與 agent activity rail（綁 onTabData、節流）**
   - 檔案：`src/components/Terminal.tsx`、`src/App.tsx`
   - passthrough：Terminal root box-shadow inset 0 0 0 1.5px rgba(191,90,242,.45) + 右上角 t-10 mono purple「Ctrl+Shift+P · passthrough」。activity rail：root 內 absolute top 0 height 2px background accent opacity 0。訊號來源是 Terminal.tsx:337 `onTabData(props.tab.id, bytes => …)`（PTY 輸出），不是 L327 term.onData（那是使用者鍵入）。回呼內只寫 `lastOutputAt = performance.now()`（純變數，非 signal）；另設 250ms interval 比對，僅在 active 狀態真的翻轉（>3s 無輸出 → off）時 set signal → 套 / 撤 bs-breathe。onCleanup 清 interval。DESIGN.md 記明 ≤ 4Hz、只動 opacity。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] Ctrl+F：搜尋列為全圓角膠囊、三顆 toggle 同組 segmented、計數等寬；無命中時邊框變紅
- [ ] 斷線時 reconnect 卡有 badge、host chip、錯誤 chip、主次按鈕，pop-in 進場
- [ ] 上傳時終端不被壓黑，HUD pill 自動消失
- [ ] 打字時 rail 不動；`yes | head -100000` 或 agent 輸出時 rail 呼吸、停止 3s 後熄滅；DevTools Performance 中 rail 的 signal 更新 ≤ 4 次/秒
- [ ] 終端持續輸出時開啟搜尋列 / HUD 不增加 composite 層時間

### 5.8 Phase 7 — 右鍵選單與 Markdown 文件模式

**目標**：右鍵選單補齊 macOS 原生選單資訊層次（可見 hover、disabled / checked / swatch / shortcut、邊界翻轉）；Markdown Preview 從「終端輸出」變成 Linear Docs 級閱讀體驗。

**工時**：1d

**任務**

1. **ContextMenu class 化、四個視覺欄位、定位**
   - 檔案：`src/components/ContextMenu.tsx`
   - 表面 → bg-3 + 1px line + sh-2, hl-top + r-lg。列 class bs-menu-item：hover fill-active .10（原 .07 幾乎看不見）、:active .14、[data-danger]:hover red-fill；刪 L94/L139 onMouseOver。MenuItem 新增 disabled（opacity .4，不 pointer-events none）、swatch、checked（accent check）、shortcut（<Kbd>）。bs-pop-in 120ms、submenu 90ms；抽 usePopoverPosition()（clamp + flip）。emoji → 14px SVG。
2. **MarkdownViewer 單色階層與版面**
   - 檔案：`src/components/MarkdownViewer.tsx`
   - h1–h6 text-1；h1 24px/650 + border-bottom line、h2 19px/600 + line-sub、h3 16px、h4 14px、h5-h6 12px uppercase text-2；strong/em inherit；li::marker text-4；a accent。.md-viewer max-width 760px；外層 padding 28px 32px 56px。inline code rgba(255,255,255,.08) r-xs。blockquote 3px 左條 + text-2。表格 th 透明 + border-bottom line；外包 overflow-x auto。
3. **程式碼區塊、hljs 主題、mermaid、載入態、移除 github-dark link**
   - 檔案：`src/components/MarkdownViewer.tsx`、`index.html`
   - pre → bg-1 + 1px line-sub + r-md；code.hljs font-mono 13px/1.55 padding 14px 16px；右上 t-11 uppercase 語言標籤。index.html 移除 highlight.js github-dark.css link，改在注入樣式表寫 15 條 Xcode-Dark 風 hljs（值來自 RAW.hljs：keyword #fc5fa3、string #fc6a5d、number #d0bf69、comment #7f8c98、type #5dd8ff、function #67b7a4、attr #a167e6）。mermaid themeVariables（已在 P1a 讀 RAW）加 fontFamily / fontSize 13px，容器 bg-1 卡片 r-md，.mermaid-pending min-height 96px。Loading skeleton、內容 bs-fade-in、錯誤 <Notice kind=error>。

**驗收**

- [ ] npm run check 與 npm run build 通過
- [ ] 右鍵 tab：hover 列清楚可見、danger 項紅底；Color 子選單圓形色票且目前色有 ✓；靠近右下角自動翻轉
- [ ] README.md Preview：只有連結是彩色；標題階層一眼可辨；程式碼區塊有底色與語言標籤；index.html 無 node_modules CSS link
- [ ] mermaid 圖渲染前後不跳版；載入時 skeleton

### 5.9 Phase 8（選配，獨立分支驗收）— 自訂標題列與主題化

**目標**：header 就是標題列，省下約 32px；為 light theme / 更多終端調色盤鋪路。風險較高，不與主線綁定發版。

**工時**：2d

**任務**

1. **Windows/Linux 自繪標題列 + Tauri capability**
   - 檔案：`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`src/App.tsx`、`src/icons.tsx`
   - decorations: false；capabilities/default.json 目前只有 core:default，需加 core:window:allow-minimize、core:window:allow-toggle-maximize、core:window:allow-close、core:window:allow-start-dragging（否則按鈕與 data-tauri-drag-region 無效）。header 右端自繪 46×32 minus / square / x（hover fill-hover / fill-hover / #e81123）；雙擊最大化、Snap Layouts、多螢幕 DPI 實測。
2. **macOS Overlay 標題列**
   - 檔案：`src-tauri/tauri.conf.json`、`src/App.tsx`
   - titleBarStyle Overlay + hiddenTitle；header 左側預留 78px，移除 L302 假紅綠燈與 C.tRed/tYellow/tGreen；中央顯示 active tab 名稱。
3. **更多終端調色盤與 light theme 留門**
   - 檔案：`src/theme.ts`、`src/themes/`、`src/components/SettingsDialog.tsx`、`src/styles/tokens.css`
   - themes/ 已在 P1b 建立（macos-dark / legacy），此處加 tokyo-night、catppuccin-mocha 並即時 term.options.theme。light theme：tokens.css 加 :root[data-theme=light] 覆寫 + 對應 xterm palette，applyTokens 切換 RAW。

**驗收**

- [ ] npm run check 與 npm run build 通過；tauri capability 變更後 `tauri dev` 無權限拒絕錯誤
- [ ] Windows：可拖曳、雙擊最大化、Win+← 貼齊、關閉鈕 hover 變紅；原生標題列消失
- [ ] macOS：紅綠燈為原生、不與品牌字標重疊
- [ ] Settings 切換終端主題即時生效且不影響 UI chrome

## 6. 第一小時快贏

每項幾分鐘，彼此獨立，做完就能看到差別：

1. 新增 src/vite-env.d.ts（`/// <reference types="vite/client" />`）— 2 分鐘，讓之後任何 CSS / 字型 import 不會讓 `tsc && vite build` 失敗
2. index.html <style> 加 `:root { color-scheme: dark } input,textarea,select { accent-color: #0a84ff }` — 一行修好 WebView2 白底 checkbox / radio / number spinner
3. 加全域 `:focus { outline: none } :focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px } input:focus-visible { border-color: rgba(10,132,255,.4); box-shadow: 0 0 0 3px rgba(10,132,255,.18) } button:active { transform: scale(.97) } button:disabled { opacity: .4; cursor: default }` — 鍵盤焦點、按下回饋、disabled 立刻可見（不用 pointer-events:none）
4. theme.ts 刪 overlayStyle 的 `backdrop-filter: blur(6px)`（scrim rgba(0,0,0,.55)）與 dialogStyle 的 `blur(40px) saturate(180%)`（background #242427 opaque + `inset 0 1px 0 rgba(255,255,255,.06)`）— 四個對話框不再壓 xterm
5. Terminal.tsx 五處、GitPanel 兩處、StatusFooter、SettingsDialog、ContextMenu 的 `backdrop-filter` 全刪，background 改 opaque #242427（grep 一次完成）
6. ButtonEditor.tsx 頂端 import theme 的 C / overlayStyle / dialogStyle / inputStyle / btn*，刪 L158–228 本地樣式，並把 JSX 內 L105/108/109/145/147 的 Catppuccin hex 一起換；全檔 grep 置換 #f9e2af→C.yellow、#f38ba8→C.red、#fab387→C.orange、#cba6f7→C.purple、#5ac8fa→C.cyan
7. theme.ts 新增 `FONT.mono`（先不打包字型，只加 fallback 堆疊 "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, ui-monospace, monospace），置換 19 處 `"font-family": "monospace"` 與 StatusFooter.tsx:290 — 有裝字型的機器立刻改善
8. xtermTheme：black #000000→#1c1c1e、brightBlack #636366→#7c7c80、brightGreen→#5be37a、brightYellow→#ffe066、blue→#3d9dff，加 selectionInactiveBackground rgba(255,255,255,.10) — htop / fzf 純黑塊消失（之後 P1b 再包成可切換）
9. theme.ts text3 `.28→.48`、text2 `.55→.72` — GitPanel「3 days ago」、footer 指標、CommandBar 編輯鈕從隱形變可讀
10. App.tsx toolBtn（L577）的 `border: 1px solid C.border` → `1px solid transparent` — 五顆 outline pill 立刻變 ghost 工具列（本地 btnPrimary L589 不動，它是唯一定義且被 L416 / L449 使用，P2 才與 button() 工廠一起換）
11. Terminal.tsx:489 host padding `4px` → `10px 8px 8px 12px`，加 `lineHeight: 1.2`（FitAddon 自動扣除）— 終端文字不再貼邊，開 htop 目視驗一次

## 7. 待你決定的問題

1. 調色溫度：評審中最重人因的一位偏好 Calm Focus 的暖中性灰（hue 30–40°），本計畫為降低風險維持現有冷調 #1c1c1e 系。要維持冷調，還是在 Phase 1a 的 RAW 就改成暖中性五階（改動成本相同，只是視覺記憶會變）？
2. ANSI 調色盤修正會改變您習慣的終端外觀。計畫已預留 Settings › General「Terminal palette: macOS Dark / Legacy」切換（需在 Rust general.rs 加一個 serde default 欄位，約 6 行）——接受這個唯一的 Rust 改動嗎？或直接換新不留舊版？
3. 是否接受把 JetBrains Mono（latin 400/700，約 60KB）以別名「BS Mono」打包給 UI chrome（Git 路徑、hash、diag log、diff）？終端本身不受影響、仍只用系統已安裝字型。若三台機器都已安裝該字型可略過打包。
4. 側欄 / 面板捲軸：您上一版（ff7551b）刻意把捲軸加粗到 14px 好抓。本計畫預設維持 14px、只加漸隱與 scrollbar-gutter；若您希望側欄改成 6px 纖細軌道，我們會全 app（TabBar / GitPanel / FileBrowser / Settings / Markdown）一起改，避免兩套捲軸並存。要維持粗、還是全部改細？
5. ButtonEditor.tsx 建議刪除、CommandBar 編輯鈕改開 Settings › Command Buttons；上下排序功能會先搬進 Settings 再刪檔（功能零損失，但 modal 尺寸與位置會變）——可以嗎？
6. 連線列表的 ▲▼ 排序：維持上下箭頭（hover 才浮現、去邊框），或您希望投入額外約 0.5d 做真正的拖曳排序（複用 TabBar 拖曳邏輯）？
7. Phase 8 自訂標題列（decorations:false + 4 條 Tauri window 權限）會接手拖曳 / 最大化 / Snap Layouts，是否排進本次範圍，或先觀望？
8. 右欄卡片化每側吃掉 6px gutter，且 Git / Side terminal 的 min-width 從 240 提到 260px；您常用視窗寬度下右欄 380px 是否仍夠用？
9. 是否要加入「agent 有輸出時終端頂緣呼吸 rail」？這是唯一新增的視覺元素（綁 PTY 輸出、≤ 4Hz、只動 opacity），可拿掉。
10. 深色自訂 tooltip（純 CSS data-tip，hover 400ms 後出現）取代原生白底 title——接受嗎？或維持原生 title？
11. 中文等寬字體不打包（Sarasa Mono TC 全集 5–10MB）；您是否已安裝 Sarasa / Noto Sans Mono CJK，或希望 Settings 提供「終端字型」自訂欄位？

## 8. 風險與緩解

- 【build 在第一個 commit 就壞】tsconfig 無 vite/client 型別、src 無 .d.ts，任何 CSS / woff2 import 皆 TS2307。緩解：Phase 1a 第一個 task 就是 src/vite-env.d.ts；每 phase acceptance 第一條「npm run check && npm run build 通過」。
- 【webfont 破壞 xterm cell 量測】Terminal.tsx:163 / SideTerminal.tsx:192 已指名 "JetBrains Mono"，若用 @fontsource 自帶 CSS 會在 term.open + fit 後非同步換字，cols/rows 與 WebGL atlas 錯。緩解：以別名家族「BS Mono」自寫 @font-face，xterm 的 FONT.term 不含它；鐵律 7 規定終端若用 webfont 必須 await document.fonts.load 再 new Terminal，並在 fonts.ready 後 clearTextureAtlas + fit。
- 【C 改成 var() 讓 JS 端消費者壞掉】MarkdownViewer.tsx:9-27 在模組載入時把 C 餵給 mermaid themeVariables（khroma 解析 var() 會失敗）；<input type=color> 與 slot.color + "70" 串接也只吃 hex。緩解：同一 commit 改讀 RAW；RAW.highlight / RAW.hljs 集中管理；theme.ts 檔首註解；lint allowlist 豁免 theme.ts / themes/。
- 【Phase 1 過度承諾 hover】inline background 永遠贏過 class hover，Phase 1 不動元件結構就拿不到 hover 底色。緩解：Phase 1 拆 1a/1b 並把 acceptance 降為 press / focus / disabled / 原生控件；hover 是 P2–P5 各檔步驟 (c)（--btn-bg 插槽 + class）的驗收項。
- 【inline style 蓋掉 class hover（假 bug）】緩解（採 GRAPHITE）：狀態類屬性以 CSS 變數插槽表達或改用 box-shadow / filter；DESIGN.md 與 review checklist。
- 【選取態四種語言遷移後仍各自為政】緩解：DESIGN.md 明定 aria-pressed → accent-fill、aria-selected / aria-current → fill-selected；Phase 5 加跨檔並排截圖覆核為 acceptance。
- 【lint 腳本在 Windows 跑不起來 / 誤殺合法 hex】npm scripts 走 cmd.exe 無 grep；#fff 6 處與 highlight 色盤必須保留。緩解：node scripts/lint-tokens.mjs 含 allowlist。
- 【刪 ButtonEditor 損失排序功能】SettingsDialog ButtonsPane 沒有 moveButton。緩解：先在 ButtonsPane 補排序（含即時預覽）再刪檔，acceptance 明列「可上下排序」。
- 【grip icon 誤導可拖曳】ConnectionDialog ▲▼ 底下只有 moveConnection ±1。緩解：維持箭頭語意只做視覺降噪；拖曳排序另列 open question 與獨立工時。
- 【activity rail 掛在熱路徑】綁錯 term.onData 會在打字時呼吸；每 chunk 更新 signal 在大量輸出時昂貵。緩解：綁 Terminal.tsx:337 onTabData，回呼只寫時間戳，250ms interval 只在翻轉時 set signal；DESIGN.md ≤ 4Hz。
- 【WebGL context loss 永久掉回 DOM renderer】Terminal.tsx:191 目前 dispose 後不重建。緩解：Phase 2 加一次重試 + diag log + footer notice。
- 【token 兩份真相漂移】緩解：RAW 唯一來源，applyTokens runtime 注入；lint 擋元件內裸 hex。
- 【移除 blur 後深度感下降】緩解：--sh-2/--sh-3 外圈黑 ring + --hl-top；ContextMenu 先做前後截圖 A/B。
- 【text3 .28→.48 影響面廣】緩解：同時新增 text-4 .30 純裝飾階；逐檔判斷；行號等要讀的資訊一律 text-3 不落到 text-4。
- 【捲軸粗細反轉使用者近期決定】緩解：預設維持 14px，改細列為 open question，且若改就全 app 一起改避免兩套並存。
- 【xterm 對齊 / 效能回歸】緩解：七條鐵律；每個涉及終端的 phase 在 Windows（WebView2）與 Linux（WebKitGTK）跑 htop / fzf / ls --color / Claude Code TUI；overviewRulerWidth 與 padding / lineHeight 同 commit 量測。
- 【冷啟動閃版】CSS 若只從 main.tsx import 會排在 JS 之後。緩解：tokens.css / base.css 由 index.html <link> 載入，critical block（html/body/#root、box-sizing）留在 index.html。
- 【30 顆手工 SVG 風格不一】緩解：P2 先做 16 顆固定模板，路徑從 Lucide 原始檔複製。
- 【CJK 對齊】緩解：fallback 鏈明列 Sarasa / Noto Sans Mono CJK TC；不打包 5–10MB 字型。
- 【color-mix 跨平台】緩解：只用於失效也無害的 tint，前置 rgba fallback。
- 【純視覺改動誤傷互動】FileBrowser onMouseEnter 同時做 setHoverPath；TabBar / GitPanel 含拖曳、鍵盤邏輯。緩解：只移除 style 寫入行、保留副作用；一檔一 commit；手動測試清單。
- 【Diff 三欄檢視器工時低估】DiffBody 逐行 early-return 無法累加行號。緩解：拆出「預解析 hunk」獨立 task（0.5d），Phase 4 估 2.5d；gutter 用 minmax 依位數。
- 【工時】八個 phase 合計 13 人日（1a 0.5 + 1b 1 + 1.5 + 1 + 2.5 + 2 + 1.5 + 1 + 選配 2），不含選配 Phase 8 為 11 人日，實際易拉長 1.5 倍。緩解：P1a–P3 是最高 ROI 的四天；每 phase 可獨立出貨。
- 【自訂標題列平台風險（P8）】decorations:false 需 4 條 core:window 權限且可能失去 Snap Layouts。緩解：選配、獨立分支、Windows 11 實機驗收後合併；macOS 走 Overlay。

## 附錄 A. 稽核 high 發現一覽

每個範圍只列 high；medium／low 已折進各 phase 的任務。

### shell-chrome（high 4、medium 9、low 4）

- theme.ts 缺少非顏色 token(radius / spacing / type / shadow / motion),導致全專案數值發散 — `src/theme.ts:3`
- 工具列每顆按鈕都有 1px 外框,五顆 outline pill 並排像表單而非工具列 — `src/App.tsx:577`
- Shell 工具列沒有 hover / pressed / focus-visible / disabled 視覺狀態 — `src/App.tsx:363`
- 彩色 emoji 當 icon:無法套色、跨平台渲染不一、基線與光學尺寸不齊 — `src/App.tsx:374`

### tabbar（high 4、medium 9、low 8）

- 列首元素全部是條件式,名稱的 x 位置每列不同 — `src/components/TabBar.tsx:346`
- active / inactive 對比不足,且 font-weight 500→600 造成文字寬度跳動 — `src/components/TabBar.tsx:338`
- 狀態用文字字元(◐ ● ○ !)而非 CSS 圓點,跨平台字型渲染不一致 — `src/components/TabBar.tsx:42`
- × 關閉鈕命中區太小、無 hover 回饋、垂直不居中,且與 CloseX 用不同字元 — `src/components/TabBar.tsx:612`

### terminal（high 4、medium 5、low 5）

- 等寬字型未隨 app 打包，macOS / Linux 會退回 Courier 或系統預設，且無 CJK 等寬 fallback — `src/components/Terminal.tsx:163`
- xtermTheme ANSI 色階錯亂：brightGreen 比 green 暗、yellow 與 brightYellow 相同、black 為純黑 — `src/theme.ts:42`
- 五處 backdrop-filter 直接疊在 WebGL canvas 上（重連遮罩、拖放遮罩、搜尋列、高亮面板、重連卡） — `src/components/Terminal.tsx:799`
- host padding 只有 4px，文字貼邊、英雄區塊沒有呼吸感 — `src/components/Terminal.tsx:489`

### git-panel（high 4、medium 13、low 10）

- text3 對比僅約 2.4:1,面板內大量資訊性文字幾乎讀不到 — `src/components/GitPanel.tsx:284`
- Diff 的 +/- 行整行文字染成飽和綠/紅,程式碼可讀性差 — `src/components/GitPanel.tsx:800`
- Diff 沒有行號 gutter,長 diff 失去定位感 — `src/components/GitPanel.tsx:729`
- Modal 面板與 file header 使用 backdrop-filter,疊在 xterm 上白耗 GPU — `src/components/GitPanel.tsx:434`

### side-files（high 5、medium 10、low 7）

- 三個疊放面板的關閉鈕長相不一致（✕ vs ×） — `src/components/FileBrowser.tsx:247`
- FileBrowser 沒有標題，且 toolbar 六顆帶邊框按鈕過於吵雜 — `src/components/FileBrowser.tsx:179`
- emoji 圖示（📁 📄 🖼️ ⬆📄 ⬆📁 📟）在不同平台顏色與字寬不一致 — `src/components/FileBrowser.tsx:13`
- 路徑 input 沒有 focus ring，且用了 generic monospace 與錯的 surface token — `src/components/FileBrowser.tsx:345`
- right-split 疊放時 Git 與 Side terminal 之間出現 2px 雙線 — `src/components/SideTerminal.tsx:70`

### commandbar-footer（high 4、medium 14、low 11）

- ButtonEditor 整個對話框還是舊 Catppuccin 調色,與全 app 的 macOS 深灰語言斷裂 — `src/components/ButtonEditor.tsx:158`
- StatusFooter 與 CommandBar 用彩色 emoji 當 11-12px 圖示,在 Windows 上呈現為 Segoe UI Emoji 彩圖 — `src/components/StatusFooter.tsx:113`
- Diag popover 的 backdrop-filter: blur(40px) saturate(180%) 直接壓在 xterm 畫布上,且背景 .97 讓模糊毫無視覺效益 — `src/components/StatusFooter.tsx:249`
- index.html 未宣告 color-scheme: dark,ButtonEditor 的原生 checkbox 在 Windows WebView2 上會渲染成淺色控件 — `src/components/ButtonEditor.tsx:132`

### Dialogs（high 5、medium 12、low 10）

- 【快速修】全域缺少 color-scheme: dark，原生控件呈淺色 — `D:/0_CODE/bookshell/index.html:10`
- 【快速修】ButtonEditor 整份仍是 Catppuccin 舊配色 — `src/components/ButtonEditor.tsx:158`
- 【中型】沒有任何鍵盤焦點環，也沒有 hover／active／disabled 狀態 — `src/theme.ts:72`
- 【快速修】overlay 全螢幕 backdrop-filter 壓在 xterm WebGL canvas 上 — `src/theme.ts:54`
- 【中型】列表每列三顆實心按鈕 + ▲▼ 邊框小鈕，視覺噪音過高 — `src/components/ConnectionDialog.tsx:133`

### menus-markdown（high 3、medium 11、low 10）

- Hover 高亮幾乎看不見，且以 JS 改 inline style、無過渡 — `src/components/ContextMenu.tsx:94`
- 標題、強調、inline code 使用六種彩虹色，讀感像 log 而非文件 — `src/components/MarkdownViewer.tsx:49`
- 字級階層不完整：h3 幾乎等於本文，h4–h6 只靠顏色區分 — `src/components/MarkdownViewer.tsx:43`

### lens-consistency（high 7、medium 12、low 5）

- ButtonEditor.tsx 整個檔案仍是 Catppuccin Mocha 配色，未遷移到 theme.ts — `src/components/ButtonEditor.tsx:158`
- Catppuccin 殘留色散落在 Terminal / GitPanel / MarkCwdDialog — `src/components/Terminal.tsx:112`
- 字級 9 階（9–20px），宣告 base 13px 但實際主體是 12px/11px — `src/App.tsx:584`
- border-radius 9 階（3/4/5/6/7/8/10/12/14px），theme 宣告的 8px 反而不是主流 — `src/theme.ts:77`
- 間距無尺度：padding 54 種組合、gap 9 種，多處奇數值 — `src/components/TabBar.tsx:562`
- 按鈕變體 20+ 組獨立定義，「主要按鈕」就有 6 版 — `src/App.tsx:589`
- 「選取／啟用」狀態有 4 種視覺語言 — `src/components/TabBar.tsx:325`

### lens-states-motion（high 5、medium 12、low 8）

- 【快速】共用按鈕 token 沒有 hover / active / disabled 變體 — `src/theme.ts:83`
- 【快速】outline:none 無替代焦點樣式，鍵盤焦點不可見 — `src/theme.ts:79`
- 【快速】Header 工具列 toolBtn 無 hover / active / disabled 視覺 — `src/App.tsx:577`
- 【快速】多層 backdrop-filter 直接覆蓋 xterm canvas 與捲動區 — `src/components/Terminal.tsx:799`
- 【快速】ButtonEditor 整個停在舊 Catppuccin 主題，按鈕無任何狀態 — `src/components/ButtonEditor.tsx:158`

### lens-icons-type（high 3、medium 4、low 5）

- 功能性圖示全面使用彩色 emoji,無法隨主題/狀態變色 — `src/App.tsx:374`
- 裸的 `"monospace"` 通用字型關鍵字散落十餘處,Windows 上會退回 Courier New — `src/components/GitPanel.tsx:317`
- ButtonEditor.tsx 整份對話框使用另一套完全不同的色票/圓角,與 theme.ts 脫鉤 — `src/components/ButtonEditor.tsx:170`
