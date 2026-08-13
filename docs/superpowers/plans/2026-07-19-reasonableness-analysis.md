# 合理性分析(ReAct reasonableness analysis)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 agent 彈窗加一顆「分析合理性」按鈕,把該 agent 的 ReAct 軌跡交給另一個 Claude 審查,並以結構化面板顯示總體判定 + 總評 + 指摘清單。

**Architecture:** 獨立無狀態 `POST /analyze` 端點,不進 SnapshotStore、不走 WS event/seq、不經 SessionManager,故不干擾正在跑的 agent。後端核心是兩個純函式(`buildAnalysisPrompt`、`parseVerdict`)加一個可注入 query 的 `runAnalysis`;SDK 一次性 query 抽到獨立檔以便測試注入假物件。前端純函式 `buildAnalysisTrace` 組軌跡,`useSession.analyze` 打端點,`App` 以 agent key 快取狀態,`AgentModal` 依已核准 mockup 呈現。

**Tech Stack:** TypeScript、Express、`@anthropic-ai/claude-agent-sdk`(沿用登入的 Claude CLI 憑證,免 API key)、React + Vite、vitest(後端 node env / 前端 jsdom env)。

## Global Constraints

- 程式碼精簡、優雅、易懂;易懂為最高原則(來自 CLAUDE.md)。
- 在易出錯處主動加 debug log:外部輸入 / API 回應 / try-catch 的實際 error(JS 用 `console`);不可默默吞錯。
- 分析輸出語言:**繁體中文**。
- 不做:複製/下載、逐字串流、分數(0–100)、換別家 LLM、整 session 一次分析、落地儲存。
- git commit 訊息結尾必附:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 型別列舉固定:`Verdict = 'ok' | 'warn' | 'bad'`、`Severity = 'high' | 'med' | 'low'`、`AnalysisTrace.kind = 'main' | 'sub'`。
- 後端測試放 `tests/`,前端測試放 `web/tests/`;既有慣例:route 不用 supertest,只測純邏輯,HTTP 層由 E2E/瀏覽器驗。

## File Structure

- `src/types.ts`(修改)— 新增 `AnalysisStep / AnalysisTrace / Verdict / Severity / Finding / AnalysisResult`。
- `src/analyze.ts`(新建)— `buildAnalysisPrompt`、`parseVerdict`、`runAnalysis`、型別 `AnalyzeQuery`。核心邏輯,純函式為主。
- `src/analyzeQuery.ts`(新建)— `realAnalyzeQuery(prompt)`:SDK 一次性 query(無工具),不寫單元測試。
- `src/server.ts`(修改)— 新增 `POST /analyze`,呼叫 `runAnalysis(trace, realAnalyzeQuery)`。
- `web/src/wireTypes.ts`(修改)— 鏡射後端分析型別,另加前端 UI 狀態 `AnalysisState`。
- `web/src/buildAgentBlocks.ts`(修改)— 新增純函式 `buildAnalysisTrace(entry, outputByNode)`。
- `web/src/useSession.ts`(修改)— 新增 `analyze(trace)`。
- `web/src/components/AgentModal.tsx`(修改)— 動作列 + 結果面板 + 步驟高亮;新增 props `analysisByKey`、`onAnalyze`。
- `web/src/App.tsx`(修改)— 快取 `analyses` 狀態 + `onAnalyze` handler + 傳入彈窗。
- `web/src/tokens.css`(修改)— 新增分析相關 class(明暗兩色,語意色沿用 `--st-*`)。
- 測試:`tests/analyze.test.ts`(新建)、`web/tests/buildAnalysisTrace.test.ts`(新建)、`web/tests/useSession.analyze.test.ts`(新建,或併入既有)、`web/tests/AgentModal.test.tsx`(新建)、`web/tests/App.test.tsx`(修改,加整合案例)。
- 文件:`README.md`、`README.zh-TW.md`、`NOTES.md`(修改)。

---

### Task 1: 後端型別 + `buildAnalysisPrompt`

**Files:**
- Modify: `src/types.ts`(檔尾新增分析型別)
- Create: `src/analyze.ts`
- Test: `tests/analyze.test.ts`

**Interfaces:**
- Produces:
  - `interface AnalysisStep { index: number; label: string; kind: string; status: string; reason?: string; output?: string }`
  - `interface AnalysisTrace { title: string; kind: 'main' | 'sub'; steps: AnalysisStep[] }`
  - `type Verdict = 'ok' | 'warn' | 'bad'`;`type Severity = 'high' | 'med' | 'low'`
  - `interface Finding { severity: Severity; step: number; issue: string; suggestion: string }`
  - `interface AnalysisResult { verdict: Verdict; summary: string; findings: Finding[] }`
  - `function buildAnalysisPrompt(trace: AnalysisTrace): string`

- [ ] **Step 1: 在 `src/types.ts` 檔尾新增型別**

```ts
// ── 合理性分析(POST /analyze):把一個 agent 的 ReAct 軌跡交給另一個 Claude 審查 ──
export interface AnalysisStep {
  index: number      // 1-based,對應彈窗步序,供指摘回指
  label: string
  kind: string       // TOOL / SKILL / MCP / SUB
  status: string
  reason?: string
  output?: string
}
export interface AnalysisTrace {
  title: string
  kind: 'main' | 'sub'
  steps: AnalysisStep[]
}
export type Verdict = 'ok' | 'warn' | 'bad'   // 妥當 / 有疑慮 / 有問題
export type Severity = 'high' | 'med' | 'low'
export interface Finding {
  severity: Severity
  step: number       // 對應 AnalysisStep.index;0 = 整體性問題,不指向單一步
  issue: string
  suggestion: string
}
export interface AnalysisResult {
  verdict: Verdict
  summary: string
  findings: Finding[]
}
```

- [ ] **Step 2: 寫失敗測試 `tests/analyze.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildAnalysisPrompt } from '../src/analyze'
import type { AnalysisTrace } from '../src/types'

const trace: AnalysisTrace = {
  title: '重構登入流程',
  kind: 'main',
  steps: [
    { index: 1, label: 'Grep: password', kind: 'TOOL', status: 'done', reason: '先找雜湊在哪' },
    { index: 2, label: 'Write: src/auth.ts', kind: 'TOOL', status: 'done', output: 'wrote 20 lines' },
  ],
}

describe('buildAnalysisPrompt', () => {
  it('逐步編號、帶入任務標題與想法/結果', () => {
    const p = buildAnalysisPrompt(trace)
    expect(p).toContain('重構登入流程')
    expect(p).toContain('步驟 1')
    expect(p).toContain('先找雜湊在哪')
    expect(p).toContain('步驟 2')
    expect(p).toContain('wrote 20 lines')
  })
  it('要求只回固定 schema 的 JSON、且用繁體中文', () => {
    const p = buildAnalysisPrompt(trace)
    expect(p).toContain('verdict')
    expect(p).toContain('findings')
    expect(p).toContain('繁體中文')
  })
})
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npx vitest run tests/analyze.test.ts`
Expected: FAIL —「buildAnalysisPrompt is not a function / Cannot find module '../src/analyze'」。

- [ ] **Step 4: 建 `src/analyze.ts` 實作 `buildAnalysisPrompt`**

```ts
import type { AnalysisTrace } from './types'

// 把一個 agent 的 ReAct 軌跡組成給「審查用 Claude」的 prompt。
// 要求:只回 JSON、schema 固定、語言繁中。
export function buildAnalysisPrompt(trace: AnalysisTrace): string {
  const lines = trace.steps.map((s) => {
    const parts = [`步驟 ${s.index} [${s.kind}] ${s.label}(${s.status})`]
    if (s.reason) parts.push(`  想法:${s.reason}`)
    if (s.output) parts.push(`  結果:${s.output}`)
    return parts.join('\n')
  })
  return [
    '你是一位資深工程師,正在審查「另一個 AI agent」完成任務的過程是否合理。',
    `這個 agent 的任務:${trace.title}`,
    '',
    '以下是它的 ReAct 軌跡(想法 → 動作 → 結果),已編號:',
    lines.join('\n'),
    '',
    '請評估整體推論是否妥當:方向對不對、有無多餘/危險/遺漏的步驟、有無更好做法。',
    '只輸出一個 JSON 物件(不要有其他文字,不要 markdown code fence),schema:',
    '{',
    '  "verdict": "ok" | "warn" | "bad",   // 妥當 / 有疑慮 / 有問題',
    '  "summary": "繁體中文總評,2-4 句",',
    '  "findings": [',
    '    { "severity": "high" | "med" | "low", "step": <步驟編號,整體性問題填 0>,',
    '      "issue": "問題是什麼", "suggestion": "建議怎麼改" }',
    '  ]   // 沒問題就給空陣列',
    '}',
    '所有文字用繁體中文。',
  ].join('\n')
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run tests/analyze.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/analyze.ts tests/analyze.test.ts
git commit -m "feat: 分析型別 + buildAnalysisPrompt(審查用 prompt)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `parseVerdict`(容錯抽 JSON + 驗證夾限)

**Files:**
- Modify: `src/analyze.ts`
- Test: `tests/analyze.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult / Verdict / Severity / Finding`(Task 1)
- Produces: `function parseVerdict(text: string): AnalysisResult`

- [ ] **Step 1: 追加失敗測試到 `tests/analyze.test.ts`**

```ts
import { parseVerdict } from '../src/analyze'

describe('parseVerdict', () => {
  it('正常 JSON → 對應結果', () => {
    const r = parseVerdict('{"verdict":"warn","summary":"還行","findings":[{"severity":"high","step":2,"issue":"覆寫風險","suggestion":"先讀檔"}]}')
    expect(r.verdict).toBe('warn')
    expect(r.summary).toBe('還行')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ severity: 'high', step: 2, issue: '覆寫風險', suggestion: '先讀檔' })
  })
  it('容忍 ```json fence 與前後雜訊', () => {
    const r = parseVerdict('這是我的判斷:\n```json\n{"verdict":"ok","summary":"沒問題","findings":[]}\n```\n以上')
    expect(r.verdict).toBe('ok')
    expect(r.findings).toEqual([])
  })
  it('非法 verdict/severity 夾限、step 非數字歸 0', () => {
    const r = parseVerdict('{"verdict":"great","summary":"x","findings":[{"severity":"critical","step":"abc","issue":"i","suggestion":"s"}]}')
    expect(r.verdict).toBe('warn')                 // 非列舉 → warn
    expect(r.findings[0].severity).toBe('low')     // 非列舉 → low
    expect(r.findings[0].step).toBe(0)             // 非數字 → 0
  })
  it('完全抽不出 JSON → warn fallback、findings 空', () => {
    const r = parseVerdict('抱歉我無法分析')
    expect(r.verdict).toBe('warn')
    expect(r.findings).toEqual([])
  })
  it('findings 缺欄位 → 補齊為空字串', () => {
    const r = parseVerdict('{"verdict":"bad","summary":"s","findings":[{"severity":"med","step":1}]}')
    expect(r.findings[0].issue).toBe('')
    expect(r.findings[0].suggestion).toBe('')
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run tests/analyze.test.ts`
Expected: FAIL —「parseVerdict is not a function」。

- [ ] **Step 3: 在 `src/analyze.ts` 追加實作**

```ts
import type { AnalysisResult, Verdict, Severity, Finding } from './types'

const VERDICTS: Verdict[] = ['ok', 'warn', 'bad']
const SEVERITIES: Severity[] = ['high', 'med', 'low']

// 從模型回覆抽出 JSON 並驗證/夾限成 AnalysisResult。
// 解析不出來不丟例外,回一個 warn 的說明結果,讓 UI 能優雅顯示。
export function parseVerdict(text: string): AnalysisResult {
  const json = extractJson(text)
  if (!json) {
    console.error('[analyze] 無法從回覆抽出 JSON,原始文字前 500:', text.slice(0, 500))
    return { verdict: 'warn', summary: '分析回覆無法解析為 JSON,請重新分析。', findings: [] }
  }
  let raw: any
  try {
    raw = JSON.parse(json)
  } catch (err) {
    console.error('[analyze] JSON.parse 失敗:', err, '片段:', json.slice(0, 500))
    return { verdict: 'warn', summary: '分析回覆 JSON 格式錯誤,請重新分析。', findings: [] }
  }
  const verdict: Verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'warn'
  const summary = typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary : '(模型未提供總評)'
  const findings: Finding[] = Array.isArray(raw?.findings) ? raw.findings.map(normalizeFinding) : []
  return { verdict, summary, findings }
}

function normalizeFinding(f: any): Finding {
  return {
    severity: SEVERITIES.includes(f?.severity) ? f.severity : 'low',
    step: Number.isFinite(f?.step) ? Number(f.step) : 0,
    issue: typeof f?.issue === 'string' ? f.issue : '',
    suggestion: typeof f?.suggestion === 'string' ? f.suggestion : '',
  }
}

// 抽第一個 { 到最後一個 } 之間的字串(容忍 ```json fence 與前後雜訊)。
function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run tests/analyze.test.ts`
Expected: PASS(全部 analyze 測試通過)。

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts tests/analyze.test.ts
git commit -m "feat: parseVerdict 容錯抽 JSON + 驗證夾限

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `runAnalysis`(組 prompt → query → 解析,含錯誤 fallback)

**Files:**
- Modify: `src/analyze.ts`
- Test: `tests/analyze.test.ts`

**Interfaces:**
- Consumes: `buildAnalysisPrompt`、`parseVerdict`(同檔);`AnalysisTrace / AnalysisResult`
- Produces:
  - `type AnalyzeQuery = (prompt: string) => Promise<string>`
  - `function runAnalysis(trace: AnalysisTrace, queryImpl: AnalyzeQuery): Promise<AnalysisResult>`

- [ ] **Step 1: 追加失敗測試**

```ts
import { runAnalysis } from '../src/analyze'

describe('runAnalysis', () => {
  it('注入回 JSON 的假 query → 得對應結果', async () => {
    const fake = async () => '{"verdict":"ok","summary":"good","findings":[]}'
    const r = await runAnalysis(trace, fake)
    expect(r.verdict).toBe('ok')
    expect(r.summary).toBe('good')
  })
  it('query 丟例外 → warn fallback,且不拋出', async () => {
    const boom = async () => { throw new Error('SDK 掛了') }
    const r = await runAnalysis(trace, boom)
    expect(r.verdict).toBe('warn')
    expect(r.summary).toContain('SDK 掛了')
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run tests/analyze.test.ts`
Expected: FAIL —「runAnalysis is not a function」。

- [ ] **Step 3: 在 `src/analyze.ts` 追加實作**

```ts
import type { AnalysisTrace } from './types'

export type AnalyzeQuery = (prompt: string) => Promise<string>

// 組 prompt → 呼叫審查 query → 解析;任何失敗都回 warn fallback(不拋出)。
export async function runAnalysis(trace: AnalysisTrace, queryImpl: AnalyzeQuery): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(trace)
  try {
    const text = await queryImpl(prompt)
    console.log('[analyze] 收到審查回覆,長度', text.length)
    return parseVerdict(text)
  } catch (err) {
    console.error('[analyze] 審查 query 失敗:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return { verdict: 'warn', summary: `分析失敗:${msg}`, findings: [] }
  }
}
```

> 註:`AnalysisResult` / `buildAnalysisPrompt` / `parseVerdict` 已在同檔,勿重複 import 型別造成重複宣告。

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run tests/analyze.test.ts`
Expected: PASS。

- [ ] **Step 5: 全後端測試回歸**

Run: `npx vitest run`
Expected: PASS(既有 66 + 新增,全綠)。

- [ ] **Step 6: Commit**

```bash
git add src/analyze.ts tests/analyze.test.ts
git commit -m "feat: runAnalysis(可注入 query,失敗回 warn fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: SDK 一次性 query 包裝 + `POST /analyze` 路由

**Files:**
- Create: `src/analyzeQuery.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `runAnalysis`(Task 3);`resolveWorkspace`(`src/agentAdapter.ts`,現有)
- Produces: `function realAnalyzeQuery(prompt: string): Promise<string>`;HTTP `POST /analyze { trace } → AnalysisResult`

> 此 Task 直接碰 SDK 與 HTTP 層,依既有慣例不寫單元測試,於 Task 9 用瀏覽器 E2E 驗。仍需 `npx tsc --noEmit` 通過。

- [ ] **Step 1: 建 `src/analyzeQuery.ts`**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import { resolveWorkspace } from './agentAdapter'

// 一次性審查 query:不給工具(審查只需讀文字推理),串接 assistant 純文字後回傳。
// 與被觀察/被操控的 agent 是不同 session,故不會互相干擾。
export async function realAnalyzeQuery(prompt: string): Promise<string> {
  const abortController = new AbortController()
  const options: any = {
    cwd: resolveWorkspace(),
    abortController,
    maxTurns: 1,
    allowedTools: [], // 審查不需要動工具
  }
  console.log('[analyzeQuery] 送出審查 prompt,長度', prompt.length)
  let out = ''
  for await (const msg of query({ prompt, options }) as AsyncIterable<any>) {
    if (msg?.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block?.type === 'text') out += block.text
      }
    }
  }
  console.log('[analyzeQuery] 審查回覆完成,長度', out.length)
  return out
}
```

- [ ] **Step 2: 在 `src/server.ts` 加 import**

在檔案頂部 import 區(靠近 `import { realRunQuery, resolveWorkspace } from './agentAdapter'`)新增:

```ts
import { runAnalysis } from './analyze'
import { realAnalyzeQuery } from './analyzeQuery'
```

- [ ] **Step 3: 在 `src/server.ts` 加路由**

在 `app.post('/control', ...)` 區塊之後、`const server = app.listen(...)` 之前插入:

```ts
  // 合理性分析:把某個 agent 的 ReAct 軌跡交給另一個 Claude 審查(無狀態,不進 store/WS/SessionManager)。
  app.post('/analyze', async (req, res) => {
    const trace = req.body?.trace
    if (!trace || !Array.isArray(trace.steps)) {
      console.error('[server] /analyze 缺少 trace 或 steps')
      return res.status(400).json({ error: 'missing trace' })
    }
    console.log('[server] /analyze', trace.title, trace.steps.length, '步')
    try {
      const result = await runAnalysis(trace, realAnalyzeQuery)
      res.json(result)
    } catch (err) {
      console.error('[server] /analyze 失敗:', err)
      res.status(500).json({ error: String(err) })
    }
  })
```

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: 後端測試回歸**

Run: `npx vitest run`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/analyzeQuery.ts src/server.ts
git commit -m "feat: realAnalyzeQuery(SDK 一次性審查)+ POST /analyze 路由

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 前端型別 + `buildAnalysisTrace`

**Files:**
- Modify: `web/src/wireTypes.ts`
- Modify: `web/src/buildAgentBlocks.ts`
- Test: `web/tests/buildAnalysisTrace.test.ts`

**Interfaces:**
- Consumes: `AgentEntry`(`web/src/buildAgentBlocks.ts`,現有);`TreeNode`
- Produces:
  - 型別(鏡射後端):`AnalysisStep / AnalysisTrace / Verdict / Severity / Finding / AnalysisResult`
  - UI 狀態:`interface AnalysisState { status: 'loading' | 'done' | 'error'; result?: AnalysisResult }`
  - `function buildAnalysisTrace(entry: AgentEntry, outputByNode: Record<string, string>): AnalysisTrace`

- [ ] **Step 1: 在 `web/src/wireTypes.ts` 檔尾新增型別**

```ts
// ── 合理性分析(POST /analyze):鏡射後端 src/types.ts ──
export interface AnalysisStep {
  index: number
  label: string
  kind: string       // TOOL / SKILL / MCP / SUB
  status: string
  reason?: string
  output?: string
}
export interface AnalysisTrace {
  title: string
  kind: 'main' | 'sub'
  steps: AnalysisStep[]
}
export type Verdict = 'ok' | 'warn' | 'bad'
export type Severity = 'high' | 'med' | 'low'
export interface Finding {
  severity: Severity
  step: number
  issue: string
  suggestion: string
}
export interface AnalysisResult {
  verdict: Verdict
  summary: string
  findings: Finding[]
}
// 前端 UI 狀態(每個 agent key 一份;放這裡供 App 與 AgentModal 共用,避免循環 import)。
export interface AnalysisState {
  status: 'loading' | 'done' | 'error'
  result?: AnalysisResult
}
```

- [ ] **Step 2: 寫失敗測試 `web/tests/buildAnalysisTrace.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildAnalysisTrace } from '../src/buildAgentBlocks'
import type { AgentEntry } from '../src/buildAgentBlocks'

const entry: AgentEntry = {
  key: 'main', title: '做計算機', kind: 'main', status: 'done', steps: 3, items: [
    { id: 'a', parentId: null, type: 'tool', label: 'Grep: x', status: 'done', reason: '先找' },
    { id: 'mcp__db__query', parentId: null, type: 'tool', label: 'mcp__db__query', status: 'done' },
    { id: 'c', parentId: null, type: 'skill', label: 'brainstorming', status: 'done' },
  ], subKeys: [],
}

describe('buildAnalysisTrace', () => {
  it('items → 編號 steps,帶入 title/kind', () => {
    const t = buildAnalysisTrace(entry, {})
    expect(t.title).toBe('做計算機')
    expect(t.kind).toBe('main')
    expect(t.steps.map((s) => s.index)).toEqual([1, 2, 3])
    expect(t.steps[0].reason).toBe('先找')
  })
  it('kind 分類:mcp__ → MCP、skill → SKILL、其餘 → TOOL', () => {
    const t = buildAnalysisTrace(entry, {})
    expect(t.steps[0].kind).toBe('TOOL')
    expect(t.steps[1].kind).toBe('MCP')
    expect(t.steps[2].kind).toBe('SKILL')
  })
  it('output 截斷至 500 字', () => {
    const long = 'x'.repeat(900)
    const t = buildAnalysisTrace(entry, { a: long })
    expect(t.steps[0].output).toHaveLength(500)
  })
})
```

- [ ] **Step 3: 執行確認失敗**

Run: `cd web && npx vitest run tests/buildAnalysisTrace.test.ts`
Expected: FAIL —「buildAnalysisTrace is not a function」。

- [ ] **Step 4: 在 `web/src/buildAgentBlocks.ts` 追加實作**

檔頂 import 補上型別:

```ts
import type { AnalysisTrace, AnalysisStep } from './wireTypes'
```

檔尾新增:

```ts
// 工具分類:與 AgentModal 的 itemKind 對齊(顯示用標籤)。
function stepKind(node: TreeNode): string {
  if (node.type === 'skill') return 'SKILL'
  if (node.type === 'subagent') return 'SUB'
  if (/^mcp__/.test(node.label) || /^mcp__/.test(node.id)) return 'MCP'
  return 'TOOL'
}

const OUTPUT_MAX = 500

// 把一個 agent 的工作項目攤成可讀、已編號的 ReAct 軌跡,供 POST /analyze。
export function buildAnalysisTrace(entry: AgentEntry, outputByNode: Record<string, string>): AnalysisTrace {
  const steps: AnalysisStep[] = entry.items.map((n, i) => {
    const out = outputByNode[n.id]
    return {
      index: i + 1,
      label: n.label,
      kind: stepKind(n),
      status: n.status,
      ...(n.reason ? { reason: n.reason } : {}),
      ...(out ? { output: out.slice(0, OUTPUT_MAX) } : {}),
    }
  })
  return { title: entry.title, kind: entry.kind, steps }
}
```

- [ ] **Step 5: 執行確認通過**

Run: `cd web && npx vitest run tests/buildAnalysisTrace.test.ts`
Expected: PASS(3 passed)。

- [ ] **Step 6: Commit**

```bash
git add web/src/wireTypes.ts web/src/buildAgentBlocks.ts web/tests/buildAnalysisTrace.test.ts
git commit -m "feat: 前端分析型別 + buildAnalysisTrace(items → 編號軌跡)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `useSession.analyze`

**Files:**
- Modify: `web/src/useSession.ts`
- Test: `web/tests/useSession.analyze.test.ts`

**Interfaces:**
- Consumes: `AnalysisTrace / AnalysisResult`(Task 5)
- Produces: `analyze(trace: AnalysisTrace): Promise<AnalysisResult>`(掛在 `useSession` 回傳物件)

- [ ] **Step 1: 寫失敗測試 `web/tests/useSession.analyze.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../src/useSession'

class FakeWS {
  onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onclose: (() => void) | null = null
  readyState = 1; static OPEN = 1
  constructor(public url: string) {}
  send() {} close() {}
}

describe('useSession.analyze', () => {
  it('POST /analyze 帶 { trace },回傳解析後的 AnalysisResult', async () => {
    const result = { verdict: 'warn', summary: 's', findings: [] }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(result) })
    const { result: hook } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      fetchImpl: fetchImpl as unknown as typeof fetch, wsUrl: 'ws://x',
    }))
    const trace = { title: 't', kind: 'main' as const, steps: [] }
    let got: any
    await act(async () => { got = await hook.current.analyze(trace) })
    expect(got).toEqual(result)
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/analyze')
    expect(call).toBeTruthy()
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ trace })
  })

  it('fetch 失敗 → warn fallback,不拋出', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('網路掛了'))
    const { result: hook } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      fetchImpl: fetchImpl as unknown as typeof fetch, wsUrl: 'ws://x',
    }))
    let got: any
    await act(async () => { got = await hook.current.analyze({ title: 't', kind: 'main', steps: [] }) })
    expect(got.verdict).toBe('warn')
    expect(got.summary).toContain('網路掛了')
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `cd web && npx vitest run tests/useSession.analyze.test.ts`
Expected: FAIL —「hook.current.analyze is not a function」。

- [ ] **Step 3: 在 `web/src/useSession.ts` 實作**

檔頂 import 補型別:

```ts
import type { Packet, ControlCommand, SessionInfo, SourceSystem, AnalysisTrace, AnalysisResult } from './wireTypes'
```

在 `loadSessions` 之後、`return { ... }` 之前新增:

```ts
  // 合理性分析:POST /analyze,回傳結構化結果;失敗回 warn fallback(不拋出)。
  const analyze = useCallback(async (trace: AnalysisTrace): Promise<AnalysisResult> => {
    try {
      const res = await doFetch('/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trace }),
      })
      return await res.json()
    } catch (err) {
      console.error('[analyze] 請求失敗', err)
      return { verdict: 'warn', summary: `分析失敗:${String(err)}`, findings: [] }
    }
  }, [doFetch])
```

把 `analyze` 加入回傳物件:

```ts
  return { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions, analyze }
```

- [ ] **Step 4: 執行確認通過**

Run: `cd web && npx vitest run tests/useSession.analyze.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add web/src/useSession.ts web/tests/useSession.analyze.test.ts
git commit -m "feat: useSession.analyze(POST /analyze,失敗回 warn)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `AgentModal` 動作列 + 結果面板 + 步驟高亮 + 樣式

**Files:**
- Modify: `web/src/components/AgentModal.tsx`
- Modify: `web/src/tokens.css`
- Test: `web/tests/AgentModal.test.tsx`

**Interfaces:**
- Consumes: `AgentEntry`;`AnalysisState / AnalysisTrace / AnalysisResult / Finding / Verdict / Severity`(Task 5);`buildAnalysisTrace`(Task 5)
- Produces: `AgentModal` 新增 props `analysisByKey: Record<string, AnalysisState>`、`onAnalyze: (key: string, trace: AnalysisTrace) => void`

- [ ] **Step 1: 寫失敗測試 `web/tests/AgentModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentModal } from '../src/components/AgentModal'
import type { AgentEntry } from '../src/buildAgentBlocks'
import type { AnalysisState } from '../src/wireTypes'

const entry: AgentEntry = {
  key: 'main', title: '重構登入', kind: 'main', status: 'done', steps: 2, items: [
    { id: 'a', parentId: null, type: 'tool', label: 'Grep: password', status: 'done', reason: '找雜湊' },
    { id: 'b', parentId: null, type: 'tool', label: 'Write: auth.ts', status: 'done' },
  ], subKeys: [],
}
const base = { entries: [entry], index: 0, outputByNode: {}, onIndex: vi.fn(), onClose: vi.fn() }

describe('AgentModal 合理性分析', () => {
  it('未分析:顯示「分析合理性」按鈕;按下呼叫 onAnalyze 帶 key + trace', () => {
    const onAnalyze = vi.fn()
    render(<AgentModal {...base} analysisByKey={{}} onAnalyze={onAnalyze} />)
    fireEvent.click(screen.getByRole('button', { name: /分析合理性/ }))
    expect(onAnalyze).toHaveBeenCalledTimes(1)
    const [key, trace] = onAnalyze.mock.calls[0]
    expect(key).toBe('main')
    expect(trace.steps).toHaveLength(2)
  })

  it('loading:顯示分析中', () => {
    const st: AnalysisState = { status: 'loading' }
    render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(screen.getByText(/分析中/)).toBeInTheDocument()
  })

  it('done:顯示判定徽章 + 指摘卡(嚴重度/步驟/建議)', () => {
    const st: AnalysisState = { status: 'done', result: {
      verdict: 'warn', summary: '方向對但有缺口',
      findings: [{ severity: 'high', step: 2, issue: '覆寫風險', suggestion: '先讀檔' }],
    } }
    render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(screen.getByText('有疑慮')).toBeInTheDocument()
    expect(screen.getByText('方向對但有缺口')).toBeInTheDocument()
    expect(screen.getByText('覆寫風險')).toBeInTheDocument()
    expect(screen.getByText('先讀檔')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /步驟 2/ })).toBeInTheDocument()
  })

  it('空 items:分析按鈕停用', () => {
    const empty = { ...entry, items: [] }
    render(<AgentModal {...base} entries={[empty]} analysisByKey={{}} onAnalyze={vi.fn()} />)
    expect(screen.getByRole('button', { name: /分析合理性/ })).toBeDisabled()
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `cd web && npx vitest run tests/AgentModal.test.tsx`
Expected: FAIL —「analysisByKey / onAnalyze 型別錯誤」或找不到「分析合理性」。

- [ ] **Step 3: 改 `web/src/components/AgentModal.tsx`**

3a. 匯入與圖示。檔頂 import 區改為:

```ts
import { useEffect, useRef, useState } from 'react'
import type { AgentEntry } from '../buildAgentBlocks'
import { buildAnalysisTrace } from '../buildAgentBlocks'
import type { TreeNode, AnalysisState, AnalysisResult, Verdict, Severity } from '../wireTypes'
```

在既有 icon 群組後新增兩個小圖示與對映表:

```ts
const ScaleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6m0 0-2.2 8.5a1 1 0 0 0 1 .5h2.4a1 1 0 0 0 1-.5L13 9M5 9h14" /><circle cx="12" cy="4" r="1.4" /></svg>
)
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
)
const VERDICT_LABEL: Record<Verdict, string> = { ok: '妥當', warn: '有疑慮', bad: '有問題' }
const VERDICT_CLASS: Record<Verdict, string> = { ok: 'ok', warn: 'warn', bad: 'bad' }
const SEV_LABEL: Record<Severity, string> = { high: '高', med: '中', low: '低' }

function verdictCount(findings: { severity: Severity }[]): string {
  if (findings.length === 0) return '沒有發現問題'
  const c = { high: 0, med: 0, low: 0 }
  for (const f of findings) c[f.severity]++
  return `${findings.length} 個指摘 · ${c.high} 高 · ${c.med} 中 · ${c.low} 低`
}
```

3b. 結果面板子元件(放在 `WorkItem` 附近):

```tsx
function AnalysisPanel({ result, stepLabel, onStep }: {
  result: AnalysisResult
  stepLabel: (step: number) => string | undefined
  onStep: (step: number) => void
}) {
  return (
    <div className="analysis">
      <div className="analysis-head">
        <span className="lbl">合理性分析</span>
        <span className="by"><BoltIcon /> Claude 審查</span>
      </div>
      <div className="summary">{result.summary}</div>
      {result.findings.length > 0 && (
        <div className="findings">
          {result.findings.map((f, i) => (
            <div className={`finding ${f.severity}`} key={i}>
              <div className="f-top">
                <span className={`sev ${f.severity}`}>{SEV_LABEL[f.severity]}</span>
                {f.step > 0 && (
                  <button className="f-step" onClick={() => onStep(f.step)}>步驟 {f.step}</button>
                )}
                {f.step > 0 && stepLabel(f.step) && <span className="f-action">{stepLabel(f.step)}</span>}
              </div>
              <div className="f-issue">{f.issue}</div>
              {f.suggestion && (
                <div className="f-fix"><span className="fx-ic"><CheckIcon /></span><span>{f.suggestion}</span></div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

3c. 擴充 `Props` 與元件本體。把 `interface Props` 改為:

```ts
interface Props {
  entries: AgentEntry[]
  index: number
  outputByNode: Record<string, string>
  analysisByKey: Record<string, AnalysisState>
  onAnalyze: (key: string, trace: AnalysisTrace) => void
  onIndex: (index: number) => void
  onClose: () => void
}
```

> 記得把 `AnalysisTrace` 也加進 `../wireTypes` 的 import(3a 已含 `AnalysisState/AnalysisResult/Verdict/Severity`,補上 `AnalysisTrace`)。

在 `export function AgentModal({ ... })` 解構加入 `analysisByKey, onAnalyze`,並在 `const cur = entries[index]` 之後加入分析相關狀態與 handler:

```ts
  const analysis = analysisByKey[cur.key]
  const canAnalyze = cur.items.length > 0
  const doAnalyze = () => onAnalyze(cur.key, buildAnalysisTrace(cur, outputByNode))

  const bodyRef = useRef<HTMLDivElement>(null)
  const [flashStep, setFlashStep] = useState<number | null>(null)
  const scrollToStep = (step: number) => {
    const el = bodyRef.current?.querySelector(`[data-step="${step}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashStep(step)
    setTimeout(() => setFlashStep(null), 1400)
  }
  const stepLabel = (step: number) => cur.items[step - 1]?.label
```

3d. 動作列。在 `am-head` 的 `</div>`(header 結束)之後、`am-subs` 區塊之前插入:

```tsx
        <div className="am-analyze">
          {!analysis && (
            <>
              <button className="analyze-btn" onClick={doAnalyze} disabled={!canAnalyze}>
                <ScaleIcon /> 分析合理性
              </button>
              <span className="analyze-hint">
                {canAnalyze ? '用另一個 Claude 檢查這個 agent 的推論是否妥當' : '沒有可分析的步驟'}
              </span>
            </>
          )}
          {analysis?.status === 'loading' && (
            <span className="analyze-loading"><span className="spin" /> 分析中…</span>
          )}
          {analysis?.status === 'done' && analysis.result && (
            <div className="verdict">
              <span className={`vbadge ${VERDICT_CLASS[analysis.result.verdict]}`}>{VERDICT_LABEL[analysis.result.verdict]}</span>
              <span className="vcount">{verdictCount(analysis.result.findings)}</span>
              <button className="reanalyze" onClick={doAnalyze}>重新分析</button>
            </div>
          )}
        </div>
```

3e. 結果面板 + 工作項目步序。把 `am-body` 那段 `<div className="am-body">…</div>` 改為(加 `ref`、面板、`data-step`、`flash`):

```tsx
        <div className="am-body" ref={bodyRef}>
          {analysis?.status === 'done' && analysis.result && (
            <AnalysisPanel result={analysis.result} stepLabel={stepLabel} onStep={scrollToStep} />
          )}
          {cur.items.length > 0
            ? (
              <>
                <div className="lbl">工作項目 · 想法 → 動作 → 結果</div>
                <div className="work">
                  {cur.items.map((n, i) => (
                    <div className={`wstep${flashStep === i + 1 ? ' flash' : ''}`} data-step={i + 1} key={n.id}>
                      {n.reason && <ReasonLine text={n.reason} />}
                      <WorkItem node={n} output={outputByNode[n.id]} />
                    </div>
                  ))}
                </div>
              </>
            )
            : <div className="am-empty">這個 agent 還沒有工作項目。</div>}
        </div>
```

- [ ] **Step 4: 在 `web/src/tokens.css` 檔尾新增樣式**

```css
/* ── 合理性分析:動作列 + 結果面板(語意色沿用 --st-*,與 accent 分離)── */
.am-analyze { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); min-height: 52px; flex-wrap: wrap; }
.analyze-btn { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 13px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); background: var(--accent-soft); color: var(--accent); cursor: pointer; }
.analyze-btn:hover:not(:disabled) { filter: brightness(1.03); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.analyze-btn:disabled { opacity: .5; cursor: not-allowed; }
.analyze-hint { font-size: 12px; color: var(--fg-faint); }
.analyze-loading { display: inline-flex; align-items: center; gap: 9px; color: var(--fg-muted); font-size: 13px; font-weight: 550; }
.spin { width: 15px; height: 15px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); border-top-color: var(--accent); animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.verdict { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.vbadge { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; padding: 4px 11px; border-radius: 999px; flex: none; }
.vbadge.ok   { color: var(--st-done);     background: var(--st-done-bg);     border: 1px solid color-mix(in srgb, var(--st-done) 38%, transparent); }
.vbadge.warn { color: var(--st-awaiting); background: var(--st-awaiting-bg); border: 1px solid color-mix(in srgb, var(--st-awaiting) 42%, transparent); }
.vbadge.bad  { color: var(--st-error);    background: var(--st-error-bg);    border: 1px solid color-mix(in srgb, var(--st-error) 42%, transparent); }
.vcount { font-size: 12px; color: var(--fg-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.reanalyze { margin-left: auto; font: inherit; font-size: 12px; font-weight: 550; color: var(--accent); background: none; border: none; cursor: pointer; }
.reanalyze:hover { text-decoration: underline; }

.analysis { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 14px; min-width: 0; }
.analysis-head { display: flex; align-items: center; gap: 8px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
.analysis-head .lbl { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-faint); margin: 0; }
.analysis-head .by { margin-left: auto; font-size: 10.5px; color: var(--fg-faint); font-family: var(--mono); display: inline-flex; align-items: center; gap: 5px; }
.summary { padding: 12px 14px; font-size: 13.5px; line-height: 1.6; color: var(--fg); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.findings { display: flex; flex-direction: column; }
.finding { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 13px; border-left: 3px solid var(--st-idle); min-width: 0; }
.finding + .finding { border-top: 1px solid var(--border); }
.finding.high { border-left-color: var(--st-error); }
.finding.med  { border-left-color: var(--st-awaiting); }
.finding.low  { border-left-color: var(--st-running); }
.f-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sev { font-size: 10px; font-weight: 700; letter-spacing: .04em; padding: 2px 7px; border-radius: 5px; flex: none; }
.sev.high { color: var(--st-error);    background: var(--st-error-bg); }
.sev.med  { color: var(--st-awaiting); background: var(--st-awaiting-bg); }
.sev.low  { color: var(--st-running);  background: var(--st-running-bg); }
.f-step { font-size: 11px; font-weight: 600; color: var(--fg-muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; flex: none; cursor: pointer; font-family: inherit; }
.f-step:hover { border-color: var(--accent); color: var(--accent); }
.f-action { font-family: var(--mono); font-size: 11px; color: var(--fg-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.f-issue { font-size: 13px; color: var(--fg); line-height: 1.55; overflow-wrap: anywhere; }
.f-fix { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; color: var(--fg-muted); line-height: 1.55; overflow-wrap: anywhere; }
.f-fix .fx-ic { color: var(--st-done); flex: none; margin-top: 1px; }

/* 指摘點「步驟 N」時,對應工作項目短暫高亮 */
.wstep.flash { animation: flash 1.4s ease; border-radius: 8px; }
@keyframes flash { 0%, 40% { background: color-mix(in srgb, var(--st-awaiting) 20%, transparent); } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } .wstep.flash { animation: none; } }
```

- [ ] **Step 5: 執行確認通過**

Run: `cd web && npx vitest run tests/AgentModal.test.tsx`
Expected: PASS(4 passed)。

- [ ] **Step 6: 型別檢查**

Run: `cd web && npx tsc --noEmit`
Expected: 無錯誤(注意 App 尚未傳新 props → 若 App 已引用會報錯,Task 8 修;此時 AgentModal 單檔型別應自洽,App 的錯誤留待 Task 8)。

> 若 `tsc` 因 `App.tsx` 未提供 `analysisByKey/onAnalyze` 而報錯,屬預期,Task 8 補齊後再一起綠。可先只跑 vitest 驗 AgentModal。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/AgentModal.tsx web/src/tokens.css web/tests/AgentModal.test.tsx
git commit -m "feat: AgentModal 合理性分析動作列 + 結果面板 + 步驟高亮

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `App` 串接(快取狀態 + onAnalyze + 傳入彈窗)

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/tests/App.test.tsx`(加整合案例)

**Interfaces:**
- Consumes: `useSession().analyze`(Task 6);`AnalysisState / AnalysisTrace`(Task 5);`AgentModal` 新 props(Task 7)
- Produces:(無新對外介面,純串接)

- [ ] **Step 1: 在 `web/tests/App.test.tsx` 加整合測試**

在 `describe('App 整合流程…')` 內新增:

```tsx
  it('彈窗點「分析合理性」→ POST /analyze 帶 trace → 回傳後顯示判定', async () => {
    const result = { verdict: 'warn', summary: '有缺口', findings: [{ severity: 'high', step: 1, issue: '風險', suggestion: '先讀檔' }] }
    fetchImpl = vi.fn((path: string) => {
      if (path === '/analyze') return Promise.resolve({ ok: true, json: () => Promise.resolve(result) })
      return Promise.resolve({ ok: true })
    }) as unknown as typeof fetchImpl
    renderApp()
    push(snapshot())
    push({ type: 'event', seq: 1, event: { kind: 'message', role: 'user', text: '重構登入' } })
    push({ type: 'event', seq: 2, event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'Grep: password', status: 'done' } } })

    fireEvent.click(screen.getByRole('button', { name: /重構登入/ }))          // 開彈窗
    fireEvent.click(await screen.findByRole('button', { name: /分析合理性/ }))  // 觸發分析

    const call = fetchImpl.mock.calls.find((c) => c[0] === '/analyze')
    expect(call).toBeTruthy()
    expect(JSON.parse((call![1] as RequestInit).body as string).trace.steps).toHaveLength(1)
    expect(await screen.findByText('有缺口')).toBeInTheDocument()
    expect(screen.getByText('有疑慮')).toBeInTheDocument()
  })
```

- [ ] **Step 2: 執行確認失敗**

Run: `cd web && npx vitest run tests/App.test.tsx`
Expected: FAIL —找不到「分析合理性」按鈕(App 尚未把 props 傳給 AgentModal)。

- [ ] **Step 3: 改 `web/src/App.tsx`**

3a. import 補上:

```ts
import { buildAgentBlocks, flattenAgents, buildAnalysisTrace } from './buildAgentBlocks'
import type { LogEntry, AnalysisTrace, AnalysisState } from './wireTypes'
```

3b. 取 `analyze`:把 `const { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions } = useSession(deps)` 末尾加 `analyze`:

```ts
  const { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions, analyze } = useSession(deps)
```

3c. 在 `const [openIndex, setOpenIndex] = useState<number | null>(null)` 之後加入快取狀態與 handler:

```ts
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({})
  const onAnalyze = useCallback((key: string, trace: AnalysisTrace) => {
    setAnalyses((m) => ({ ...m, [key]: { status: 'loading' } }))
    analyze(trace)
      .then((result) => setAnalyses((m) => ({ ...m, [key]: { status: 'done', result } })))
      .catch((err) => {
        console.error('[App] 分析失敗', err)
        setAnalyses((m) => ({ ...m, [key]: { status: 'error' } }))
      })
  }, [analyze])
```

3d. 把新 props 傳給彈窗。將 `<AgentModal … />` 改為:

```tsx
        <AgentModal
          entries={entries}
          index={openIndex}
          outputByNode={outputs}
          analysisByKey={analyses}
          onAnalyze={onAnalyze}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
```

- [ ] **Step 4: 執行確認通過**

Run: `cd web && npx vitest run tests/App.test.tsx`
Expected: PASS(既有案例 + 新整合案例全綠)。

- [ ] **Step 5: 前端全測試 + 型別檢查**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS 且 tsc 無錯誤(此時 App 已補齊 props,Task 7 Step 6 的預期錯誤消失)。

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/tests/App.test.tsx
git commit -m "feat: App 串接合理性分析(agent key 快取 + 傳入彈窗)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: E2E 瀏覽器驗證 + 文件更新

**Files:**
- Modify: `README.md`、`README.zh-TW.md`、`NOTES.md`

**Interfaces:**
- Consumes: 全部前述 Task
- Produces:(無)

- [ ] **Step 1: 啟動前後端**

```bash
npm run dev            # 後端 :3001(終端 1)
cd web && npm run dev  # 前端 :5173(終端 2)
```

- [ ] **Step 2: 用 Playwright MCP 走一遍(observe 一個真實 session)**

驗證清單:
1. 開 <http://localhost:5173>,綠燈連線。
2. 來源下拉 → 觀察一個 Claude 或 Antigravity session(有工作項目的 agent)。
3. 左側 agent 清單點一列 → 彈窗開;頂部出現「⚖ 分析合理性」按鈕。
4. 按下 → 顯示「分析中…」spinner → 數秒後出現判定徽章 + 總評 + 指摘卡。
5. 點指摘卡的「步驟 N」→ 下方對應工作項目捲入視野並短暫高亮。
6. 切到另一個 agent 再切回 → 分析結果仍在(agent key 快取);按「重新分析」會重跑。
7. 切深/淺主題 → 面板配色正常(語意色 good/warn/bad 清楚)。
8. 確認正在 observe 的 session 不受影響(唯讀、無多餘節點灌入)。

- [ ] **Step 3: 更新 `README.md`**

在「Reading the left "Agents" panel — list + popup」段落末尾補一段(英文):

```markdown
**Reasonableness analysis (⚖):** inside the popup, click **"分析合理性" (Analyze reasonableness)** to
send *this agent's* ReAct trace to a **separate Claude** (an independent review session — it does not
touch the observed/controlled agent). It returns a structured verdict — **妥當 / 有疑慮 / 有問題**
(sound / questionable / problematic) — a short summary, and a list of findings, each with a severity
(high/med/low), the step it points at (click to jump + highlight), and a suggested fix. Runs through a
stateless `POST /analyze` endpoint; results are cached per agent for the session (not persisted).
```

- [ ] **Step 4: 更新 `README.zh-TW.md`**

在對應「左側 Agents 面板」段落補一段(繁中):

```markdown
**合理性分析(⚖)**:在彈窗內點 **「分析合理性」**,會把**這個 agent** 的 ReAct 軌跡交給**另一個
Claude**(獨立的審查 session,不會動到正在觀察/操控的 agent)。它回傳結構化判定 —— **妥當 / 有疑慮 /
有問題** —— 加一段總評,以及一份指摘清單:每項有嚴重度(高/中/低)、對應的步驟(可點,捲到並高亮),
與建議做法。走無狀態的 `POST /analyze`;結果以 agent 為單位在 session 內快取(不落地儲存)。
```

- [ ] **Step 5: 更新 `NOTES.md`**

在檔尾新增一節:

```markdown
## 合理性分析(POST /analyze)

- 把一個 agent 的 ReAct 軌跡交給「另一個 Claude」審查,回結構化 `{ verdict, summary, findings[] }`。
- **無狀態**:不進 SnapshotStore、不走 WS event/seq、不經 SessionManager → 不干擾正在跑的 agent。
- 核心純函式:`buildAnalysisPrompt`(組審查 prompt,要求只回固定 schema JSON、繁中)、
  `parseVerdict`(容錯抽 JSON + 驗證夾限,解析失敗回 warn fallback 不拋錯)。
- SDK 一次性 query:`realAnalyzeQuery`,`allowedTools: []`(審查只讀文字推理)、`maxTurns: 1`。
- 前端:`buildAnalysisTrace` 把工作項目攤成編號軌跡(output 截斷 500 字);`App` 以 agent key 快取
  loading/done/error;彈窗指摘可點「步驟 N」捲到並高亮對應工作項目。
- 不做(YAGNI):複製/下載、串流、分數、換別家 LLM、整 session 分析、落地儲存。
```

- [ ] **Step 6: Commit**

```bash
git add README.md README.zh-TW.md NOTES.md
git commit -m "docs: 合理性分析功能說明(README 中/英 + NOTES)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 架構獨立 `POST /analyze` → Task 4 ✓
- `buildAnalysisPrompt` / `parseVerdict` / `runAnalysis` / `AnalyzeQuery` → Task 1–3 ✓
- `realAnalyzeQuery`(無工具 SDK)→ Task 4 ✓
- 型別(前後端)→ Task 1 / Task 5 ✓
- `buildAnalysisTrace` → Task 5 ✓
- `useSession.analyze` → Task 6 ✓
- `AgentModal` 動作列 + 結果面板 + 步驟高亮 + tokens.css → Task 7 ✓
- `App` 快取 + 串接 → Task 8 ✓
- 錯誤處理(後端 400/500/warn fallback、前端 warn/error)→ Task 2/3/4/6/8 ✓
- 空 trace 停用按鈕 → Task 7 ✓
- 測試(後端 vitest、前端 jsdom)→ 各 Task ✓
- 文件 → Task 9 ✓
- 不做清單 → 計畫全程未觸及,符合 ✓

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 均有完整程式碼與指令。

**3. Type consistency:**
- `Verdict='ok'|'warn'|'bad'`、`Severity='high'|'med'|'low'` 前後端一致(Task 1 / Task 5)。
- `Finding` 不含 `action`(spec 原本 optional;改為前端由 `stepLabel(step)` 從 `cur.items` 取 label 顯示,更簡潔),`AnalysisPanel` 與 wire `Finding` 一致 → 已在 Task 7 反映。
- `buildAnalysisTrace(entry, outputByNode)` 簽章在 Task 5 定義、Task 7/8 引用一致。
- `runAnalysis(trace, queryImpl)`、`AnalyzeQuery` 在 Task 3 定義、Task 4 引用一致。
- `AgentModal` props `analysisByKey`/`onAnalyze` 在 Task 7 定義、Task 8 傳入一致。
- `AnalysisState` 定義於 `web/src/wireTypes.ts`(Task 5),App/AgentModal 共用,無循環 import。

> 與 spec 的唯一調整:`Finding.action` 移除,改由前端 `stepLabel` 依步驟編號回查標籤顯示(功能等價、更 DRY)。已在本計畫 Task 7 與型別定義一致落實。
