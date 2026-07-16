# Antigravity 觀察模式 設計(Antigravity Observe)

> 狀態:已核准。實作前請用 superpowers:writing-plans 產出 plan。
> 日期:2026-07-16

## 目標

把 Google **Antigravity** 的 agent 逐字稿接進本專案既有的「觀察模式(Route A,唯讀)」,
讓使用者能像旁觀 Claude Code session 一樣,即時重建 Antigravity 對話的 ReAct 互動樹 + 活動日誌。
右側 `SnapshotStore`、`ReActAssembler`、整個前端資料流**不動**,只新增最左邊的「來源轉譯層」。

## 背景 / 為什麼可行(已實測)

探針 `spike/antigravity-probe.ts` 已在 3 個真實對話上驗證:

- **資料位置**:`~/.gemini/antigravity/conversations/<conversationId>.db`,每個對話一個 SQLite。
  (IDE 目錄 `.antigravity-ide` 與 VS Code 的 `state.vscdb` 都**不含**對話內容。)
- **schema**:表 `steps`,一列一步,關鍵欄位
  `idx(游標), step_type, status, has_subtrajectory, step_payload(blob), render_info(blob)`。
  另有 `trajectory_meta(trajectory_id, cascade_id, ...)`、`trajectory_metadata_blob(角色身分)`。
- **`step_payload` 是 protobuf**(二進位),但工具參數以 **JSON 字串**、assistant 思考以**明文**內嵌其中,
  用泛型 wire-format 走訪即可撈出,**不需要 `.proto`**。
- 探針結果(工具節點 / toolAction 涵蓋):279→173(94%)、50→22(82%)、123→102(100%)。
- **每個工具自帶 `toolAction`**(例:`"Read original user request file"`)= 明文的「為什麼用這個工具」,
  正好餵給既有的 💡 想法(reason)UI。這是相對 Claude(extended thinking 被清空)的優勢。
- **subagent 是各自獨立的 `.db`**(每個 db 帶角色身分 orchestrator/explorer/reviewer/auditor;
  `has_subtrajectory=0`、`parent_references` 空、cascade_id==檔名)。跨 db 連樹較脆 → v1 不做。

## 範圍(v1)

- **只做觀察、唯讀**。Antigravity 無法經 SDK 操控,行為與 Claude Route A 一致
  (無核准框、不能暫停 / 派任務)。
- **一個 `.db` = 一個 agent 區塊,扁平**。`invoke_subagent` 呈現成單一節點(派了誰、什麼任務),
  **不自動展開子 db**。跨 db 連成一棵樹 = 明確排除的後續增強。
- **reason 來源 = `toolAction`**(每工具自帶、精準、82–100% 涵蓋)。
  type-15 明文思考 v1 **先不顯示**(留作之後「批次理由」加強),以維持右側「只留真對話」。

## 架構 / 模組

右側 `SnapshotStore` / `ReActAssembler` / 前端資料流不動。新增 4 個後端模組,並在
`SourceController` / `/observe` / `/sessions` 加 `system` 維度。

### 資料流

```
antigravitySource(開 db、依 idx 讀 steps、輪詢)
   → decodeStep(payload) → DecodedStep      [antigravityProto.ts]  (protobuf 萃取)
   → translateAntigravityStep({idx,step_type,status,decoded}, parentId) → FrontendEvent[]  [translateAntigravity.ts]  (純物件、可測)
   → SourceController.ingest → ReActAssembler.process → SnapshotStore → WS → 前端(不變)
```

### 新模組

| 檔案 | 職責 | 介面(供其他任務依賴) |
|---|---|---|
| `src/antigravityProto.ts` | 泛型 protobuf 字串萃取;`decodeStep(payload: Buffer): DecodedStep`。**風險最高、最該測**。 | `decodeStep(payload) => { toolName?: string; args?: Record<string,unknown>; text?: string }`;另匯出低階 `harvestStrings(buf: Buffer): string[]` 供測試。 |
| `src/translateAntigravity.ts` | 純函式:一筆**已解碼** step + parentId → `FrontendEvent[]`。protobuf 不進這裡,方便用純物件測。 | `translateAntigravityStep(step: DecodedRow, parentId: string \| null): FrontendEvent[]`,其中 `DecodedRow = { idx: number; step_type: number; status: number; decoded: DecodedStep }`。 |
| `src/antigravitySource.ts` | 開 SQLite(`node:sqlite`,readOnly)、依 `idx` 讀 steps、`idx` 當游標輪詢新 step、`{ start, stop }` 對齊現有 source。 | `class AntigravitySource { constructor(file: string, emit: (evs: FrontendEvent[]) => void, pollMs?: number); start(): void; stop(): void }` |
| `src/antigravitySessions.ts` | 列 `conversations/*.db`:角色身分、mtime、step 數、workspace(首個帶路徑 step 抽)。 | `listAntigravitySessions(root?: string): AntigravitySessionInfo[]`;`antigravityWorkspace(file): string` |

### step_type → FrontendEvent 對映(內容驅動,不死背 type 號)

`decodeStep` 先解出 `{ toolName?, args?, text? }`,再由 `translateAntigravityStep` 分派:

- `step_type === 14`(使用者任務)→ `{ kind: 'message', role: 'user', text }`
- `step_type === 15`(assistant 明文思考)→ v1 **忽略**(僅 debug log;之後可改 assistant-text)
- 有 `toolName` 或 `args.toolAction/toolSummary` → 一個 `tree:node`:
  - `type`: `toolName === 'invoke_subagent'` ? `'subagent'` : `'tool'`
  - `label`: `` `${toolName}: ${args.toolSummary ?? toolAction ?? ''}` ``(截斷)
  - `status`: `{ 2: 'running', 3: 'done' }[step.status] ?? 'done'`
  - `reason`: `args.toolAction`(若有)——直接內嵌,**不經 assembler 批次配對**
  - 若有結果文字 → 追加 `{ kind: 'log', entry: { nodeId, text, level } }`
- 其他 / 無法辨識 → 空陣列(debug log 記 `step_type`,不默默吞掉)

> 因為 reason 內嵌在 node 上、且 Antigravity 路徑**不 emit `assistant-text`**,共用的
> `ReActAssembler` 對 `tree:node` 的 pending buffer 為空,會原樣通過、保留內嵌 reason,不衝突。

### `system` 維度(既有檔案的最小改動)

- `src/types.ts`(或 sessions 型別):`SourceSystem = 'claude' | 'antigravity'`。
- `SourceController.observe(system, file, makeSource)`:依 `system` 選 `readWorkspace`
  (Claude 用 `firstCwd`,Antigravity 用 `antigravityWorkspace`)。
- `server.ts`:
  - `GET /sessions?system=claude|antigravity` → 對應 lister(懶載入,一次一個系統)。
  - `POST /observe { system, file }` → 依 system 建對應 source
    (`makeSource = (file, emit) => new AntigravitySource(file, emit)`)。
- 前端 `wireTypes.ts`:`SessionInfo` 加 `system` 欄位。

### 前端(先選系統再選 session)

- `SourcePicker.tsx` 下拉第一層:`＋ 新 Agent(操控)` / `觀察 Claude session ▸` / `觀察 Antigravity 對話 ▸`。
  選觀察類系統 → 呼叫 `loadSessions(system)`(`GET /sessions?system=`)列該系統 session,再選一筆 observe。
- `useSession.ts`:`observe(system, file)`、`loadSessions(system)`。
- `App.tsx`:唯讀行為(輸入停用、無核准框)沿用現有 `isObserving`,不因系統而異。

## 錯誤處理 / debug log(遵全域偏好)

- `decodeStep` / protobuf 走訪:varint 溢位、非 UTF-8、截斷 JSON → 安全略過並 `console.error` 帶 `step.idx`。
- 開 db 失敗、`steps` 表不存在 → `console.error` 印實際 error,source 不 crash。
- 輪詢:記錄每次新增的 step 數;`idx` 游標不回退。
- translate 遇未知 `step_type` → `console.debug`(不吞掉,方便補對映)。

## 測試(TDD)

- `tests/antigravityProto.test.ts` — 用**真實 payload 的 hex fixture**(從探針對話擷取)驗
  `decodeStep`:抽得到 `toolName='view_file'`、`args.toolAction`、JSON 參數;截斷/非文字安全處理。
- `tests/translateAntigravity.test.ts` — 已解碼 step → 事件:
  user 任務→message、tool→tree:node(+reason=toolAction, status)、invoke_subagent→subagent、type-15→空。
- `tests/antigravitySessions.test.ts` — 暫存目錄放 fixture `.db` → `listAntigravitySessions` 回身分/mtime/排序。
- `tests/antigravitySource.test.ts` — fixture `.db` → `start()` emit 事件、游標前進、`stop()` 收尾。
- `tests/server.test.ts` — `GET /sessions?system=antigravity`、`POST /observe { system:'antigravity', file }`。
- 前端 `SourcePicker` / `App` 測試 — 系統兩層選單、選 Antigravity 後 observe 進唯讀。

## 明確排除(YAGNI)

- 跨 db 的 subagent 連樹(orchestrator ↔ explorer/reviewer)。
- type-15 明文思考的批次理由顯示。
- Antigravity 的操控 / 介入(無 SDK 途徑)。
- `.proto` schema 還原(泛型萃取已 8–10 成堪用;需要更穩時再做)。
- Codex(此機未安裝,無法驗證)。

## 相依 / 約束

- Node 內建 `node:sqlite`(實測 Node v24;需 `--experimental-sqlite` 或已預設可用)。**不新增依賴**。
- 逐字稿唯讀:開 db 一律 `readOnly`,絕不寫入使用者的 Antigravity 資料。
- 程式:精簡、優雅、易懂;錯誤處理不默默吞掉(印實際 error)。
```
