# 新 Agent 工作目錄選擇器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開新 Agent 時用 UI 目錄選擇器挑選(或當場建立)一個資料夾當該次 agent 的工作目錄(cwd)。

**Architecture:** 後端開兩支目錄 API(`GET /dirs` 列子資料夾、`POST /mkdir` 建空資料夾),前端用 `WorkspacePicker` 彈窗導覽選取;把目前寫死的 cwd 從 `agentAdapter` 一路穿線到 `SessionManager.start` 與 `SourceController.toControl`,`AGENT_WORKSPACE` 降為預設值。只動控制模式。

**Tech Stack:** TypeScript、Express、`@anthropic-ai/claude-agent-sdk`、React + Vite、vitest(後端 node / 前端 jsdom)、`node:fs`。

## Global Constraints

- 程式碼精簡、優雅、易懂;易懂為最高原則。
- 易出錯處用 `console` 加 debug log;try/catch 印實際 error,不默默吞掉。
- UI 文字繁體中文。
- 只影響**控制模式**;觀察模式完全不碰。
- `listDirs` 只列子資料夾(忽略檔案),讀不到權限的子項靜默略過(不整支失敗)。
- cwd 型別穿線:`RunQuery` / `buildOptions` / `realRunQuery` / `SessionManager.start` / `SourceController.toControl` 都加 `cwd?: string`,無值時回退 `resolveWorkspace()`(env `AGENT_WORKSPACE` 或 `process.cwd()`)。
- `DirListing` 型別前後端一致:`{ path: string; parent: string | null; drives?: string[]; entries: string[] }`。
- git commit 訊息結尾必附:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure

- `src/dirs.ts`(新建)— `listDirs`、`makeDir` 純函式 + `DirListing` 型別。
- `src/agentAdapter.ts`(修改)— `buildOptions`/`realRunQuery` 加 `cwd?`。
- `src/sessionManager.ts`(修改)— `RunQuery` 型別加 `cwd?`;`start(prompt, cwd?)` 穿線到 `consume`。
- `src/sourceController.ts`(修改)— `toControl(cwd?)` + `controlCwd()`。
- `src/server.ts`(修改)— `GET /dirs`、`POST /mkdir`、`/new-agent { cwd? }`、`/start` 用 `controller.controlCwd()`。
- `web/src/wireTypes.ts`(修改)— `DirListing`。
- `web/src/useSession.ts`(修改)— `newAgent(cwd?)`、`loadDirs`、`makeDir`。
- `web/src/components/WorkspacePicker.tsx`(新建)— 選擇器彈窗。
- `web/src/components/SourcePicker.tsx`(不改邏輯)— 「新 Agent」的 `onNewAgent` 由 App 改接成「開選擇器」。
- `web/src/App.tsx`(修改)— picker 開關 state + 傳 `loadDirs/makeDir` + 確認呼叫 `newAgent(cwd)`。
- `web/src/tokens.css`(修改)— 選擇器樣式。
- 測試:`tests/dirs.test.ts`(新)、`tests/agentAdapter.test.ts`(改)、`tests/sessionManager.test.ts`(改)、`tests/sourceController.test.ts`(改)、`web/tests/useSession.dirs.test.ts`(新)、`web/tests/WorkspacePicker.test.tsx`(新)、`web/tests/App.test.tsx`(改)。
- 文件:`README.md`、`README.zh-TW.md`、`NOTES.md`(改)。

---

### Task 1: 後端 `listDirs` + `DirListing`

**Files:**
- Create: `src/dirs.ts`
- Test: `tests/dirs.test.ts`

**Interfaces:**
- Produces:
  - `interface DirListing { path: string; parent: string | null; drives?: string[]; entries: string[] }`
  - `function listDirs(path: string): DirListing`

- [ ] **Step 1: 寫失敗測試 `tests/dirs.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listDirs } from '../src/dirs'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dirs-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('listDirs', () => {
  it('只列子資料夾(忽略檔案),排序,附上 parent', () => {
    mkdirSync(join(root, 'beta'))
    mkdirSync(join(root, 'alpha'))
    writeFileSync(join(root, 'file.txt'), 'x')
    const r = listDirs(root)
    expect(r.path).toBe(root)
    expect(r.entries).toEqual(['alpha', 'beta'])
    expect(r.parent).toBe(dirname(root))
  })

  it('path 不存在 → 拋錯', () => {
    expect(() => listDirs(join(root, 'nope'))).toThrow()
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run tests/dirs.test.ts`
Expected: FAIL —「Cannot find module '../src/dirs'」。

- [ ] **Step 3: 建 `src/dirs.ts` 實作 `listDirs`**

```ts
import { existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface DirListing {
  path: string
  parent: string | null
  drives?: string[]
  entries: string[]
}

// 列出某目錄下的「子資料夾」供 UI 導覽。path 為空 → 磁碟根視圖
// (Windows 列磁碟機、entries 空;POSIX 解析成 '/' 照常列)。
export function listDirs(path: string): DirListing {
  if (!path) {
    if (process.platform === 'win32') {
      return { path: '', parent: null, drives: windowsDrives(), entries: [] }
    }
    path = '/'
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`不是有效的目錄:${path}`)
  }
  const entries: string[] = []
  for (const name of readdirSync(path)) {
    try {
      if (statSync(join(path, name)).isDirectory()) entries.push(name)
    } catch {
      // 權限/連結問題的子項略過,不讓整支失敗
    }
  }
  entries.sort((a, b) => a.localeCompare(b))
  return { path, parent: parentOf(path), entries }
}

// 上一層;已在根時:Windows 回 ''(前端顯示磁碟機清單)、POSIX 回 null。
function parentOf(path: string): string | null {
  const up = dirname(path)
  if (up === path) return process.platform === 'win32' ? '' : null
  return up
}

function windowsDrives(): string[] {
  const out: string[] = []
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`
    try { if (existsSync(d)) out.push(d) } catch { /* skip */ }
  }
  return out
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run tests/dirs.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add src/dirs.ts tests/dirs.test.ts
git commit -m "feat: listDirs(列子資料夾 + DirListing 型別)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 後端 `makeDir`

**Files:**
- Modify: `src/dirs.ts`
- Test: `tests/dirs.test.ts`

**Interfaces:**
- Produces: `function makeDir(parent: string, name: string): string`(回新資料夾絕對路徑)

- [ ] **Step 1: 追加失敗測試到 `tests/dirs.test.ts`**

```ts
import { listDirs, makeDir } from '../src/dirs'
import { existsSync } from 'node:fs'

describe('makeDir', () => {
  it('在父目錄下建空資料夾,回新路徑', () => {
    const p = makeDir(root, 'proj')
    expect(p).toBe(join(root, 'proj'))
    expect(existsSync(p)).toBe(true)
  })
  it('名稱含路徑分隔符 / .. → 拋錯', () => {
    expect(() => makeDir(root, '../evil')).toThrow()
    expect(() => makeDir(root, 'a/b')).toThrow()
    expect(() => makeDir(root, '..')).toThrow()
  })
  it('已存在 → 拋錯', () => {
    makeDir(root, 'dup')
    expect(() => makeDir(root, 'dup')).toThrow()
  })
  it('父目錄不存在 → 拋錯', () => {
    expect(() => makeDir(join(root, 'nope'), 'x')).toThrow()
  })
})
```

> 註:把既有 `import { listDirs } from '../src/dirs'` 改成 `import { listDirs, makeDir } from '../src/dirs'`,並補 `import { existsSync } from 'node:fs'`。

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run tests/dirs.test.ts`
Expected: FAIL —「makeDir is not a function」。

- [ ] **Step 3: 在 `src/dirs.ts` 追加 `makeDir`**

檔頂 import 補 `mkdirSync`:

```ts
import { existsSync, statSync, readdirSync, mkdirSync } from 'node:fs'
```

檔尾新增:

```ts
// 在 parent 下建立一個空資料夾。防呆:name 不含路徑分隔符 / 非 . .. ;parent 須存在且是目錄。
export function makeDir(parent: string, name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error(`資料夾名稱非法:${name}`)
  }
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`父目錄不存在:${parent}`)
  }
  const full = join(parent, name)
  if (existsSync(full)) throw new Error(`已存在:${full}`)
  mkdirSync(full)
  return full
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run tests/dirs.test.ts`
Expected: PASS(全部 dirs 測試通過)。

- [ ] **Step 5: Commit**

```bash
git add src/dirs.ts tests/dirs.test.ts
git commit -m "feat: makeDir(建空資料夾 + 名稱防呆)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: cwd 穿線(agentAdapter + sessionManager)

**Files:**
- Modify: `src/agentAdapter.ts`
- Modify: `src/sessionManager.ts`
- Test: `tests/agentAdapter.test.ts`、`tests/sessionManager.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspace()`(現有)
- Produces:
  - `buildOptions(canUseTool, abortController, cwd?): any`（`cwd: cwd ?? resolveWorkspace()`）
  - `realRunQuery({ prompt, canUseTool, signal, cwd? })`
  - `RunQuery` 型別多一個 `cwd?: string`
  - `SessionManager.start(initialPrompt: string, cwd?: string)`

- [ ] **Step 1: 寫失敗測試(agentAdapter)**

追加到 `tests/agentAdapter.test.ts`:

```ts
import { buildOptions, resolveWorkspace } from '../src/agentAdapter'

describe('buildOptions cwd', () => {
  const noop = async () => ({ behavior: 'deny', message: '' } as any)
  it('帶 cwd → 用該 cwd', () => {
    expect(buildOptions(noop, new AbortController(), 'C:/x').cwd).toBe('C:/x')
  })
  it('沒帶 cwd → 回退 resolveWorkspace()', () => {
    expect(buildOptions(noop, new AbortController()).cwd).toBe(resolveWorkspace())
  })
})
```

- [ ] **Step 2: 寫失敗測試(sessionManager)**

追加到 `tests/sessionManager.test.ts`:

```ts
it('start(prompt, cwd) 會把 cwd 傳給 runQuery', async () => {
  let seen: any
  const mgr = new SessionManager({
    runQuery: (args: any) => { seen = args; return (async function* () {})() },
  })
  mgr.start('做事', 'C:/work')
  await Promise.resolve()
  expect(seen.cwd).toBe('C:/work')
})
```

> 註:若 `tests/sessionManager.test.ts` 尚未 import `SessionManager`,沿用該檔既有 import。

- [ ] **Step 3: 執行確認失敗**

Run: `npx vitest run tests/agentAdapter.test.ts tests/sessionManager.test.ts`
Expected: FAIL —`buildOptions` 只吃 2 參數 / `start` 忽略第 2 參數導致 `seen.cwd` 為 undefined。

- [ ] **Step 4: 改 `src/agentAdapter.ts`**

`buildOptions` 加 `cwd?`:

```ts
export function buildOptions(canUseTool: CanUseTool, abortController: AbortController, cwd?: string): any {
  return {
    cwd: cwd ?? resolveWorkspace(),
    abortController,
    canUseTool: async (toolName: string, input: any, opts: any) => {
      const toolUseId = opts?.toolUseID ?? `${toolName}-${Date.now()}`
      console.log('[agentAdapter] canUseTool', toolName, toolUseId)
      return canUseTool(toolName, input, { toolUseId })
    },
  }
}
```

`realRunQuery` 收 `cwd` 並傳入:

```ts
export const realRunQuery = ({
  prompt,
  canUseTool,
  signal,
  cwd,
}: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
  cwd?: string
}): AsyncIterable<any> => {
  const abortController = new AbortController()
  if (signal.aborted) abortController.abort()
  else signal.addEventListener('abort', () => abortController.abort(), { once: true })

  const options = buildOptions(canUseTool, abortController, cwd)
  console.log('[agentAdapter] workspace cwd =', options.cwd)
  return query({ prompt, options } as any) as AsyncIterable<any>
}
```

- [ ] **Step 5: 改 `src/sessionManager.ts`**

`RunQuery` 型別加 `cwd?`:

```ts
type RunQuery = (args: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
  cwd?: string
}) => AsyncIterable<any>
```

在類別欄位區加 `private startCwd?: string`(放在 `private controller = new AbortController()` 附近),`start` 收 cwd、`consume` 傳 cwd:

```ts
  start(initialPrompt: string, cwd?: string) {
    this.startCwd = cwd
    this.pushInput({ type: 'user', message: { role: 'user', content: initialPrompt } })
    void this.consume()
  }

  private async consume() {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputQueue(),
        canUseTool: this.canUseTool,
        signal: this.controller.signal,
        cwd: this.startCwd,
      })
      for await (const msg of stream) {
        for (const cb of this.msgCbs) cb(msg)
      }
    } catch (err) {
      console.error('[SessionManager] consume error:', err)
      for (const cb of this.msgCbs) cb({ type: 'session_error', error: String(err) })
    }
  }
```

- [ ] **Step 6: 執行確認通過**

Run: `npx vitest run tests/agentAdapter.test.ts tests/sessionManager.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/agentAdapter.ts src/sessionManager.ts tests/agentAdapter.test.ts tests/sessionManager.test.ts
git commit -m "feat: cwd 穿線 buildOptions/realRunQuery/SessionManager.start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `SourceController.toControl(cwd)` + `controlCwd()`

**Files:**
- Modify: `src/sourceController.ts`
- Test: `tests/sourceController.test.ts`

**Interfaces:**
- Produces:`toControl(cwd?: string): void`(`workspace = cwd ?? controlWorkspace()`,存 cwd);`controlCwd(): string | undefined`

- [ ] **Step 1: 寫失敗測試**

追加到 `tests/sourceController.test.ts`(沿用該檔既有建構方式建立 controller;`controlWorkspace` 注入回傳固定字串,例如 `() => 'C:/default'`):

```ts
it('toControl(cwd) 設定 workspace 與 controlCwd;無 cwd 用預設', () => {
  const store = new SnapshotStore()
  const ctrl = new SourceController(store, () => {}, () => 'C:/default')
  ctrl.toControl('C:/picked')
  expect(ctrl.workspace).toBe('C:/picked')
  expect(ctrl.controlCwd()).toBe('C:/picked')
  ctrl.toControl()
  expect(ctrl.workspace).toBe('C:/default')
  expect(ctrl.controlCwd()).toBeUndefined()
})
```

> 註:`SnapshotStore` 從 `../src/snapshot` import;若該測試檔已有 import 沿用。建構子第 2 參數是 `broadcast`,傳 `() => {}` 即可。

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run tests/sourceController.test.ts`
Expected: FAIL —`toControl` 不吃參數 /`controlCwd` 不存在。

- [ ] **Step 3: 改 `src/sourceController.ts`**

類別欄位加 `private _controlCwd?: string`(放在 `private backfilling = false` 附近)。把 `toControl` 改成:

```ts
  toControl(cwd?: string): void {
    console.log('[controller] 切換到 control', cwd ?? '(預設)')
    this.source?.stop()
    this.source = null
    this.store.reset()
    this.assembler.reset()
    this.mode = 'control'
    this._controlCwd = cwd
    this.workspace = cwd ?? this.controlWorkspace()
    this.broadcastSnapshot()
  }

  controlCwd(): string | undefined {
    return this._controlCwd
  }
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run tests/sourceController.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/sourceController.ts tests/sourceController.test.ts
git commit -m "feat: SourceController.toControl(cwd) + controlCwd()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: server 路由(/dirs、/mkdir、/new-agent cwd、/start 用 controlCwd)

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `listDirs`/`makeDir`(Task 1-2);`controller.toControl(cwd)`/`controlCwd()`(Task 4);`mgr.start(prompt, cwd)`(Task 3)
- Produces: HTTP `GET /dirs?path=`、`POST /mkdir { parent, name }`、`POST /new-agent { cwd? }`、`POST /start`(用 controlCwd)

> 純 HTTP glue,依慣例不寫單元測試,Task 9 用瀏覽器 E2E 驗;需 `npx tsc --noEmit` 過、既有後端測試綠。

- [ ] **Step 1: 在 `src/server.ts` 加 import**

靠近 `import { makeObserveSource, ... } from './sourceSystems'`:

```ts
import { listDirs, makeDir } from './dirs'
```

- [ ] **Step 2: 加 `/dirs` 與 `/mkdir` 路由**

在 `/analyze` 路由附近(`app.listen` 之前)插入:

```ts
  // 目錄瀏覽:列某路徑下的子資料夾(path 省略 = 磁碟根視圖)。給新 Agent 選工作目錄用。
  app.get('/dirs', (req, res) => {
    try {
      res.json(listDirs(String(req.query.path ?? '')))
    } catch (err) {
      console.error('[server] /dirs 失敗:', err)
      res.status(400).json({ error: String(err) })
    }
  })

  // 在指定父目錄下建立空資料夾(「建立專案」)。
  app.post('/mkdir', (req, res) => {
    try {
      const parent = String(req.body?.parent ?? '')
      const name = String(req.body?.name ?? '')
      res.json({ path: makeDir(parent, name) })
    } catch (err) {
      console.error('[server] /mkdir 失敗:', err)
      res.status(400).json({ error: String(err) })
    }
  })
```

- [ ] **Step 3: 改 `/new-agent` 帶 cwd**

```ts
  // 回到 Route B control 空白狀態(準備開新 agent);可帶使用者選的工作目錄。
  app.post('/new-agent', (req, res) => {
    const cwd = req.body?.cwd ? String(req.body.cwd) : undefined
    controller.toControl(cwd)
    res.json({ ok: true })
  })
```

- [ ] **Step 4: 改 `/start` 用 controlCwd**

把 `mgr.start(prompt)` 改成 `mgr.start(prompt, controller.controlCwd())`:

```ts
  app.post('/start', (req, res) => {
    if (controller.isObserving()) controller.toControl() // 從觀察切回操控,清空畫面
    const prompt = String(req.body?.prompt ?? '')
    emitUserMessage(prompt)
    mgr.start(prompt, controller.controlCwd())
    res.json({ ok: true })
  })
```

- [ ] **Step 5: 型別檢查 + 後端回歸**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 無錯;既有後端測試全綠。

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: /dirs /mkdir 路由 + /new-agent 帶 cwd + /start 用 controlCwd

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 前端 `DirListing` + `useSession`(newAgent(cwd)/loadDirs/makeDir)

**Files:**
- Modify: `web/src/wireTypes.ts`
- Modify: `web/src/useSession.ts`
- Test: `web/tests/useSession.dirs.test.ts`

**Interfaces:**
- Produces:
  - `interface DirListing { path: string; parent: string | null; drives?: string[]; entries: string[] }`
  - `newAgent(cwd?: string)`;`loadDirs(path): Promise<DirListing>`;`makeDir(parent, name): Promise<string>`

- [ ] **Step 1: 在 `web/src/wireTypes.ts` 檔尾加型別**

```ts
// 目錄瀏覽(GET /dirs、POST /mkdir):鏡射後端 src/dirs.ts
export interface DirListing {
  path: string
  parent: string | null
  drives?: string[]
  entries: string[]
}
```

- [ ] **Step 2: 寫失敗測試 `web/tests/useSession.dirs.test.ts`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../src/useSession'

class FakeWS {
  onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onclose: (() => void) | null = null
  readyState = 1; static OPEN = 1
  constructor(public url: string) {}
  send() {} close() {}
}
const mk = (fetchImpl: any) => renderHook(() => useSession({
  WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl, wsUrl: 'ws://x',
}))

describe('useSession 目錄 API', () => {
  it('newAgent(cwd) → POST /new-agent { cwd }', () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const { result } = mk(fetchImpl)
    act(() => result.current.newAgent('C:/work'))
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/new-agent')
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ cwd: 'C:/work' })
  })

  it('loadDirs(path) → GET /dirs?path=… 回 listing', async () => {
    const listing = { path: 'C:/p', parent: 'C:/', entries: ['a'] }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(listing) })
    const { result } = mk(fetchImpl)
    let got: any
    await act(async () => { got = await result.current.loadDirs('C:/p') })
    expect(got).toEqual(listing)
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).startsWith('/dirs?path='))).toBe(true)
  })

  it('makeDir(parent,name) → POST /mkdir 回新路徑', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ path: 'C:/p/new' }) })
    const { result } = mk(fetchImpl)
    let got: any
    await act(async () => { got = await result.current.makeDir('C:/p', 'new') })
    expect(got).toBe('C:/p/new')
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/mkdir')
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ parent: 'C:/p', name: 'new' })
  })
})
```

- [ ] **Step 3: 執行確認失敗**

Run: `cd web && npx vitest run tests/useSession.dirs.test.ts`
Expected: FAIL —`loadDirs`/`makeDir` 不是 function、`newAgent` 不吃參數。

- [ ] **Step 4: 改 `web/src/useSession.ts`**

檔頂 import 加 `DirListing`:

```ts
import type { Packet, ControlCommand, SessionInfo, SourceSystem, AnalysisTrace, AnalysisResult, DirListing } from './wireTypes'
```

把 `newAgent` 改成帶 cwd,並新增 `loadDirs`/`makeDir`(放在 `newAgent` 附近):

```ts
  const newAgent = useCallback((cwd?: string) => post('/new-agent', cwd ? { cwd } : {}), [post])

  const loadDirs = useCallback(async (path: string): Promise<DirListing> => {
    const res = await doFetch(`/dirs?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error('無法讀取此目錄')
    return res.json()
  }, [doFetch])

  const makeDir = useCallback(async (parent: string, name: string): Promise<string> => {
    const res = await doFetch('/mkdir', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? '建立資料夾失敗')
    return data.path
  }, [doFetch])
```

把三者加入回傳物件:

```ts
  return { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions, analyze, loadDirs, makeDir }
```

- [ ] **Step 5: 執行確認通過**

Run: `cd web && npx vitest run tests/useSession.dirs.test.ts`
Expected: PASS(3 passed)。

- [ ] **Step 6: Commit**

```bash
git add web/src/wireTypes.ts web/src/useSession.ts web/tests/useSession.dirs.test.ts
git commit -m "feat: 前端 DirListing + useSession newAgent(cwd)/loadDirs/makeDir

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `WorkspacePicker` 元件 + 樣式

**Files:**
- Create: `web/src/components/WorkspacePicker.tsx`
- Modify: `web/src/tokens.css`
- Test: `web/tests/WorkspacePicker.test.tsx`

**Interfaces:**
- Consumes: `DirListing`(Task 6)
- Produces: `WorkspacePicker` props `{ initialPath: string; loadDirs: (p) => Promise<DirListing>; makeDir: (parent,name) => Promise<string>; onConfirm: (path: string) => void; onClose: () => void }`

- [ ] **Step 1: 寫失敗測試 `web/tests/WorkspacePicker.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WorkspacePicker } from '../src/components/WorkspacePicker'

const listingFor = (path: string): any => {
  if (path === 'C:/p') return { path: 'C:/p', parent: 'C:/', entries: ['sub'] }
  if (path === 'C:/p/sub') return { path: 'C:/p/sub', parent: 'C:/p', entries: [] }
  if (path === 'C:/') return { path: 'C:/', parent: '', entries: ['p'] }
  return { path, parent: 'C:/', entries: [] }
}

function setup(over: Partial<any> = {}) {
  const loadDirs = vi.fn((p: string) => Promise.resolve(listingFor(p)))
  const makeDir = vi.fn((parent: string, name: string) => Promise.resolve(`${parent}/${name}`))
  const onConfirm = vi.fn(); const onClose = vi.fn()
  render(<WorkspacePicker initialPath="C:/p" loadDirs={loadDirs} makeDir={makeDir} onConfirm={onConfirm} onClose={onClose} {...over} />)
  return { loadDirs, makeDir, onConfirm, onClose }
}

describe('WorkspacePicker', () => {
  it('載入 initialPath 顯示子資料夾', async () => {
    setup()
    expect(await screen.findByText('sub')).toBeInTheDocument()
  })

  it('點子資料夾 → 以新路徑 loadDirs', async () => {
    const { loadDirs } = setup()
    fireEvent.click(await screen.findByText('sub'))
    await waitFor(() => expect(loadDirs).toHaveBeenCalledWith('C:/p/sub'))
  })

  it('「使用這個目錄」→ onConfirm(目前 path)', async () => {
    const { onConfirm } = setup()
    await screen.findByText('sub')
    fireEvent.click(screen.getByRole('button', { name: /使用這個目錄/ }))
    expect(onConfirm).toHaveBeenCalledWith('C:/p')
  })

  it('建資料夾 → 呼叫 makeDir 並進入新目錄', async () => {
    const { makeDir, loadDirs } = setup()
    await screen.findByText('sub')
    fireEvent.change(screen.getByPlaceholderText(/新資料夾名稱/), { target: { value: 'proj' } })
    fireEvent.click(screen.getByRole('button', { name: /建立/ }))
    await waitFor(() => expect(makeDir).toHaveBeenCalledWith('C:/p', 'proj'))
    await waitFor(() => expect(loadDirs).toHaveBeenCalledWith('C:/p/proj'))
  })
})
```

- [ ] **Step 2: 執行確認失敗**

Run: `cd web && npx vitest run tests/WorkspacePicker.test.tsx`
Expected: FAIL —「Cannot find module '../src/components/WorkspacePicker'」。

- [ ] **Step 3: 建 `web/src/components/WorkspacePicker.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { DirListing } from '../wireTypes'

interface Props {
  initialPath: string
  loadDirs: (path: string) => Promise<DirListing>
  makeDir: (parent: string, name: string) => Promise<string>
  onConfirm: (path: string) => void
  onClose: () => void
}

// 跨平台在前端接路徑:base 已以 \ 結尾就不再補分隔符。
function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : base + sep + name
}

// 新 Agent 的工作目錄選擇器:後端列目錄,前端導覽 + 建資料夾 + 確認。
export function WorkspacePicker({ initialPath, loadDirs, makeDir, onConfirm, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [mkErr, setMkErr] = useState('')

  const go = (path: string) => {
    setError(''); setMkErr('')
    loadDirs(path).then(setListing).catch(() => { setListing(null); setError('無法讀取此目錄') })
  }
  useEffect(() => { go(initialPath) }, [initialPath])

  const atDrives = !!listing?.drives // 磁碟根視圖:不能建資料夾/確認,需先選磁碟機
  const create = () => {
    if (!listing || atDrives || !newName.trim()) return
    makeDir(listing.path, newName.trim())
      .then((path) => { setNewName(''); go(path) })
      .catch((e) => setMkErr(String(e?.message ?? e)))
  }

  return (
    <div className="scrim open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wpick" role="dialog" aria-label="選擇工作目錄">
        <div className="wpick-head">
          <span className="wpick-title">選擇新 Agent 的工作目錄</span>
          <button className="am-close" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        <div className="wpick-crumb">{atDrives ? '此電腦' : (listing?.path || '載入中…')}</div>
        <div className="wpick-list">
          {error && <div className="wpick-error">{error}</div>}
          {listing && listing.parent !== null && (
            <button className="wpick-row up" onClick={() => go(listing.parent as string)}>.. 上一層</button>
          )}
          {listing?.drives?.map((d) => (
            <button key={d} className="wpick-row" onClick={() => go(d)}>{d}</button>
          ))}
          {listing?.entries.map((name) => (
            <button key={name} className="wpick-row" onClick={() => go(joinPath(listing.path, name))}>{name}</button>
          ))}
          {listing && !atDrives && listing.entries.length === 0 && !error && (
            <div className="wpick-empty">(沒有子資料夾)</div>
          )}
        </div>
        <div className="wpick-new">
          <input placeholder="新資料夾名稱…" value={newName}
                 onChange={(e) => setNewName(e.target.value)} disabled={!listing || atDrives} />
          <button onClick={create} disabled={!listing || atDrives || !newName.trim()}>＋建立</button>
        </div>
        {mkErr && <div className="wpick-error">{mkErr}</div>}
        <div className="wpick-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!listing || atDrives}
                  onClick={() => listing && !atDrives && onConfirm(listing.path)}>使用這個目錄</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 在 `web/src/tokens.css` 檔尾加樣式**

```css
/* ── 工作目錄選擇器 ── */
.wpick { width: min(560px, 100%); max-height: 82vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 14px; box-shadow: var(--shadow-lift); overflow: hidden; }
.wpick-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.wpick-title { font-size: 15px; font-weight: 660; color: var(--fg); flex: 1; }
.wpick-crumb { padding: 8px 16px; font-family: var(--mono); font-size: 12px; color: var(--fg-muted); background: var(--surface-2); border-bottom: 1px solid var(--border); white-space: nowrap; overflow-x: auto; }
.wpick-list { flex: 1; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; min-height: 160px; }
.wpick-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--fg); cursor: pointer; font: inherit; font-size: 13px; }
.wpick-row:hover { background: var(--surface-2); border-color: var(--border); }
.wpick-row.up { color: var(--fg-muted); font-family: var(--mono); }
.wpick-row::before { content: "📁"; font-size: 13px; }
.wpick-row.up::before { content: "↰"; }
.wpick-empty { color: var(--fg-faint); font-size: 13px; text-align: center; padding: 24px; }
.wpick-error { color: var(--st-error); font-size: 12.5px; padding: 6px 10px; }
.wpick-new { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
.wpick-new input { flex: 1; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--fg); font: inherit; font-size: 13px; padding: 7px 10px; outline: none; }
.wpick-new input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); background: var(--surface); }
.wpick-new button { border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--fg-muted); font: inherit; font-size: 13px; font-weight: 600; padding: 0 12px; cursor: pointer; }
.wpick-new button:disabled { opacity: .5; cursor: not-allowed; }
.wpick-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--border); }
.wpick-foot .btn { height: 38px; padding: 0 16px; justify-content: center; }
.btn-ghost { background: var(--surface); color: var(--fg-muted); border-color: var(--border); }
.btn-ghost:hover { border-color: var(--border-strong); color: var(--fg); }
```

- [ ] **Step 5: 執行確認通過**

Run: `cd web && npx vitest run tests/WorkspacePicker.test.tsx`
Expected: PASS(4 passed)。

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorkspacePicker.tsx web/src/tokens.css web/tests/WorkspacePicker.test.tsx
git commit -m "feat: WorkspacePicker 目錄選擇器彈窗 + 樣式

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: App 串接(New Agent 開選擇器 → 確認帶 cwd)

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/tests/App.test.tsx`

**Interfaces:**
- Consumes: `WorkspacePicker`(Task 7);`useSession` 的 `newAgent(cwd)`/`loadDirs`/`makeDir`(Task 6)

- [ ] **Step 1: 改既有 App.test「新 Agent」案例並加新流程斷言**

現有測試裡有一段點「新 Agent」後 `expect(bodyOf('/new-agent')).toEqual({})`——新流程改成先開選擇器再確認,故要更新。把該檔 `來源下拉:先選 Claude …` 測試中「點新 Agent → POST /new-agent」那兩行:

```tsx
    fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
    fireEvent.click(await screen.findByText(/新 Agent/))
    expect(bodyOf('/new-agent')).toEqual({})
```

改成(讓 fetch mock 也回 /dirs listing,並走完選擇器):

```tsx
    fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
    fireEvent.click(await screen.findByText(/新 Agent/))
    // 開選擇器 → 使用目前目錄確認 → POST /new-agent { cwd }
    fireEvent.click(await screen.findByRole('button', { name: /使用這個目錄/ }))
    await waitFor(() => expect(bodyOf('/new-agent')).toEqual({ cwd: 'C:/here' }))
```

並把該測試的 `fetchImpl` 補上 `/dirs` 回應與 snapshot 的 workspace。具體:此測試 `renderApp()` 後 `push(snapshot())` 改成 `push(snapshot({ workspace: 'C:/here' }))`,且 `fetchImpl` 內加:

```tsx
      if (path.startsWith('/dirs')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: 'C:/here', parent: 'C:/', entries: [] }) })
```

> `waitFor`、`snapshot(over)` 這些既有 helper 已在檔案內,沿用即可。

- [ ] **Step 2: 執行確認失敗**

Run: `cd web && npx vitest run tests/App.test.tsx`
Expected: FAIL —點「新 Agent」不再直接 POST /new-agent,找不到「使用這個目錄」按鈕。

- [ ] **Step 3: 改 `web/src/App.tsx`**

3a. import 選擇器:

```ts
import { WorkspacePicker } from './components/WorkspacePicker'
```

3b. 取新方法:把 `useSession(deps)` 解構末尾加 `loadDirs, makeDir`:

```ts
  const { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions, analyze, loadDirs, makeDir } = useSession(deps)
```

3c. 加 picker 開關 state(放在 `openIndex` state 附近):

```ts
  const [pickerOpen, setPickerOpen] = useState(false)
```

3d. 把傳給 `SourcePicker` 的 `onNewAgent` 改成開選擇器(找到 `<SourcePicker ... onNewAgent={newAgent} ... />`,把 `onNewAgent` 改為):

```tsx
        <SourcePicker mode={state.mode} onObserve={observe} onNewAgent={() => setPickerOpen(true)} loadSessions={loadSessions} />
```

3e. 在 `<ApprovalModal .../>` 附近(彈窗群)加上選擇器:

```tsx
      {pickerOpen && (
        <WorkspacePicker
          initialPath={state.workspace}
          loadDirs={loadDirs}
          makeDir={makeDir}
          onConfirm={(cwd) => { newAgent(cwd); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
```

- [ ] **Step 4: 執行確認通過 + 全前端 + tsc**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: 全前端測試綠、tsc 無錯。

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/tests/App.test.tsx
git commit -m "feat: App 串接 WorkspacePicker(New Agent 開選擇器 → 確認帶 cwd)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: E2E 瀏覽器驗證 + 文件

**Files:**
- Modify: `README.md`、`README.zh-TW.md`、`NOTES.md`

- [ ] **Step 1: 啟動前後端**

```bash
npm run dev            # 後端 :3001
cd web && npm run dev  # 前端 :5173
```

- [ ] **Step 2: 用 Playwright MCP 走一遍**

驗證清單:
1. 點來源下拉「＋新 Agent」→ 彈出工作目錄選擇器,停在目前工作目錄、列出子資料夾。
2. 點子資料夾進去、`.. 上一層`回上層;Windows 可一路上到磁碟機清單、點磁碟機進入。
3. 輸入新資料夾名稱 → ＋建立 → 進入該新資料夾;重複名稱/非法名 → 顯示紅字錯誤。
4. 「使用這個目錄」→ 關窗、header 的 workspace 立即變成選的路徑。
5. 送出一個任務(例:`用 Bash 執行 pwd 回報`)→ 核准 → 結果的 cwd 是所選目錄。
6. 觀察模式不受影響(來源下拉切觀察一切如常)。

- [ ] **Step 3: 更新 `README.md`**

在 Control mode「Setting the agent's working directory」段落補一段(英文):

```markdown
**Or pick it in the UI:** open the source dropdown → **＋ New Agent** now opens a **directory picker** —
browse folders (breadcrumb + parent + drive roots on Windows), optionally create a new empty folder, and
click **"使用這個目錄"** to launch the next agent with that folder as its working directory. `AGENT_WORKSPACE`
becomes the default the picker starts from. (Control mode only; observe mode is unchanged.)
```

- [ ] **Step 4: 更新 `README.zh-TW.md`**

在對應「設定 agent 工作目錄」段落補一段(繁中):

```markdown
**或在 UI 直接選:** 開來源下拉 →「**＋新 Agent**」現在會彈出**工作目錄選擇器** —— 麵包屑導覽、上一層、
Windows 磁碟根,還能當場建立空資料夾,按「**使用這個目錄**」就用該資料夾當下一個 agent 的工作目錄。
`AGENT_WORKSPACE` 變成選擇器的起始預設。(僅控制模式;觀察模式不變。)
```

- [ ] **Step 5: 更新 `NOTES.md`**

檔尾新增一節:

```markdown
## 新 Agent 工作目錄選擇器(2026-07-21)

- 開新 Agent 時用 UI 選(或當場建立)資料夾當 cwd,取代只能靠 AGENT_WORKSPACE 環境變數。
- **為何後端列目錄**:瀏覽器安全機制不給網頁真實路徑(showDirectoryPicker 只給沙箱 handle、
  webkitdirectory 只給相對路徑),而 agent 在後端啟動需要真實 cwd,故後端 `GET /dirs` 列子資料夾、
  前端 `WorkspacePicker` 導覽選取。
- cwd 穿線:buildOptions/realRunQuery/SessionManager.start/SourceController.toControl 都加 cwd?,
  無值回退 resolveWorkspace();AGENT_WORKSPACE 降為預設。
- `POST /mkdir` 建空資料夾(只 mkdir,不 scaffold);name 防呆(不含分隔符 / 非 . ..)。
- 只動控制模式;觀察模式不碰。
- 不做(YAGNI):最近目錄、scaffold/git init、路徑沙箱、header 隨時改目錄。
```

- [ ] **Step 6: Commit**

```bash
git add README.md README.zh-TW.md NOTES.md
git commit -m "docs: 新 Agent 工作目錄選擇器說明(README 中/英 + NOTES)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 後端 `listDirs`/`makeDir` + `DirListing` → Task 1-2 ✓
- cwd 穿線(agentAdapter/sessionManager)→ Task 3 ✓
- `SourceController.toControl(cwd)`/`controlCwd()` → Task 4 ✓
- server `/dirs`、`/mkdir`、`/new-agent { cwd }`、`/start` 用 controlCwd → Task 5 ✓
- 前端型別 + `useSession`(newAgent(cwd)/loadDirs/makeDir)→ Task 6 ✓
- `WorkspacePicker` + 樣式 → Task 7 ✓
- SourcePicker「新 Agent」開選擇器 + App 串接 → Task 8 ✓
- 錯誤處理(後端 400 + 印 error;前端 loadDirs/makeDir 錯誤呈現)→ Task 5/6/7 ✓
- 磁碟根/POSIX 處理 → Task 1(listDirs)+ Task 7(atDrives 停用確認/建立)✓
- E2E + 文件 → Task 9 ✓
- 不做清單 → 全程未觸及 ✓

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 均有完整程式碼與指令。

**3. Type consistency:**
- `DirListing` 前後端欄位一致(Task 1 / Task 6)。
- `cwd?: string` 在 `RunQuery`/`buildOptions`/`realRunQuery`/`start`/`toControl` 命名一致(Task 3/4)。
- `WorkspacePicker` props 在 Task 7 定義、Task 8 傳入一致(`initialPath`/`loadDirs`/`makeDir`/`onConfirm`/`onClose`)。
- `newAgent(cwd?)` 簽章變更:Task 6 改、Task 8(App)呼叫端一致;SourcePicker 的 `onNewAgent` 改由 App 接成開選擇器,不再直接呼叫 newAgent。
- `controlCwd()` 在 Task 4 定義、Task 5(server /start)使用一致。

> Task 8 會改到 `App.test.tsx` 既有「新 Agent → POST /new-agent {}」斷言(流程從「立即 POST」變成「開選擇器 → 確認才 POST { cwd }」),已在 Task 8 Step 1 明確說明改法,非遺漏。
