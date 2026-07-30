# 觀察清單「瑣碎 session」摺疊設計

**日期**:2026-07-29
**狀態**:設計已核准(三段皆過),待寫實作計畫

## 目標

觀察模式(Route A)的 Claude session 清單會列出 `~/.claude/projects` 底下**每一個 `.jsonl` 主檔**,
標題取自對話第一句。因此像 `/model`、空 `/init` 這種「開頭就是一個純 slash 指令、之後沒對專案做任何事」
的 session 也照列,變成清單雜訊。

要**在不刪除、不誤殺真實工作**的前提下,把這類瑣碎 session 從預設視野收起。

## 為什麼是「摺疊」而非「過濾刪除」

用真實資料驗證後,所有單一 proxy 都不乾淨:

- **檔案大小不可靠**:`/model` 檔案 137 KB,但實際只有 2 輪對話、1 個 `ReportFindings` 呼叫——大小是被
  單則巨大訊息灌出來的。
- **記錄筆數分不開**:`/model`(14 行)、`/init`(13 行)夾在一堆小型 e2e/spike 測試任務(9–43 行)中間,
  按筆數排序會連真實小任務一起摺掉。
- **「有無改檔工具」也不足**:一次性測試殘骸(`Write diag-ok.txt`)有改檔卻是垃圾;真實的唯讀分析任務
  (`Read src/ 全讀並總結`)沒改檔卻是實質工作。

因此使用者選定:**不替使用者做刪除決定,只把瑣碎的收進一個 toggle,入口永遠在**。判斷失誤時損失僅為
「多點一下 toggle」,而非 session 從清單消失。

## 「瑣碎」的精準定義

真正能把 `/model`、空 `/init` 跟真實(即使很小的)任務分開的,只有語意:**開頭是光禿禿的 slash 指令,
且之後沒對專案做任何事**。形式化為四條 **同時成立**:

```
trivial = isCommand && subagents === 0 && !hasMutation && lines < LINE_THRESHOLD
```

| 條件 | 意義 | 為何需要 |
|---|---|---|
| `isCommand` | 第一句 user 訊息來自 `<command-name>`(如 `/model`、`/init`) | 真實任務開頭是自然語言指令,第一條就排除,永不被摺 |
| `subagents === 0` | 沒有派出子代理 | 有 subagent = 有實質工作 |
| `!hasMutation` | 檔內沒有 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的 `tool_use` | 直接滿足「`/init` 後有改專案就不能濾」 |
| `lines < 40` | 記錄筆數低於門檻(安全網) | `/init` 後大量續作(即使沒用改檔工具、例如 Bash 改檔)自動保留 |

`LINE_THRESHOLD = 40`:bare 指令 session 約 13–14 行,任何有意義的續作都會超過。

驗收對照:

- `/model`(bare、sub 0、mut 0、14 行)→ 四條全中 → **trivial**
- 空 `/init`(bare、sub 0、mut 0、13 行)→ **trivial**
- `/init` 後有改專案(有 Write/Edit,或行數 ≥ 40)→ 第 3 或第 4 條擋下 → **保留**
- `Read src/ 並總結`(開頭是自然語言)→ 第 1 條不成立 → **保留**(且不被掃描)

## 架構

### 後端 `src/sessions.ts`

`ClaudeSessionInfo` 新增欄位 `trivial: boolean`。`listSessions` 仍回**全部**、仍按 `mtime` 排序——不刪任何東西,只多帶旗標。

**訊號取得(成本控制是重點)**:

1. `firstMeta` 已在用 `cleanTitle` 比對 `<command-name>`;順手多回傳 `isCommand: boolean`。
2. **只有 `isCommand && subagents === 0` 的 session 才需要掃內容**;其餘直接 `trivial = false`,完全不掃。
3. 對候選做**單次有界掃描**(上限 40 行)同時取得 `hasMutation` 與 `lines < 40`:
   - 逐行讀檔,計數;**一到 40 行就判定非瑣碎、立刻停**(因為 `lines >= 40` 已排除 trivial)。
   - 40 行內只要出現改檔工具的 `tool_use` → 非瑣碎、立刻停。
   - 讀完檔仍不足 40 行且無改檔 → `trivial = true`。
   - 每個候選最多讀 ~40 行,近乎零成本。

**純函式抽離(供測試)**:

```ts
// 依訊號判定是否瑣碎;純函式,四條分支好測。
export function classifyTrivial(sig: {
  isCommand: boolean; subagents: number; hasMutation: boolean; lines: number
}): boolean
```

掃描候選內容的函式(讀檔、上限 40 行、回 `{ hasMutation, lines }`)另立,帶 debug log(讀檔失敗印實際
error、不吞掉)。

> Antigravity 不涉及 slash 指令,`AntigravitySessionInfo` **不加** `trivial`;前端對 Antigravity 分支
> 一律當非瑣碎處理。旗標只掛在 `ClaudeSessionInfo`。

### 型別鏡射

- `src/types.ts`:`ClaudeSessionInfo` 加 `trivial: boolean`。
- `web/src/wireTypes.ts`:同步加上,附註解。

### 前端 `web/src/components/SourcePicker.tsx`

**純函式抽離(供測試)**:

```ts
// 把 session 清單拆成正常組與瑣碎組(僅 Claude 有 trivial;其餘皆入 normal)。
export function splitSessions(list: SessionInfo[]): { normal: SessionInfo[]; trivial: SessionInfo[] }
```

**呈現**:

- 正常組照舊直接列在上面(組內維持 mtime 排序,不重排)。
- 瑣碎組**預設收起**;底部一個 `▸ 顯示瑣碎 session (N)` 的 toggle,點了才展開列出;再點收回。
- `N === 0` 時不顯示 toggle。
- Antigravity 分支完全不變(其 session 全入 normal,toggle 不出現)。

## 資料流

```
listSessions() ──(每筆帶 trivial)──▶ GET /sessions?system=claude
   │  只掃 isCommand && sub===0 的候選,上限 40 行
   ▼
SourcePicker: splitSessions(list) → { normal, trivial }
   │  normal 直接列;trivial 收在 toggle 後(預設收起)
   ▼
使用者點 toggle 才展開瑣碎組
```

## 錯誤處理

- 候選掃描讀檔失敗:`try/catch` 印出實際 error(遵循全域偏好),該筆退回 `trivial = false`(寧可少摺、
  不誤藏),不讓單一壞檔中斷整個 `listSessions`。
- 現有 `/analyze` 自產逐字稿過濾(`sessions.ts:47` 比對 `ANALYSIS_PROMPT_OPENING`)保持不變;新規則疊在
  其後,同一過濾/標記層。

## 測試(TDD)

**後端(node env)**

- `classifyTrivial` 四條分支:
  - bare 指令 + sub 0 + 無改檔 + 少行 → `true`
  - `isCommand=false`(真實任務)→ `false`
  - `hasMutation=true`(`/init` 後有改檔)→ `false`
  - `lines >= 40`(續作)→ `false`
  - `subagents > 0` → `false`
- `listSessions` 整合測試:在暫存目錄放 fixture `.jsonl`——
  - bare `/model` 主檔 → `trivial: true`
  - `/init` + 一筆 Write `tool_use` → `trivial: false`
  - `/init` + 41 行 → `trivial: false`
  - 非指令小任務 → `trivial: false`(驗證未觸發內容掃描亦可)

**前端(jsdom env)**

- `splitSessions`:混合清單正確拆成 normal / trivial;Antigravity 全入 normal。
- `SourcePicker`:預設不顯示瑣碎項,顯示 `顯示瑣碎 session (N)`;點 toggle 後瑣碎項出現;`N===0` 不顯示 toggle。

## 不做(YAGNI)

- 不做活躍度分數排序(已驗證分不開,改用精準謂詞 + 摺疊)。
- 不做使用者可調門檻/自訂規則。
- 不持久化 toggle 展開狀態(每次開下拉回到預設收起即可)。
- 不對 Antigravity 做任何瑣碎判定。
