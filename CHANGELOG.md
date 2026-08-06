# Changelog

本專案所有值得注意的變更都記錄在此。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

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
