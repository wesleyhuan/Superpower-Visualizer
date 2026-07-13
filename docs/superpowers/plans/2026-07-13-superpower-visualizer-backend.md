# Superpower Visualizer — 後端管線 Implementation Plan (Plan 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個 headless 後端:用 Claude Agent SDK 啟動並驅動一個 agent,把它的 `SDKMessage` 串流翻譯成前端事件,並透過 WebSocket 推播、透過 HTTP 接收暫停/核准/派任務指令。

**Architecture:** 三個單元 — 無狀態純函式 `translate()` 把 SDKMessage 轉成 FrontendEvent;有狀態 `SessionManager` 擁有 agent 生命週期與控制機制(canUseTool 閘門、AbortController、streaming input);`server` 用 WebSocket 推事件(帶 seq)、用 HTTP 收控制指令,並在連線時送出快照。SessionManager 以依賴注入接收 `runQuery`,測試時可注入假的 async generator,不需真的打 API。

**Tech Stack:** Node 20 + TypeScript + `@anthropic-ai/claude-agent-sdk` + `express`(HTTP)+ `ws`(WebSocket)+ `vitest`(測試)。

## Global Constraints

- Node 版本 ≥ 20。
- 全程 TypeScript,`strict: true`。
- 只跑**單一 session**(v1 範圍)。多 session 是後續擴充,現在不設計。
- Debug log 用 Node 慣用機制(先用 `console`,關鍵處帶上下文:函式名、關鍵變數值);try/catch 的 catch 一律印出實際 error 物件,不得靜默吞掉。
- 唯一真相來源在後端;每則推播事件帶單調遞增 `seq`。
- 父子關係一律靠 `SDKMessage.parent_tool_use_id`,不猜。

---

### Task 1: 專案 scaffold + 驗證 spike(釐清 spec 的 5 個待驗證點)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `spike/probe.ts`
- Create: `NOTES.md`

**Interfaces:**
- Consumes: 無(起始任務)。
- Produces: `NOTES.md` 記錄實際觀察到的 `SDKMessage` 形狀,供 Task 3–6 的 fixture 對照。

- [ ] **Step 1: 初始化專案並安裝依賴**

```bash
npm init -y
npm install @anthropic-ai/claude-agent-sdk express ws
npm install -D typescript tsx vitest @types/express @types/ws @types/node
```

- [ ] **Step 2: 建立 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "spike", "tests"]
}
```

- [ ] **Step 3: 建立 vitest.config.ts 與 .gitignore**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

`.gitignore`:
```
node_modules
dist
```

在 `package.json` 的 `"scripts"` 加入:
```json
{ "test": "vitest run", "spike": "tsx spike/probe.ts", "dev": "tsx src/server.ts" }
```

- [ ] **Step 4: 寫 spike 探針,印出每則 SDKMessage 的原始結構**

`spike/probe.ts`:
```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

// 目標:觀察並記錄 5 個待驗證點的實際形狀。
// 需要可用的 Anthropic 憑證(ANTHROPIC_API_KEY 環境變數,或已 `ant auth login` 的 profile 皆可;
// 先用 `ant auth status` 確認)。
async function main() {
  const q = query({
    prompt: '請用 Grep 在目前資料夾找出所有 .ts 檔,然後用一個 subagent 總結你找到什麼。',
    options: {
      // 觀察點 2:canUseTool 的簽名與回傳
      canUseTool: async (toolName, input) => {
        console.log('[canUseTool]', toolName, JSON.stringify(input).slice(0, 200))
        return { behavior: 'allow', updatedInput: input }
      },
    },
  })
  for await (const msg of q) {
    // 觀察點 1/3/4/5:type、parent_tool_use_id、content blocks、skill 呈現方式
    console.log('=== SDKMessage ===')
    console.log(JSON.stringify(msg, null, 2))
  }
}
main().catch((e) => console.error('[spike] error:', e))
```

- [ ] **Step 5: 執行 spike,把觀察寫進 NOTES.md**

Run: `npm run spike`
Expected: 終端機印出一系列 `SDKMessage`。逐一對照並在 `NOTES.md` 記錄以下 5 點的實際欄位:

```markdown
# SDKMessage 觀察筆記(spike 產出)

1. 訊息型別:type 有哪些值(assistant / user / result / system ...)
2. 父子關係:parent_tool_use_id 出現在哪些訊息、值是什麼(subagent 訊息是否帶派它的 Task tool_use id)
3. 工具呼叫:assistant 訊息的 content blocks 裡 tool_use 的欄位(id / name / input)
4. 工具結果:user 訊息裡 tool_result 的欄位(tool_use_id / content / is_error)
5. skill 呈現:呼叫 skill 時是以哪個 tool name 出現(推測為 "Skill"),subagent 是否為 "Task"
6. 中止:AbortController abort 後迴圈如何結束(丟錯 / 收到 result 訊息)
```

> **重要**:若實際欄位名與 Task 3–6 假設的不同(下方 fixture 假設 `parent_tool_use_id`、tool_use 有 `id/name/input`),以 NOTES.md 為準,修正後續任務的 fixture 與型別。

- [ ] **Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold backend + SDKMessage spike"
```

---

### Task 2: 共用型別

**Files:**
- Create: `src/types.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `FrontendEvent`、`TreeNode`、`NodeStatus`、`LogEntry`、`NodeType`、`ControlCommand` 型別,供所有後續任務使用。

- [ ] **Step 1: 定義型別**

`src/types.ts`:
```ts
export type NodeType = 'agent' | 'subagent' | 'skill' | 'tool'
export type NodeStatus =
  | 'running' | 'awaiting' | 'done' | 'error' | 'interrupted' | 'failed'

export interface TreeNode {
  id: string
  parentId: string | null
  type: NodeType
  label: string
  status: NodeStatus
}

export interface LogEntry {
  ts: number
  nodeId: string | null
  text: string
  level: 'info' | 'error'
}

export type FrontendEvent =
  | { kind: 'tree:node'; node: TreeNode }
  | { kind: 'tree:status'; id: string; status: NodeStatus }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'await:tool'; toolUseId: string; name: string; input: unknown }
  | { kind: 'session:error'; message: string }

export type ControlCommand =
  | { type: 'pause' }
  | { type: 'approve'; toolUseId: string; allow: boolean }
  | { type: 'followup'; text: string }
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared FrontendEvent and TreeNode types"
```

---

### Task 3: Translator — tool_use → tree:node + log

**Files:**
- Create: `src/translator.ts`
- Test: `tests/translator.test.ts`

**Interfaces:**
- Consumes: `FrontendEvent`, `NodeType`(from `src/types.ts`)。
- Produces: `translate(msg: any): FrontendEvent[]` — 純函式,無狀態。`toolTypeOf(name: string): NodeType` — 輔助函式,`'Task' → 'subagent'`、`'Skill' → 'skill'`、其餘 `'tool'`。

- [ ] **Step 1: 寫失敗測試**

`tests/translator.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { translate } from '../src/translator'

describe('translate: assistant tool_use', () => {
  it('把一個 Bash tool_use 轉成 tree:node(tool)+ log', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    }
    const events = translate(msg)
    expect(events).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Bash: npm test', status: 'running' },
    })
    expect(events.some((e) => e.kind === 'log')).toBe(true)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/translator.test.ts`
Expected: FAIL — 找不到 `translate`。

- [ ] **Step 3: 寫最小實作**

`src/translator.ts`:
```ts
import type { FrontendEvent, NodeType } from './types'

export function toolTypeOf(name: string): NodeType {
  if (name === 'Task') return 'subagent'
  if (name === 'Skill') return 'skill'
  return 'tool'
}

function labelFor(name: string, input: any): string {
  if (name === 'Bash' && input?.command) return `Bash: ${input.command}`
  if (name === 'Skill' && input?.command) return `skill: ${input.command}`
  if (name === 'Task' && input?.description) return `subagent: ${input.description}`
  return name
}

export function translate(msg: any): FrontendEvent[] {
  const out: FrontendEvent[] = []
  const parentId: string | null = msg?.parent_tool_use_id ?? null

  if (msg?.type === 'assistant') {
    const blocks = msg.message?.content ?? []
    for (const b of blocks) {
      if (b?.type === 'tool_use') {
        const type = toolTypeOf(b.name)
        const label = labelFor(b.name, b.input)
        out.push({ kind: 'tree:node', node: { id: b.id, parentId, type, label, status: 'running' } })
        out.push({ kind: 'log', entry: { ts: Date.now(), nodeId: b.id, text: label, level: 'info' } })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/translator.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/translator.ts tests/translator.test.ts
git commit -m "feat: translate assistant tool_use to tree node"
```

---

### Task 4: Translator — tool_result → tree:status

**Files:**
- Modify: `src/translator.ts`
- Test: `tests/translator.test.ts`(新增測試)

**Interfaces:**
- Consumes: 同 Task 3。
- Produces: `translate` 現在也處理 `type === 'user'` 的 tool_result,產出 `tree:status`(done / error)+ log。

- [ ] **Step 1: 新增失敗測試**

在 `tests/translator.test.ts` 加:
```ts
describe('translate: user tool_result', () => {
  it('成功結果 → tree:status done', () => {
    const msg = {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'ok' }] },
    }
    const events = translate(msg)
    expect(events).toContainEqual({ kind: 'tree:status', id: 'toolu_1', status: 'done' })
  })

  it('is_error 結果 → tree:status error + error log', () => {
    const msg = {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' }] },
    }
    const events = translate(msg)
    expect(events).toContainEqual({ kind: 'tree:status', id: 'toolu_2', status: 'error' })
    expect(events.some((e) => e.kind === 'log' && e.entry.level === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: 執行測試確認新測試失敗**

Run: `npx vitest run tests/translator.test.ts`
Expected: 兩個新測試 FAIL。

- [ ] **Step 3: 在 translate 加入 user 分支**

在 `src/translator.ts` 的 `translate` 內、`assistant` 分支之後加入:
```ts
  if (msg?.type === 'user') {
    const blocks = msg.message?.content ?? []
    for (const b of blocks) {
      if (b?.type === 'tool_result') {
        const isError = !!b.is_error
        out.push({ kind: 'tree:status', id: b.tool_use_id, status: isError ? 'error' : 'done' })
        out.push({
          kind: 'log',
          entry: {
            ts: Date.now(),
            nodeId: b.tool_use_id,
            text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
            level: isError ? 'error' : 'info',
          },
        })
      }
    }
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/translator.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/translator.ts tests/translator.test.ts
git commit -m "feat: translate tool_result to tree status"
```

---

### Task 5: Translator — subagent 父子關係(parent_tool_use_id)

**Files:**
- Modify: `tests/translator.test.ts`(新增測試,驗證既有邏輯已支援)

**Interfaces:**
- Consumes: 同上。
- Produces: 無新函式;確認 `parent_tool_use_id` 正確帶進節點的 `parentId`。

- [ ] **Step 1: 新增測試**

```ts
describe('translate: subagent 掛載', () => {
  it('Task tool_use → subagent 節點', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: '研究登入流程' } }] },
    }
    expect(translate(msg)).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_task', parentId: null, type: 'subagent', label: 'subagent: 研究登入流程', status: 'running' },
    })
  })

  it('subagent 內部的工具帶 parent_tool_use_id → 掛在 subagent 節點下', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_task',
      message: { content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'auth' } }] },
    }
    const node = (translate(msg)[0] as any).node
    expect(node.parentId).toBe('toolu_task')
    expect(node.id).toBe('toolu_grep')
  })
})
```

- [ ] **Step 2: 執行測試**

Run: `npx vitest run tests/translator.test.ts`
Expected: PASS(既有邏輯已支援 `parent_tool_use_id`;若 FAIL,對照 NOTES.md 修正欄位名)。

- [ ] **Step 3: Commit**

```bash
git add tests/translator.test.ts
git commit -m "test: verify subagent parent linkage via parent_tool_use_id"
```

---

### Task 6: Snapshot store(樹狀態 + 日誌緩衝 + seq)

**Files:**
- Create: `src/snapshot.ts`
- Test: `tests/snapshot.test.ts`

**Interfaces:**
- Consumes: `FrontendEvent`, `TreeNode`, `LogEntry`(from `src/types.ts`)。
- Produces: `class SnapshotStore` — `apply(event: FrontendEvent): { seq: number; event: FrontendEvent }`(套用事件、遞增 seq、回傳帶 seq 的封包);`snapshot(): { seq: number; nodes: TreeNode[]; logs: LogEntry[] }`;`logBufferMax = 500`。

- [ ] **Step 1: 寫失敗測試**

`tests/snapshot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SnapshotStore } from '../src/snapshot'

describe('SnapshotStore', () => {
  it('apply tree:node 會加入節點,seq 從 1 遞增', () => {
    const s = new SnapshotStore()
    const r = s.apply({ kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } })
    expect(r.seq).toBe(1)
    expect(s.snapshot().nodes).toHaveLength(1)
    expect(s.snapshot().seq).toBe(1)
  })

  it('apply tree:status 會更新既有節點狀態', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } })
    s.apply({ kind: 'tree:status', id: 'a', status: 'done' })
    expect(s.snapshot().nodes[0].status).toBe('done')
  })

  it('log 會累積在緩衝', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'log', entry: { ts: 1, nodeId: 'a', text: 'hi', level: 'info' } })
    expect(s.snapshot().logs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/snapshot.test.ts`
Expected: FAIL — 找不到 `SnapshotStore`。

- [ ] **Step 3: 寫實作**

`src/snapshot.ts`:
```ts
import type { FrontendEvent, TreeNode, LogEntry } from './types'

export class SnapshotStore {
  private seq = 0
  private nodes = new Map<string, TreeNode>()
  private logs: LogEntry[] = []
  readonly logBufferMax = 500

  apply(event: FrontendEvent): { seq: number; event: FrontendEvent } {
    this.seq += 1
    switch (event.kind) {
      case 'tree:node':
        this.nodes.set(event.node.id, event.node)
        break
      case 'tree:status': {
        const n = this.nodes.get(event.id)
        if (n) n.status = event.status
        break
      }
      case 'log':
        this.logs.push(event.entry)
        if (this.logs.length > this.logBufferMax) this.logs.shift()
        break
    }
    return { seq: this.seq, event }
  }

  snapshot(): { seq: number; nodes: TreeNode[]; logs: LogEntry[] } {
    return { seq: this.seq, nodes: [...this.nodes.values()], logs: [...this.logs] }
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/snapshot.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts tests/snapshot.test.ts
git commit -m "feat: snapshot store with seq, tree state and log buffer"
```

---

### Task 7: SessionManager — 啟動 + onMessage + canUseTool 閘門

**Files:**
- Create: `src/sessionManager.ts`
- Test: `tests/sessionManager.test.ts`

**Interfaces:**
- Consumes: 無(以依賴注入接收 query 執行器)。
- Produces: `class SessionManager`。建構子 `constructor(deps: { runQuery: RunQuery })`,其中
  `type RunQuery = (args: { prompt: AsyncIterable<any>; canUseTool: CanUseTool; signal: AbortSignal }) => AsyncIterable<any>`,
  `type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<{ behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string }>`。
  方法:`start(initialPrompt: string): void`;`onMessage(cb: (m: any) => void): void`;`onAwaitTool(cb: (a: { toolUseId: string; name: string; input: unknown }) => void): void`;`approveTool(toolUseId: string, allow: boolean): void`。內部持有 `pending = new Map<string, (r: any) => void>()`。

> 注:真實接線時 `runQuery` 會包裝 `@anthropic-ai/claude-agent-sdk` 的 `query()`,並把它的 `canUseTool` 回呼橋接到本類別的 canUseTool(toolUseId 取自回呼 context / input;若 SDK 未直接提供 toolUseId,依 NOTES.md 觀察的欄位取得)。測試用假的 runQuery,不打 API。

- [ ] **Step 1: 寫失敗測試(用假 runQuery)**

`tests/sessionManager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { SessionManager } from '../src/sessionManager'

// 一個會呼叫 canUseTool 並在核准後吐出 assistant 訊息的假 runQuery
function fakeRunQuery(): any {
  return ({ canUseTool }: any) => {
    return (async function* () {
      const decision = await canUseTool('Bash', { command: 'ls' }, { toolUseId: 'toolu_x' })
      yield { type: 'result', decision }
    })()
  }
}

describe('SessionManager: canUseTool 閘門', () => {
  it('canUseTool 觸發時發出 await:tool,並在 approve 後 resolve 為 allow', async () => {
    const mgr = new SessionManager({ runQuery: fakeRunQuery() })
    const awaited: any[] = []
    const messages: any[] = []
    mgr.onAwaitTool((a) => awaited.push(a))
    mgr.onMessage((m) => messages.push(m))

    mgr.start('do something')
    await vi.waitFor(() => expect(awaited).toHaveLength(1))
    expect(awaited[0].toolUseId).toBe('toolu_x')

    mgr.approveTool('toolu_x', true)
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0].decision.behavior).toBe('allow')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: FAIL — 找不到 `SessionManager`。

- [ ] **Step 3: 寫實作**

`src/sessionManager.ts`:
```ts
type Decision =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string }
type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>
type RunQuery = (args: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
}) => AsyncIterable<any>

export class SessionManager {
  private pending = new Map<string, (d: Decision) => void>()
  private msgCbs: ((m: any) => void)[] = []
  private awaitCbs: ((a: { toolUseId: string; name: string; input: unknown }) => void)[] = []
  private controller = new AbortController()

  constructor(private deps: { runQuery: RunQuery }) {}

  onMessage(cb: (m: any) => void) { this.msgCbs.push(cb) }
  onAwaitTool(cb: (a: { toolUseId: string; name: string; input: unknown }) => void) { this.awaitCbs.push(cb) }

  private canUseTool: CanUseTool = (toolName, input, ctx) => {
    console.log('[SessionManager] canUseTool gate', toolName, ctx.toolUseId)
    return new Promise<Decision>((resolve) => {
      this.pending.set(ctx.toolUseId, resolve)
      for (const cb of this.awaitCbs) cb({ toolUseId: ctx.toolUseId, name: toolName, input })
    })
  }

  approveTool(toolUseId: string, allow: boolean) {
    const resolve = this.pending.get(toolUseId)
    if (!resolve) { console.log('[SessionManager] approve no-op, unknown', toolUseId); return }
    this.pending.delete(toolUseId)
    resolve(allow ? { behavior: 'allow', updatedInput: undefined } : { behavior: 'deny', message: 'user denied' })
  }

  start(initialPrompt: string) {
    void this.consume(initialPrompt)
  }

  private async *inputGen(initialPrompt: string): AsyncIterable<any> {
    yield { type: 'user', message: { role: 'user', content: initialPrompt } }
  }

  private async consume(initialPrompt: string) {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputGen(initialPrompt),
        canUseTool: this.canUseTool,
        signal: this.controller.signal,
      })
      for await (const msg of stream) {
        for (const cb of this.msgCbs) cb(msg)
      }
    } catch (err) {
      console.error('[SessionManager] consume error:', err)
      for (const cb of this.msgCbs) cb({ type: 'session_error', error: String(err) })
    }
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/sessionManager.ts tests/sessionManager.test.ts
git commit -m "feat: SessionManager start + canUseTool approval gate"
```

---

### Task 8: SessionManager — pause / followup + pending 清理

**Files:**
- Modify: `src/sessionManager.ts`
- Test: `tests/sessionManager.test.ts`(新增測試)

**Interfaces:**
- Consumes: 同 Task 7。
- Produces: `pause(): void`(deny 所有 pending → 清空 → abort);`sendFollowup(text: string): void`(往 input 佇列推新訊息)。內部改用一個可推入的 input 佇列取代 Task 7 的一次性 `inputGen`。

- [ ] **Step 1: 新增失敗測試**

```ts
describe('SessionManager: pause', () => {
  it('pause 會把所有 pending 以 deny resolve 並清空', async () => {
    const mgr = new SessionManager({
      runQuery: ({ canUseTool }: any) => (async function* () {
        const d = await canUseTool('Bash', {}, { toolUseId: 'toolu_p' })
        yield { type: 'result', decision: d }
      })(),
    })
    const messages: any[] = []
    mgr.onMessage((m) => messages.push(m))
    mgr.onAwaitTool(() => {})
    mgr.start('go')
    // 等 pending 建立後 pause
    await new Promise((r) => setTimeout(r, 10))
    mgr.pause()
    const { vi } = await import('vitest')
    await vi.waitFor(() => expect(messages.some((m) => m.decision?.behavior === 'deny')).toBe(true))
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: 新測試 FAIL — `pause` 不存在。

- [ ] **Step 3: 加入 pause / sendFollowup 與可推入的 input 佇列**

在 `src/sessionManager.ts` 的 class 內加入欄位與方法(並移除 Task 7 的 `inputGen`,改用佇列):
```ts
  private inbox: any[] = []
  private inboxResolvers: ((v: any) => void)[] = []

  private pushInput(msg: any) {
    const r = this.inboxResolvers.shift()
    if (r) r({ value: msg, done: false })
    else this.inbox.push(msg)
  }

  private inputQueue(): AsyncIterable<any> {
    const self = this
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<any>> {
            if (self.inbox.length) return Promise.resolve({ value: self.inbox.shift(), done: false })
            return new Promise((resolve) => self.inboxResolvers.push(resolve))
          },
        }
      },
    }
  }

  sendFollowup(text: string) {
    console.log('[SessionManager] followup queued')
    this.pushInput({ type: 'user', message: { role: 'user', content: text } })
  }

  pause() {
    console.log('[SessionManager] pause: denying', this.pending.size, 'pending')
    for (const [, resolve] of this.pending) resolve({ behavior: 'deny', message: 'paused' })
    this.pending.clear()
    this.controller.abort()
  }
```

把 `start` / `consume` 改為使用佇列:
```ts
  start(initialPrompt: string) {
    this.pushInput({ type: 'user', message: { role: 'user', content: initialPrompt } })
    void this.consume()
  }

  private async consume() {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputQueue(),
        canUseTool: this.canUseTool,
        signal: this.controller.signal,
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

> 說明:測試用的假 runQuery 只讀一次 canUseTool 即結束,不消費 input 佇列,因此 pause 測試聚焦在 pending 被 deny。真實 SDK 會持續讀 input 佇列,followup 才會被接續處理。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/sessionManager.ts tests/sessionManager.test.ts
git commit -m "feat: SessionManager pause and followup with input queue"
```

---

### Task 9: 真實 runQuery adapter(接上 Agent SDK)

**Files:**
- Create: `src/agentAdapter.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/claude-agent-sdk` 的 `query`。
- Produces: `realRunQuery: RunQuery` — 把 SDK 的 `query()` 包成 SessionManager 需要的介面。**依 Task 1 的 NOTES.md 對照 canUseTool 回呼實際簽名與 toolUseId 來源**,若 SDK 的 canUseTool context 不含 toolUseId,改由 input 或別的欄位取得(記錄在 NOTES.md)。

- [ ] **Step 1: 寫 adapter**

`src/agentAdapter.ts`:
```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

// RunQuery 型別與 SessionManager 一致(可從 sessionManager.ts 匯出後 import;此處內聯)
export const realRunQuery = ({ prompt, canUseTool, signal }: any): AsyncIterable<any> => {
  return query({
    prompt,
    options: {
      abortController: undefined, // 若 SDK 支援傳入 signal/AbortController,依 NOTES.md 接上
      canUseTool: async (toolName: string, input: any, opts: any) => {
        // toolUseId 來源:優先用 opts 提供的欄位;否則以 input 內的識別。以 NOTES.md 為準修正。
        const toolUseId = opts?.toolUseId ?? opts?.tool_use_id ?? `${toolName}-${Date.now()}`
        return canUseTool(toolName, input, { toolUseId })
      },
    },
  })
}
```

- [ ] **Step 2: 手動煙霧測試(需可用的 Anthropic 憑證:API key 或 `ant auth login` profile)**

在 `src/server.ts` 接線後(Task 10)一起驗證。此步僅確認檔案編譯無誤:

Run: `npx tsc --noEmit`
Expected: 無型別錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/agentAdapter.ts
git commit -m "feat: real runQuery adapter wrapping Agent SDK query()"
```

---

### Task 10: Server — WebSocket 推播(seq + 快照)+ HTTP 控制端點

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `SessionManager`, `SnapshotStore`, `translate`, `realRunQuery`, `ControlCommand`。
- Produces: 一個 express app + ws server。WebSocket 連線時先送 `{ type:'snapshot', ...store.snapshot() }`,之後送 `{ type:'event', seq, event }`。HTTP:`POST /control`(body 為 `ControlCommand`)、`POST /start`(body `{ prompt }`)。匯出 `createServer(deps)` 以便測試注入假的 SessionManager。

- [ ] **Step 1: 寫失敗測試(用假 SessionManager 驗證管線接線)**

`tests/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { wireEvents } from '../src/server'
import { SnapshotStore } from '../src/snapshot'

describe('wireEvents: SessionManager 訊息 → 翻譯 → 快照 → 廣播', () => {
  it('assistant tool_use 訊息會經 translate 進 store 並廣播帶 seq', () => {
    const store = new SnapshotStore()
    const broadcasted: any[] = []
    // 假 mgr:只暴露 onMessage / onAwaitTool
    const handlers: any = {}
    const fakeMgr: any = {
      onMessage: (cb: any) => (handlers.msg = cb),
      onAwaitTool: (cb: any) => (handlers.await = cb),
    }
    wireEvents(fakeMgr, store, (packet) => broadcasted.push(packet))

    handlers.msg({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] },
    })

    expect(broadcasted.some((p) => p.seq === 1 && p.event.kind === 'tree:node')).toBe(true)
    expect(store.snapshot().nodes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL — 找不到 `wireEvents`。

- [ ] **Step 3: 寫 server 與 wireEvents**

`src/server.ts`:
```ts
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { SnapshotStore } from './snapshot'
import { SessionManager } from './sessionManager'
import { translate } from './translator'
import { realRunQuery } from './agentAdapter'
import type { ControlCommand } from './types'

type Packet = { type: 'event'; seq: number; event: unknown }

// 純接線邏輯,方便單元測試
export function wireEvents(
  mgr: { onMessage: (cb: (m: any) => void) => void; onAwaitTool: (cb: (a: any) => void) => void },
  store: SnapshotStore,
  broadcast: (p: Packet) => void,
) {
  mgr.onMessage((msg) => {
    if (msg?.type === 'session_error') {
      const { seq, event } = store.apply({ kind: 'session:error', message: msg.error })
      broadcast({ type: 'event', seq, event })
      return
    }
    for (const ev of translate(msg)) {
      const { seq, event } = store.apply(ev)
      broadcast({ type: 'event', seq, event })
    }
  })
  mgr.onAwaitTool((a) => {
    const { seq, event } = store.apply({ kind: 'await:tool', toolUseId: a.toolUseId, name: a.name, input: a.input })
    broadcast({ type: 'event', seq, event })
  })
}

export function createServer() {
  const app = express()
  app.use(express.json())
  const store = new SnapshotStore()
  const mgr = new SessionManager({ runQuery: realRunQuery })
  const clients = new Set<WebSocket>()

  wireEvents(mgr, store, (packet) => {
    const data = JSON.stringify(packet)
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data)
  })

  app.post('/start', (req, res) => {
    mgr.start(String(req.body?.prompt ?? ''))
    res.json({ ok: true })
  })

  app.post('/control', (req, res) => {
    const cmd = req.body as ControlCommand
    console.log('[server] control', cmd)
    if (cmd.type === 'pause') mgr.pause()
    else if (cmd.type === 'approve') mgr.approveTool(cmd.toolUseId, cmd.allow)
    else if (cmd.type === 'followup') mgr.sendFollowup(cmd.text)
    res.json({ ok: true })
  })

  const server = app.listen(3001, () => console.log('[server] http on :3001'))
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify({ type: 'snapshot', ...store.snapshot() }))
    ws.on('close', () => clients.delete(ws))
  })
  return { app, server, wss }
}

if (require.main === module) createServer()
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS。

- [ ] **Step 5: 型別檢查全專案**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: 端到端手動煙霧測試(需可用的 Anthropic 憑證:API key 或 `ant auth login` profile)**

Run: `npm run dev`,另開終端:
```bash
npx wscat -c ws://localhost:3001            # 觀察事件推播(先收到 snapshot)
curl -X POST localhost:3001/start -H 'content-type: application/json' -d '{"prompt":"用 Grep 找出所有 .ts 檔"}'
curl -X POST localhost:3001/control -H 'content-type: application/json' -d '{"type":"approve","toolUseId":"<從 await:tool 事件複製>","allow":true}'
```
Expected: wscat 依序收到 `tree:node`、`await:tool`、`tree:status` 等帶 seq 的事件;approve 後 agent 繼續。

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: server with WS broadcast, snapshot on connect, control endpoints"
```

---

## Self-Review(對照 spec)

- **spec §1 架構**:Task 2/3/6/7/10 覆蓋三單元與資料流方向 ✓
- **spec §2 元件**:Translator(Task 3–5)、SessionManager(Task 7–9)、傳輸(Task 10)✓;前端在 Plan 2。
- **spec §3 時序**:核准閉環(Task 7 + 10 煙霧測試)、subagent 掛載(Task 5)✓;暫停/派任務(Task 8)✓
- **spec §4 併發**:多工具 pending Map(Task 7)、暫停先 deny(Task 8)、followup 排隊(Task 8)、approve 冪等(Task 7 approveTool no-op)✓;核准框失效與 session 終止的前端行為在 Plan 2。
- **spec §5 韌性**:seq + 快照重連(Task 6 + 10)、SDK 崩潰轉 session:error(Task 7 catch + Task 10 wireEvents)、工具失敗轉 error 節點(Task 4)✓;斷線重連的前端去重在 Plan 2。
- **spec 待驗證清單 5 點**:Task 1 spike 全數涵蓋,並在 Task 9 adapter 標注以 NOTES.md 為準修正 ✓
- **Placeholder 掃描**:無 TBD/TODO;每個 code step 都有實際程式碼 ✓
- **型別一致性**:`FrontendEvent` / `TreeNode` / `NodeStatus` 於 Task 2 定義,Task 3–10 一致引用;`RunQuery` / `CanUseTool` 於 Task 7 定義,Task 9 adapter 對齊 ✓

## 後續(Plan 2)

React 前端:樹狀圖元件、日誌流元件、控制列、WebSocket 客戶端(snapshot + seq 去重重連)、核准框佇列與 session 終止時的失效處理。後端定稿後撰寫。
