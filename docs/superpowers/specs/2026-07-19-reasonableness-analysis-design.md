# 合理性分析(ReAct reasonableness analysis)設計

**日期**:2026-07-19
**狀態**:設計已核准(版面 mockup 通過),待實作計畫

## 目標

在 visualizer 的 agent 彈窗(`AgentModal`)裡加一顆「分析合理性」按鈕。按下後,把**這一個 agent** 的
ReAct 軌跡(想法 → 動作 → 結果)交給**另一個 Claude**(審查角色,與被觀察/被操控的 agent 是不同
session),請它評估這條推論是否妥當,並把結果以**結構化**面板顯示在同一個彈窗內。

「輸出」不是本次重點;分析才是主軸。輸出(複製/下載)留待日後(YAGNI)。

## 使用者決策(已確認)

| 項目 | 決定 |
|---|---|
| 核心 | LLM 分析為主(不是純輸出) |
| 分析模型 | Claude,沿用現有 Agent SDK(免 API key) |
| 粒度 | 單一 agent(彈窗內一顆按鈕) |
| 結果形式 | 結構化:總體判定 + 總評 + 指摘清單 |
| 輸出語言 | 繁體中文 |
| 永久儲存 | 不做;session 內以 agent key 快取於前端 |
| 模式 | control / observe 兩種彈窗都能分析 |
| 串流 | 不做逐字串流(執行 → 轉圈 → 顯示結果) |
| 分數(0–100) | 不做;只用徽章 + 指摘數量 |

## 架構:獨立無狀態端點 `POST /analyze`

分析是「觀察對象狀態」之外的**衍生層**,不進 `SnapshotStore`、不走 WS event/seq 管線,也不經過
`SessionManager`。因此**不會干擾正在跑的 agent**。

```
彈窗「分析合理性」按鈕
  → 前端:buildAnalysisTrace(entry, outputByNode)   純函式,組出可讀 trace
  → POST /analyze { trace }                         無狀態
  → 後端:buildAnalysisPrompt(trace)                 純函式 → prompt 字串
         → runAnalysis:Claude Agent SDK 一次性 query(審查 system,無工具)
         → parseVerdict(text)                        純函式:抽 JSON + 驗證/夾限
  → 回傳 AnalysisResult { verdict, summary, findings[] }
  → 前端:彈窗內顯示結果面板 + 以 agent key 快取(loading / done / error)
```

選這個而非「併入 WS 事件流」:`SnapshotStore` 是觀察對象的**真實狀態**所在,把「對它的分析」混進去
會讓職責變糊;獨立端點能不汙染 single-source-of-truth,且核心邏輯收斂成兩個純函式,好測。

## 資料型別(前後端共用,放 `web/src/wireTypes.ts` 對應後端 `src/types.ts`)

```ts
// 送出:一個 agent 的可讀 ReAct 軌跡
interface AnalysisStep {
  index: number      // 1-based,對應彈窗顯示的步序,供指摘回指
  label: string      // 工具標籤,如 "Write: src/auth.ts"
  kind: string       // TOOL / SKILL / MCP / SUB
  status: string     // done / error / running …
  reason?: string    // 該步的想法(thought)
  output?: string    // 結果摘要(截斷至 ~500 字,避免 prompt 爆量)
}
interface AnalysisTrace {
  title: string
  kind: 'main' | 'sub'
  steps: AnalysisStep[]
}

// 回傳:結構化判定
type Verdict = 'ok' | 'warn' | 'bad'        // 妥當 / 有疑慮 / 有問題
type Severity = 'high' | 'med' | 'low'
interface Finding {
  severity: Severity
  step: number        // 對應 AnalysisStep.index;0 表示「整體性」不指向單一步
  action?: string     // 該步動作標籤(顯示用,回填自 trace)
  issue: string       // 問題描述
  suggestion: string  // 建議
}
interface AnalysisResult {
  verdict: Verdict
  summary: string     // 繁中散文總評
  findings: Finding[] // 可為空(= 沒發現問題)
}
```

## 後端元件

### `src/analyze.ts`(核心,純函式 + 可注入 query)

- `buildAnalysisPrompt(trace: AnalysisTrace): string`
  - 組出審查用 prompt:說明角色(資深工程師審查另一個 agent 的工作)、評估面向、**要求只回 JSON**
    且 schema 固定(verdict/summary/findings)、語言繁中。
  - 把 steps 逐條編號列出(index / kind / label / 想法 / 結果摘要)。
- `parseVerdict(text: string): AnalysisResult`
  - 容錯抽 JSON:去除 ```json fence、找第一個 `{`…最後一個 `}`。
  - 驗證並**夾限**:verdict 不在列舉→`warn`;severity 不在列舉→`low`;step 非數字→`0`;
    缺 summary→給預設字串;findings 非陣列→`[]`。
  - 解析失敗**不丟例外**,回一個帶說明的 `AnalysisResult`(verdict `warn`,summary 說明無法解析),
    讓 UI 能優雅顯示。此路徑印出實際錯誤與原始文字(debug log)。
- `runAnalysis(trace, queryImpl): Promise<AnalysisResult>`
  - `queryImpl` 預設用 SDK 的一次性 query(見下),測試時注入假的以免真的呼叫。
  - 流程:`buildAnalysisPrompt` → 呼叫 query 收集 assistant 純文字 → `parseVerdict`。
  - try/catch 包住 query:失敗印出實際 error,回 `warn` + 錯誤說明的 AnalysisResult。

### `src/analyzeQuery.ts`(SDK 一次性 query 包裝,與 `agentAdapter` 平行)

- `realAnalyzeQuery(prompt: string): Promise<string>`
  - 用 `@anthropic-ai/claude-agent-sdk` 的 `query({ prompt, options })`,options 設:
    **不給工具**(審查只需讀文字推理)、自帶 `AbortController`、可設 `maxTurns: 1`。
  - 迭代結果,串接 assistant 文字 block 後回傳。
  - 抽成獨立檔以便 `runAnalysis` 注入;本檔不寫單元測試(直接碰 SDK),邏輯都在 `analyze.ts`。

### `src/server.ts`(新增路由)

- `POST /analyze`
  - 驗證 body 有 `trace`(缺 → 400,印 log)。
  - `const result = await runAnalysis(trace)`;`res.json(result)`。
  - try/catch:失敗印實際 error,回 500 + 錯誤訊息。
  - 與現有 `/observe`、`/control` 同樣風格(POST + JSON)。

## 前端元件

### `web/src/buildAgentBlocks.ts`(新增純函式)

- `buildAnalysisTrace(entry: AgentEntry, outputByNode: Record<string,string>): AnalysisTrace`
  - 把 `entry.items`(TreeNode[])轉成編號 `AnalysisStep[]`:index 從 1、label、kind(沿用彈窗
    `itemKind` 的分類)、status、reason、output(截斷)。

### `web/src/useSession.ts`(沿用既有 hook,與 observe/control 等 fetch 指令同處)

- `analyze(trace): Promise<AnalysisResult>` — `POST /analyze`,回 JSON;錯誤時回 `warn` result。
- 前端**快取與狀態**放 `App`:`Record<agentKey, AnalysisState>`,
  `AnalysisState = { status:'loading'|'done'|'error'; result?; error? }`。
  彈窗切 agent 時用 `entry.key` 取對應狀態;重新分析覆寫。

### `web/src/components/AgentModal.tsx`(UI,依 mockup)

- **動作列**(header 下、subagent chip 區同層):
  - 未分析:`⚖ 分析合理性` 按鈕 + 一行說明。
  - 分析中:spinner + 「分析中…」。
  - 已完成:徽章(妥當/有疑慮/有問題)+「N 個指摘 · 高/中/低」+「重新分析」。
- **結果面板**(`am-body` 最上方,工作項目之上):
  - 標題列「合理性分析 · Claude 審查」。
  - **總評**散文。
  - **指摘清單**:每張卡左側嚴重度色條(高=error 紅/中=awaiting 黃/低=running 藍),
    上排「嚴重度標籤 + 步驟N + 動作」,問題描述,綠勾建議。
  - 「步驟 N」可點:捲到 + 短暫高亮下方對應工作項目(以 index 對映;0 不可點)。
- 需要的 props:`analysis?: AnalysisState`、`onAnalyze: (trace) => void`;彈窗自己用
  `buildAnalysisTrace(cur, outputByNode)` 組 trace 後呼叫 `onAnalyze`。

### `web/src/tokens.css`

- 新增 mockup 用到的 class:`.am-analyze / .analyze-btn / .analyze-hint / .reanalyze /
  .analyze-loading / .spin / .verdict / .vbadge(.ok/.warn/.bad) / .vcount / .analysis /
  .analysis-head / .summary / .findings / .finding(.high/.med/.low) / .f-top / .sev / .f-step /
  .f-action / .f-issue / .f-fix`,以及工作項目高亮 `.wstep.flag / flash`。全部沿用既有 tokens,
  明暗兩色。語意色(good/warn/bad)沿用 `--st-done/--st-awaiting/--st-error`,與 accent 分離。

## 錯誤處理

- **後端**:body 缺 trace → 400;query 失敗 / JSON 解析失敗 → 回 `warn` result 或 500,
  一律印出實際 error(遵全域偏好:不默默吞錯)。
- **前端**:fetch 失敗 → `error` 狀態,面板顯示「分析失敗:<訊息>」+「重試」。
- **空 trace**(agent 還沒有工作項目):按鈕停用或分析回「沒有可分析的步驟」。

## 測試

- **後端(vitest, node)**:
  - `buildAnalysisPrompt`:含各步編號、含固定 JSON schema 指示、含繁中要求。
  - `parseVerdict`:正常 JSON;帶 ```json fence;夾限非法 verdict/severity/step;完全無法解析→
    `warn` fallback;findings 缺欄位補齊。
  - `runAnalysis`:注入假 queryImpl(回固定 JSON 字串)→ 得對應 AnalysisResult;query 丟例外→
    `warn` fallback(且不拋出)。
- **前端(vitest + jsdom)**:
  - `buildAnalysisTrace`:items → 編號 steps,output 截斷,kind 分類正確。
  - `AgentModal`:未分析顯示按鈕;按下呼叫 `onAnalyze` 帶正確 trace;`loading` 顯示 spinner;
    `done` 顯示徽章 + 指摘卡(數量/嚴重度/步驟);點「步驟 N」高亮對應工作項目;空 trace 停用。
  - `App` 整合:點按鈕 → `POST /analyze` 帶 trace(假 fetch);回傳後面板出現。

## 不做(YAGNI)

- 複製 / 下載 trace 或分析結果。
- 逐字串流。
- 分數(0–100)。
- 換別家 LLM(GPT/Gemini);目前只用 Claude,但型別與端點不綁特定 provider,日後要換再說。
- 整個 session(主 + 全 subagent)一次分析;先做單 agent。
- 分析結果落地儲存 / 跨 session 保留。
