# Changelog

本專案所有值得注意的變更都記錄在此。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### 開發基礎建設

- **GitHub Actions CI**:push / PR 到 `master` 時自動跑後端 + 前端的 `tsc --noEmit` 與單元測試(Node 24)。
- **後端路由 HTTP 整合測試**:`server.ts` 拆出可測的 `buildApp(deps)`(路由 + 中介層,不含 listen/WS);用 supertest 鎖住安全行為(非本機 Host→403、跨站改狀態 Origin→403、`/observe` 越界路徑→400)。後端測試 126 → 133。

## [1.1.0] - 2026-08-09

### 安全強化(2026-08-09)

一次針對本機工具威脅模型(使用者造訪的惡意網頁、其他本機程序、路徑/注入濫用)的安全審查與縱深防禦補強。後端單元測試 **121 → 126**。

#### Security(安全)
- **改狀態路由加顯式 CSRF/Origin 檢查**:新增 `isCsrfSafe(method, origin)`——非 `GET`/`HEAD` 請求須來自本機 `Origin`(無 `Origin` 的非瀏覽器客戶端放行);server 加中介層擋跨站改狀態請求。原本僅靠「`express.json` 不解析非 JSON body + `application/json` 觸發 preflight」的**隱性**防護,現改為**顯式**,避免未來改動 body 解析或 CORS 設定時防護消失。
- **`/observe` 白名單解析 symlink**:新增 `isUnderRoot()` 以 `realpathSync` 解析實體檔,防 `~/.claude/projects` 內指向外部的 symlink 以文字前綴繞過白名單;`isObservableFile()` 改為委派(檔案不存在時退回文字正規化,保留原行為)。
- **`.gitignore` 補 `.env` / `.env.*`**:目前碼中無密鑰(Agent SDK 沿用 Claude Code CLI 登入),為防未來誤 commit。

#### 審查結論(現況良好、無需改動的既有控制)
- 綁 `127.0.0.1`(非 LAN)、反 DNS rebinding(HTTP `Host` + WS `Origin`)。
- **agent 工具全程人工核准**:`canUseTool` 對每個工具呼叫 block 成 pending,只有使用者按核准/拒絕才放行,無自動執行。
- `makeDir` 名稱驗證擋 `.`/`..`/路徑分隔符;前端無 XSS sink(React 轉義);後端無命令執行;碼中無密鑰。
- 已知悉的低風險(屬單人本機工具固有特性,由 127.0.0.1 + CORS 緩解):`/dirs`·`/mkdir` 無路徑白名單、WS 允許無 `Origin` 的本機非瀏覽器連線。

### 可及性與 UI/UX 強化(2026-08-07)

一批聚焦於**鍵盤可及性、對比、圖示一致性**的前端改進,涵蓋 SourcePicker、header、Agents 面板、對話面板,以及三個 overlay(ApprovalModal / AgentModal / WorkspacePicker)。前端單元測試 **65 → 83**。

#### Added(新增)
- **`useModalFocus` hook**:modal 開啟時把焦點移進 modal,並用 Tab focus trap 讓焦點在內部循環;套用於 AgentModal 與 WorkspacePicker(未來新 modal 掛 ref 即可)。
- **對話自動捲動**:有新訊息時黏底跟隨 agent 輸出;使用者往上翻閱歷史(離底部 >120px)則暫停跟隨,回到底部再恢復。
- **多行任務輸入**:composer 由單行 `<input>` 改 `<textarea>`——Enter 送出、Shift+Enter 換行、隨內容自動長高(上限約 5 行)。
- **下拉方向鍵導覽**:SourcePicker 下拉支援 ArrowUp/Down/Home/End 移動焦點。

#### Changed(變更)
- **SourcePicker 專案顯示名**改為優先取真實路徑(`cwd`)最後一段資料夾名——跨 OS / 磁碟都正確;抽不到 `cwd` 才反解 slug,並泛用化前綴去除,消除 `D//` 與整條 `/Users/...` 的舊行為。
- **全站次要文字色** `fg-faint` → `fg-muted`:實測 `fg-faint` 於雙主題皆未達 WCAG AA(淺 2.7–3.0、深 3.4–3.7:1),`fg-muted` 則 ≥5:1。`fg-faint` 現僅保留給裝飾性 chevron 圖示色。
- **emoji / 文字符號圖示改 SVG**:`📁`、`↰`、`✕`、下拉的 `▸ ◂ ＋ ▾` 等一律換成 currentColor 的 inline SVG,與全站圖示同一視覺系。
- SourcePicker「觀察 Claude / Antigravity」兩列改 **drill 版面**(文字靠左、chevron 靠右)。

#### Accessibility / Fixed(可及性 / 修正)
- **統一焦點環**:全站互動控制補上 `:focus-visible`(icon-btn、arow、subchip、btn、analyze-btn、wpick-row、下拉項目、modal 導覽鈕等),與 input 焦點視覺一致。
- **一致的 Esc 關閉**:所有 overlay 都能按 Esc 收回(補上原本缺少的 WorkspacePicker)。
- **Modal 焦點管理**:ApprovalModal / AgentModal / WorkspacePicker 開啟時聚焦(核准框聚焦「拒絕」為安全預設)並加 focus trap。
- **輸入框可及名稱**:任務輸入、新資料夾名稱補上 `aria-label`(不再只靠會變動的 placeholder)。
- **截斷標題可讀全文**:session 列、agent 列的 `title` tooltip 帶完整標題(+ 路徑)。
- 移除「N 待核准」badge 上誤導的 `cursor: pointer`(它只是指示器,ApprovalModal 會自動彈出)。

#### Tests / Chore
- 前端單元測試 65 → 83(新增 `useModalFocus`、對話自動捲動、Esc 關閉、aria-label、tooltip、方向鍵、Shift+Enter 等)。
- `vitest.setup` 補 `scrollIntoView` stub(jsdom 未實作)。

相關 commit:`71ca483`…`fcea2dd`。
