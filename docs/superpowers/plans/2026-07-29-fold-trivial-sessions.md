# 觀察清單「瑣碎 session」摺疊 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在觀察模式的 Claude session 清單中,把「開頭是純 slash 指令且沒對專案做任何事」的瑣碎 session(如 `/model`、空 `/init`)自動收進一個預設收起的 toggle,不刪除、不誤殺真實工作。

**Architecture:** 後端 `listSessions` 仍回全部並多帶一個 `trivial` 旗標,只對「指令開頭 + 無 subagent」的候選做上限 40 行的有界掃描以取得 `hasMutation` / `lines`。前端 `splitSessions` 依旗標把清單拆成正常組與瑣碎組,`SourcePicker` 把瑣碎組收在 toggle 後面。

**Tech Stack:** TypeScript;後端 Node(vitest, node env);前端 React 19 + Vite(vitest, jsdom + @testing-library/react)。

## Global Constraints

- 程式碼精簡/優雅/易懂,三者衝突以「易懂」為最高原則。
- 在容易出錯處(檔案讀寫、JSON.parse、try/catch)加 debug log,印出實際 error、不默默吞掉;JS 用 `console`。
- Git commit 訊息結尾必須是:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 所有工作在分支 `feat/fold-trivial-sessions`(spec 已在此分支)。
- TDD:每個 task 先寫失敗測試、確認紅、最小實作轉綠、再 commit。
- `LINE_THRESHOLD = 40`;改檔工具集合 = `Write` / `Edit` / `MultiEdit` / `NotebookEdit`。
- 每個 commit 後端 `npm test` 與根 `npx tsc --noEmit` 必須綠;動到前端的 task 另需 `cd web && npm test` 與 `web` 的 `npx tsc --noEmit` 綠。

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/sessions.ts` | session 列舉 + 瑣碎判定訊號 | 修改:`cleanTitle`/`firstMeta` 回 `isCommand`;新增 `LINE_THRESHOLD`、`classifyTrivial`、`scanActivity`;`SessionInfo` 加 `trivial`;`listSessions` 計算 `trivial` |
| `tests/sessions.test.ts` | 後端測試 | 修改:更新 2 個 `firstMeta` 既有斷言;新增 `classifyTrivial`/`scanActivity`/`listSessions` trivial 測試 |
| `web/src/wireTypes.ts` | 前端型別鏡射 | 修改:`ClaudeSessionInfo` 加 `trivial: boolean` |
| `web/tests/App.test.tsx` | 既有測試 | 修改:2 筆 claude session mock 補 `trivial` |
| `web/src/components/SourcePicker.tsx` | 來源下拉 + 清單呈現 | 修改:新增並匯出 `splitSessions`;正常/瑣碎分組 + toggle |
| `web/tests/SourcePicker.test.tsx` | 前端測試 | 新建:`splitSessions` 與 toggle 行為 |

> 註:後端 `SessionInfo` 定義在 `src/sessions.ts`(非 spec 誤寫的 `src/types.ts`),是 Claude 專用的扁平型別;`sourceSystems.ts:28` 以 `{ system: 'claude' as const, ...s }` 把它攤成 wire 格式,故 `trivial` 會自動流到前端,`sourceSystems.ts` 不需改。

---

### Task 1: `classifyTrivial` 純函式 + `LINE_THRESHOLD`

**Files:**
- Modify: `src/sessions.ts`(檔尾新增,不動既有 export)
- Test: `tests/sessions.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `export const LINE_THRESHOLD = 40`
  - `export function classifyTrivial(sig: { isCommand: boolean; subagents: number; hasMutation: boolean; lines: number }): boolean`

- [ ] **Step 1: 寫失敗測試**

在 `tests/sessions.test.ts` 頂部 import 補上 `classifyTrivial`:

```ts
import { listSessions, firstMeta, classifyTrivial, scanActivity, LINE_THRESHOLD } from '../src/sessions'
```

(本 task 只用到 `classifyTrivial`;`scanActivity`/`LINE_THRESHOLD` 在後續 task 用到,先一起 import 以免反覆改。若此步因 `scanActivity` 未定義而整檔編譯失敗,先只 import `classifyTrivial` 與 `LINE_THRESHOLD`,Task 2 再補 `scanActivity`。)

檔尾新增 describe:

```ts
describe('classifyTrivial', () => {
  const base = { isCommand: true, subagents: 0, hasMutation: false, lines: 14 }
  it('指令開頭 + 無 subagent + 無改檔 + 少行 → true', () => {
    expect(classifyTrivial(base)).toBe(true)
  })
  it('非指令開頭(真實任務)→ false', () => {
    expect(classifyTrivial({ ...base, isCommand: false })).toBe(false)
  })
  it('有改檔工具(/init 後有改專案)→ false', () => {
    expect(classifyTrivial({ ...base, hasMutation: true })).toBe(false)
  })
  it('行數達門檻(大量續作)→ false', () => {
    expect(classifyTrivial({ ...base, lines: LINE_THRESHOLD })).toBe(false)
  })
  it('有 subagent → false', () => {
    expect(classifyTrivial({ ...base, subagents: 2 })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/sessions.test.ts -t classifyTrivial`
Expected: FAIL(`classifyTrivial is not a function` / 未匯出)

- [ ] **Step 3: 最小實作**

在 `src/sessions.ts` 檔尾新增:

```ts
// 瑣碎判定門檻:記錄行數低於此值才可能算瑣碎(安全網,續作會超過)。
export const LINE_THRESHOLD = 40

// 依訊號判定 session 是否「瑣碎」:開頭是純 slash 指令,且之後沒對專案做任何事。
// 四條同時成立才算瑣碎;任一不成立(有改檔 / 有 subagent / 行數多 / 非指令開頭)即保留。
export function classifyTrivial(sig: {
  isCommand: boolean; subagents: number; hasMutation: boolean; lines: number
}): boolean {
  return sig.isCommand && sig.subagents === 0 && !sig.hasMutation && sig.lines < LINE_THRESHOLD
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/sessions.test.ts -t classifyTrivial`
Expected: PASS(5 個)

- [ ] **Step 5: Commit**

```bash
git add src/sessions.ts tests/sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): classifyTrivial 純函式判定瑣碎 session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `firstMeta` 回傳 `isCommand` + `scanActivity` 有界掃描

**Files:**
- Modify: `src/sessions.ts`(`cleanTitle`、`firstMeta`;新增 `scanActivity` 與改檔工具集合)
- Test: `tests/sessions.test.ts`(更新 2 個既有 `firstMeta` 斷言;新增測試)

**Interfaces:**
- Consumes: `LINE_THRESHOLD`(Task 1)
- Produces:
  - `firstMeta(file): { cwd: string; title: string; isCommand: boolean }`(回傳型別新增 `isCommand`)
  - `export function scanActivity(file: string, limit?: number): { hasMutation: boolean; lines: number }`

- [ ] **Step 1: 寫失敗測試**

(1)更新既有兩處 `firstMeta` 的 `toEqual`,補上 `isCommand`:

`tests/sessions.test.ts` 中
- `expect(firstMeta(f)).toEqual({ cwd: 'C:/proj', title: '幫我重構登入流程' })`
  → `toEqual({ cwd: 'C:/proj', title: '幫我重構登入流程', isCommand: false })`
- `expect(firstMeta(f)).toEqual({ cwd: 'x', title: '' })`
  → `toEqual({ cwd: 'x', title: '', isCommand: false })`

(2)在 `describe('firstMeta')` 內新增:

```ts
it('slash 指令 → isCommand 為 true', () => {
  const f = writeSession([
    { type: 'user', cwd: 'x', message: { role: 'user', content: '<command-name>/model</command-name>' } },
  ])
  expect(firstMeta(f).isCommand).toBe(true)
})
it('自然語言 → isCommand 為 false', () => {
  const f = writeSession([
    { type: 'user', cwd: 'x', message: { role: 'user', content: '幫我修 bug' } },
  ])
  expect(firstMeta(f).isCommand).toBe(false)
})
```

(3)新增 `scanActivity` 的 describe:

```ts
describe('scanActivity', () => {
  it('無改檔工具、行數少 → hasMutation false、lines 為記錄數', () => {
    const f = writeSession([
      { type: 'user', cwd: 'x', message: { content: '<command-name>/model</command-name>' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
    ])
    expect(scanActivity(f)).toEqual({ hasMutation: false, lines: 2 })
  })
  it('出現 Write 的 tool_use → hasMutation true', () => {
    const f = writeSession([
      { type: 'user', cwd: 'x', message: { content: '<command-name>/init</command-name>' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: {} }] } },
    ])
    expect(scanActivity(f).hasMutation).toBe(true)
  })
  it('行數達上限即停,lines 夾在 limit', () => {
    const recs = Array.from({ length: 60 }, (_, i) => ({ type: 'user', message: { content: String(i) } }))
    const f = writeSession(recs)
    expect(scanActivity(f, 40).lines).toBe(40)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/sessions.test.ts -t "firstMeta|scanActivity"`
Expected: FAIL(`isCommand` 未定義 / `scanActivity is not a function`)

- [ ] **Step 3: 最小實作**

改 `cleanTitle` 回傳結構、`firstMeta` 帶出 `isCommand`,並新增 `scanActivity`:

```ts
// 清成可讀標題並標記是否為 slash 指令開頭。
function cleanTitle(raw: string): { title: string; isCommand: boolean } {
  const cmd = raw.match(/<command-name>([^<]+)<\/command-name>/)
  if (cmd) return { title: cmd[1].trim(), isCommand: true }
  return { title: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80), isCommand: false }
}
```

`firstMeta` 內:宣告 `let isCommand = false`;取到 title 時一併記錄;結尾回傳 `{ cwd, title, isCommand }`:

```ts
export function firstMeta(file: string): { cwd: string; title: string; isCommand: boolean } {
  let cwd = '', title = '', isCommand = false
  // ...(讀檔頭邏輯不變)...
      if (!title && rec?.type === 'user') {
        const c = cleanTitle(userText(rec?.message?.content))
        if (c.title) { title = c.title; isCommand = c.isCommand }
      }
  // ...
  return { cwd, title, isCommand }
}
```

(`firstCwd` 不變,仍 `return firstMeta(file).cwd`。)

檔尾新增改檔工具集合與 `scanActivity`:

```ts
const MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// 有界掃描候選檔:數非空記錄行(達 limit 即停),並偵測是否用過改檔工具的 tool_use。
// 讀檔或解析失敗印出實際 error,保守回 lines=limit(視為非瑣碎,寧可少摺)。
export function scanActivity(file: string, limit = LINE_THRESHOLD): { hasMutation: boolean; lines: number } {
  let lines = 0, hasMutation = false
  try {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      if (++lines >= limit) { lines = limit; break }
      let rec: any
      try { rec = JSON.parse(line) } catch { continue }
      if (rec?.type === 'assistant') {
        for (const b of rec.message?.content ?? []) {
          if (b?.type === 'tool_use' && MUTATION_TOOLS.has(b?.name)) { hasMutation = true; break }
        }
        if (hasMutation) break
      }
    }
  } catch (err) {
    console.error(`[sessions] scanActivity 讀檔失敗 ${file}:`, err)
    return { hasMutation: false, lines: limit }
  }
  return { hasMutation, lines }
}
```

在 `src/sessions.ts` 檔頭的 `node:fs` import 補入 `readFileSync`(若尚未含):

```ts
import { existsSync, statSync, readdirSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/sessions.test.ts`
Expected: PASS(含既有全部;新 firstMeta/scanActivity 綠)

- [ ] **Step 5: Commit**

```bash
git add src/sessions.ts tests/sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): firstMeta 回傳 isCommand;scanActivity 有界掃描改檔/行數

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `listSessions` 端到端算出 `trivial`

**Files:**
- Modify: `src/sessions.ts`(`SessionInfo` 加 `trivial`;`listSessions` 計算)
- Test: `tests/sessions.test.ts`(新增 listSessions trivial 整合測試)

**Interfaces:**
- Consumes: `classifyTrivial`(Task 1)、`scanActivity`、`firstMeta().isCommand`(Task 2)
- Produces: `SessionInfo` 新增 `trivial: boolean`;`listSessions` 回傳每筆帶 `trivial`

- [ ] **Step 1: 寫失敗測試**

在 `describe('listSessions')` 內新增:

```ts
it('bare /model → trivial:true;真實任務 → false', () => {
  const proj = join(root, 'p')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'model.jsonl'), jsonl([
    { type: 'user', cwd: 'x', message: { role: 'user', content: '<command-name>/model</command-name>' } },
  ]))
  writeFileSync(join(proj, 'task.jsonl'), jsonl([
    { type: 'user', cwd: 'x', message: { role: 'user', content: '幫我讀 src 並總結' } },
  ]))
  const byTitle = Object.fromEntries(listSessions(root).map((s) => [s.title, s.trivial]))
  expect(byTitle['/model']).toBe(true)
  expect(byTitle['幫我讀 src 並總結']).toBe(false)
})

it('/init 後有改檔(Write)→ trivial:false', () => {
  const proj = join(root, 'p')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'init.jsonl'), jsonl([
    { type: 'user', cwd: 'x', message: { role: 'user', content: '<command-name>/init</command-name>' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: {} }] } },
  ]))
  expect(listSessions(root)[0].trivial).toBe(false)
})

it('指令開頭但行數 >= 門檻 → trivial:false', () => {
  const proj = join(root, 'p')
  mkdirSync(proj, { recursive: true })
  const recs = [{ type: 'user', cwd: 'x', message: { role: 'user', content: '<command-name>/init</command-name>' } }]
  for (let i = 0; i < LINE_THRESHOLD; i++) recs.push({ type: 'assistant', message: { content: [{ type: 'text', text: String(i) }] } } as any)
  writeFileSync(join(proj, 'big.jsonl'), jsonl(recs))
  expect(listSessions(root)[0].trivial).toBe(false)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/sessions.test.ts -t listSessions`
Expected: FAIL(`trivial` 為 undefined,`toBe(true)` 不成立)

- [ ] **Step 3: 最小實作**

`SessionInfo` interface 加欄位:

```ts
export interface SessionInfo {
  file: string
  project: string
  cwd: string
  title: string
  mtime: number
  subagents: number
  trivial: boolean  // 開頭是純指令且沒對專案做任何事 → 前端預設收起
}
```

`listSessions` 內把原本 push 前的邏輯改成先算 `subagents`,再視候選掃描:

```ts
const meta = firstMeta(file)
if (meta.title.startsWith(ANALYSIS_PROMPT_OPENING)) continue
const subagents = countSubagents(join(dir, name.slice(0, -'.jsonl'.length), 'subagents'))
// 只有「指令開頭 + 無 subagent」的候選才掃內容;其餘直接非瑣碎、不掃。
const { hasMutation, lines } = meta.isCommand && subagents === 0
  ? scanActivity(file)
  : { hasMutation: false, lines: LINE_THRESHOLD }
const trivial = classifyTrivial({ isCommand: meta.isCommand, subagents, hasMutation, lines })
out.push({ file, project, cwd: meta.cwd, title: meta.title, mtime: st.mtimeMs, subagents, trivial })
```

- [ ] **Step 4: 跑測試 + 型別檢查確認通過**

Run: `npx vitest run tests/sessions.test.ts && npx tsc --noEmit`
Expected: PASS(全部 sessions 測試綠;根 tsc 無輸出)

- [ ] **Step 5: Commit**

```bash
git add src/sessions.ts tests/sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): listSessions 帶出 trivial(候選才做有界掃描)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 前端型別鏡射 + `splitSessions` 純函式

**Files:**
- Modify: `web/src/wireTypes.ts`(`ClaudeSessionInfo` 加 `trivial`)
- Modify: `web/tests/App.test.tsx`(2 筆 claude mock 補 `trivial`)
- Modify: `web/src/components/SourcePicker.tsx`(新增並匯出 `splitSessions`)
- Test: `web/tests/SourcePicker.test.tsx`(新建,先只測 `splitSessions`)

**Interfaces:**
- Consumes: `SessionInfo` / `ClaudeSessionInfo`(wireTypes)
- Produces: `export function splitSessions(list: SessionInfo[]): { normal: SessionInfo[]; trivial: SessionInfo[] }`

- [ ] **Step 1: 寫失敗測試**

新建 `web/tests/SourcePicker.test.tsx`:

```ts
import { describe, it, expect } from 'vitest'
import { splitSessions } from '../src/components/SourcePicker'
import type { SessionInfo } from '../src/wireTypes'

const claude = (title: string, trivial: boolean): SessionInfo =>
  ({ system: 'claude', file: title, project: 'p', cwd: 'x', title, mtime: 0, subagents: 0, trivial })
const anti = (identity: string): SessionInfo =>
  ({ system: 'antigravity', file: identity, identity, cwd: 'x', mtime: 0, steps: 1 })

describe('splitSessions', () => {
  it('依 trivial 拆成 normal / trivial', () => {
    const list = [claude('real', false), claude('/model', true), claude('/init', true)]
    const { normal, trivial } = splitSessions(list)
    expect(normal.map((s) => s.title)).toEqual(['real'])
    expect(trivial.map((s) => (s as any).title)).toEqual(['/model', '/init'])
  })
  it('Antigravity session 一律歸 normal', () => {
    const { normal, trivial } = splitSessions([anti('orchestrator')])
    expect(normal).toHaveLength(1)
    expect(trivial).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && npx vitest run tests/SourcePicker.test.tsx`
Expected: FAIL(`splitSessions` 未匯出)

- [ ] **Step 3: 最小實作**

(1)`web/src/wireTypes.ts` 的 `ClaudeSessionInfo` 加欄位:

```ts
export interface ClaudeSessionInfo {
  system: 'claude'
  file: string
  project: string
  cwd: string
  title: string
  mtime: number
  subagents: number
  trivial: boolean   // 後端判定的瑣碎旗標;前端預設收起
}
```

(2)`web/tests/App.test.tsx` 兩筆 claude session mock(約 line 89、113)各補 `trivial: false`,例如:

```ts
{ system: 'claude', file: 'C:/proj/s.jsonl', project: 'C--Users-me-Desktop-proj-chess', cwd: 'C:/proj', mtime: Date.now(), subagents: 3, trivial: false },
```

(3)`web/src/components/SourcePicker.tsx` 在 `metaOf` 之後新增並匯出:

```ts
// 依後端 trivial 旗標把清單拆成正常組與瑣碎組(僅 Claude 有 trivial;其餘皆入 normal)。
export function splitSessions(list: SessionInfo[]): { normal: SessionInfo[]; trivial: SessionInfo[] } {
  const normal: SessionInfo[] = []
  const trivial: SessionInfo[] = []
  for (const s of list) {
    if (s.system === 'claude' && s.trivial) trivial.push(s)
    else normal.push(s)
  }
  return { normal, trivial }
}
```

- [ ] **Step 4: 跑測試 + 型別檢查確認通過**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS(含更新後的 App.test;SourcePicker.test 的 splitSessions 綠;tsc 無輸出)

- [ ] **Step 5: Commit**

```bash
git add web/src/wireTypes.ts web/tests/App.test.tsx web/src/components/SourcePicker.tsx web/tests/SourcePicker.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): ClaudeSessionInfo 加 trivial;splitSessions 拆正常/瑣碎組

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `SourcePicker` 瑣碎組 toggle 呈現

**Files:**
- Modify: `web/src/components/SourcePicker.tsx`(清單渲染分組 + toggle 狀態)
- Test: `web/tests/SourcePicker.test.tsx`(新增 toggle 行為測試)

**Interfaces:**
- Consumes: `splitSessions`(Task 4)
- Produces: 無新對外 API(僅元件行為)

- [ ] **Step 1: 寫失敗測試**

在 `web/tests/SourcePicker.test.tsx` 補 import 與元件測試:

```ts
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { SourcePicker } from '../src/components/SourcePicker'

function openClaudeList(list: SessionInfo[]) {
  const loadSessions = vi.fn(() => Promise.resolve(list))
  render(<SourcePicker mode="control" onObserve={vi.fn()} onNewAgent={vi.fn()} loadSessions={loadSessions} />)
  fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
  fireEvent.click(screen.getByText(/觀察 Claude session/))
  return loadSessions
}

describe('SourcePicker 瑣碎摺疊', () => {
  const list: SessionInfo[] = [
    { system: 'claude', file: 'r', project: 'p', cwd: 'x', title: '真實任務', mtime: 0, subagents: 0, trivial: false },
    { system: 'claude', file: 'm', project: 'p', cwd: 'x', title: '/model', mtime: 0, subagents: 0, trivial: true },
  ]

  it('預設顯示正常項、隱藏瑣碎項,toggle 帶數量', async () => {
    openClaudeList(list)
    expect(await screen.findByText('真實任務')).toBeInTheDocument()
    expect(screen.queryByText('/model')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /瑣碎 session \(1\)/ })).toBeInTheDocument()
  })

  it('點 toggle 後顯示瑣碎項', async () => {
    openClaudeList(list)
    await screen.findByText('真實任務')
    fireEvent.click(screen.getByRole('button', { name: /瑣碎 session \(1\)/ }))
    expect(screen.getByText('/model')).toBeInTheDocument()
  })

  it('沒有瑣碎項時不顯示 toggle', async () => {
    openClaudeList([list[0]])
    await screen.findByText('真實任務')
    expect(screen.queryByText(/瑣碎 session/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && npx vitest run tests/SourcePicker.test.tsx -t 瑣碎摺疊`
Expected: FAIL(瑣碎項預設仍顯示 / 找不到 toggle 按鈕)

- [ ] **Step 3: 最小實作**

在 `SourcePicker` 元件內新增 toggle 狀態,並在 `pickSystem` 重置:

```ts
const [showTrivial, setShowTrivial] = useState(false)
```

`pickSystem` 內開頭加 `setShowTrivial(false)`(換系統回到收起)。

把 `view !== 'root'` 區塊裡「`sessions.map(...)`」那段換成分組渲染。抽一個小的列渲染函式避免重複:

```tsx
const renderItem = (s: SessionInfo) => (
  <button key={s.file} className="source-item" onClick={() => { onObserve(s.system, s.file); setOpen(false) }} title={s.cwd || s.file}>
    <span className="si-title">{titleOf(s)}</span>
    <span className="si-meta">{metaOf(s)}</span>
  </button>
)
```

清單分支(取代原本 `sessions.map`):

```tsx
{loading
  ? <div className="source-empty">載入中…</div>
  : sessions.length === 0
    ? <div className="source-empty">找不到可觀察的 session</div>
    : (() => {
        const { normal, trivial } = splitSessions(sessions)
        return (
          <>
            {normal.map(renderItem)}
            {trivial.length > 0 && (
              <>
                <button className="source-item trivial-toggle" onClick={() => setShowTrivial((v) => !v)}>
                  <span className="si-plus">{showTrivial ? '▾' : '▸'}</span>
                  <span>{showTrivial ? '收起' : '顯示'}瑣碎 session ({trivial.length})</span>
                </button>
                {showTrivial && trivial.map(renderItem)}
              </>
            )}
          </>
        )
      })()}
```

- [ ] **Step 4: 跑測試 + 型別檢查確認通過**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS(SourcePicker 全綠;tsc 無輸出)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SourcePicker.tsx web/tests/SourcePicker.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): SourcePicker 把瑣碎 session 收進預設收起的 toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## 完成後

- 全套測試綠:根 `npm test`、`cd web && npm test`;型別:兩處 `npx tsc --noEmit`。
- 手動確認:啟動前後端,觀察下拉選「觀察 Claude session」,確認 `/model`、空 `/init` 被收在「顯示瑣碎 session (N)」後,真實任務(含 `/init` 後有改檔者)仍直接可見。
- 依 `superpowers:finishing-a-development-branch` 決定合併回 master。

## Self-Review 對照 spec

- **判準四條** → Task 1 `classifyTrivial`(5 測試涵蓋每條)。✔
- **isCommand 訊號** → Task 2 `firstMeta`。✔
- **hasMutation / lines 有界掃描(上限 40、候選才掃)** → Task 2 `scanActivity` + Task 3 wiring。✔
- **listSessions 仍回全部、不刪、mtime 排序** → Task 3(沿用既有排序,只加欄位)。✔
- **型別鏡射(注意:後端在 `src/sessions.ts` 非 `src/types.ts`)** → Task 3(後端)+ Task 4(web)。✔
- **splitSessions + toggle 預設收起 + N=0 不顯示** → Task 4 / Task 5。✔
- **Antigravity 不判瑣碎** → splitSessions 只認 `system==='claude' && trivial`。✔
- **錯誤處理:掃描失敗印 error、保守非瑣碎** → Task 2 `scanActivity` catch 回 `lines=limit`。✔
- **YAGNI(不做分數排序、不持久化 toggle)** → 計畫未含,符合。✔
