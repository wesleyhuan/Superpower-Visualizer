# Superpower Visualizer — React 前端 Implementation Plan (Plan 2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 React 前端:連上後端 WebSocket 接收快照與增量事件(seq 去重、斷線重連),把事件維護成一棵樹 + 一條日誌流,並提供暫停 / 核准 / 派任務的控制列;核准請求以佇列呈現,session 終止時失效所有核准框。

**Architecture:** 前端狀態全由一個**純函式 reducer** `applyPacket(state, packet)` 維護(snapshot 初始化 + seq 去重 + 事件套用),與 UI 完全分離、可獨立 TDD。`useSession` hook 負責 WebSocket 生命週期(含重連)與把控制指令 POST 回後端。元件(Tree / LogStream / ControlBar / ApprovalQueue)是純顯示 + 觸發 hook 提供的動作。

**Tech Stack:** Vite + React 18 + TypeScript + vitest + @testing-library/react + jsdom。前端獨立於 `web/` 子目錄,dev server :5173,透過 WebSocket 連後端 :3001,並以 Vite proxy 轉發 `/start`、`/control`。

## Global Constraints

- 前端獨立於 `web/`,不共用後端的 `package.json` / `tsconfig`。
- 全程 TypeScript,`strict: true`。
- **後端是唯一真相來源**:重連時先吃 snapshot 再吃增量事件;每個增量事件帶 `seq`,前端丟棄 `seq` ≤ 已見者。
- 事件的 wire 形狀必須與後端 `src/types.ts` 的 `FrontendEvent` 一致(Task 2 在 `web/src/wireTypes.ts` 鏡射,若後端型別變動須同步)。
- 只處理**單一 session**(v1 範圍)。
- Debug log 用 `console`,關鍵處(WS open/close/reconnect、seq 落差、控制指令送出)帶上下文。

## 已知限制(v1,需跨計畫後續)

- 後端 snapshot 目前只含 nodes + logs,**不含 pending 核准**(`await:tool` 不進 SnapshotStore)。因此「斷線時剛好有 pending 核准」重連後,前端無法從 snapshot 還原核准框。前端已在 reducer 端做能補的(收到 `await:tool` 時把對應節點標為 `awaiting`),完整修復需回後端讓 snapshot 也序列化 pending。此限制在 Task 5 註記,不阻擋 v1。

---

### Task 1: web/ scaffold(Vite + React + TS + vitest + testing-library)

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/vitest.setup.ts`

**Interfaces:**
- Consumes: 無。
- Produces: 可執行的 `npm run dev`(Vite)、`npm test`(vitest + jsdom)環境;Vite proxy 把 `/start`、`/control` 轉到 `http://localhost:3001`。

- [ ] **Step 1: 在 web/ 初始化並安裝依賴**

```bash
mkdir -p web && cd web
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript vitest jsdom \
  @testing-library/react @testing-library/jest-dom @types/react @types/react-dom
```

- [ ] **Step 2: 建立 vite.config.ts(含 proxy 與 vitest 設定)**

`web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/start': 'http://localhost:3001',
      '/control': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
  },
})
```

- [ ] **Step 3: 建立 tsconfig.json 與 setup / html / entry**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

`web/src/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom'
```

`web/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Superpower Visualizer</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

在 `web/package.json` 的 `scripts` 設為:
```json
{ "dev": "vite", "build": "vite build", "test": "vitest run" }
```

- [ ] **Step 4: 建立最小 App 讓 dev/build 可跑**

`web/src/App.tsx`:
```tsx
export function App() {
  return <div>Superpower Visualizer</div>
}
```

- [ ] **Step 5: 驗證環境**

Run: `cd web && npx vitest run`
Expected: 「No test files found」或 0 失敗(環境可啟動即可)。
Run: `npx tsc --noEmit -p web/tsconfig.json`(從 repo 根)或 `cd web && npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/src/main.tsx web/src/vitest.setup.ts web/src/App.tsx web/package-lock.json
git commit -m "chore: scaffold web frontend (vite + react + vitest)"
```

> 注:`web/node_modules` 已被 repo 根的 `.gitignore`(`node_modules`)排除。

---

### Task 2: wire 型別(鏡射後端 FrontendEvent)

**Files:**
- Create: `web/src/wireTypes.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `NodeType`、`NodeStatus`、`TreeNode`、`LogEntry`、`FrontendEvent`、`ControlCommand`(與後端 `src/types.ts` 一致),外加傳輸封包型別 `Packet`:
  `type SnapshotPacket = { type:'snapshot'; seq:number; nodes:TreeNode[]; logs:LogEntry[] }`;
  `type EventPacket = { type:'event'; seq:number; event:FrontendEvent }`;
  `type Packet = SnapshotPacket | EventPacket`。

- [ ] **Step 1: 建立 wireTypes.ts**

`web/src/wireTypes.ts`:
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

export type SnapshotPacket = { type: 'snapshot'; seq: number; nodes: TreeNode[]; logs: LogEntry[] }
export type EventPacket = { type: 'event'; seq: number; event: FrontendEvent }
export type Packet = SnapshotPacket | EventPacket
```

- [ ] **Step 2: Commit**

```bash
git add web/src/wireTypes.ts
git commit -m "feat: frontend wire types mirroring backend FrontendEvent"
```

---

### Task 3: store reducer — snapshot 初始化 + seq 去重

**Files:**
- Create: `web/src/store.ts`
- Test: `web/tests/store.test.ts`

**Interfaces:**
- Consumes: `Packet`, `TreeNode`, `LogEntry`(from `wireTypes.ts`)。
- Produces:
  `interface SessionState { seq:number; nodes:Record<string,TreeNode>; order:string[]; logs:LogEntry[]; pending:PendingApproval[]; sessionEnded:boolean; errorMessage:string|null }`;
  `interface PendingApproval { toolUseId:string; name:string; input:unknown }`;
  `function initialState(): SessionState`;
  `function applyPacket(state: SessionState, packet: Packet): SessionState`(純函式,回傳新 state)。

- [ ] **Step 1: 寫失敗測試**

`web/tests/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { initialState, applyPacket } from '../src/store'

describe('applyPacket: snapshot 與 seq 去重', () => {
  it('snapshot 會用其 nodes/logs/seq 重設 state', () => {
    const s = applyPacket(initialState(), {
      type: 'snapshot',
      seq: 5,
      nodes: [{ id: 'a', parentId: null, type: 'tool', label: 'x', status: 'done' }],
      logs: [{ ts: 1, nodeId: 'a', text: 'hi', level: 'info' }],
    })
    expect(s.seq).toBe(5)
    expect(s.nodes['a'].status).toBe('done')
    expect(s.logs).toHaveLength(1)
  })

  it('seq ≤ 目前 seq 的事件會被丟棄', () => {
    let s = applyPacket(initialState(), { type: 'snapshot', seq: 5, nodes: [], logs: [] })
    s = applyPacket(s, {
      type: 'event', seq: 5,
      event: { kind: 'tree:node', node: { id: 'z', parentId: null, type: 'tool', label: 'z', status: 'running' } },
    })
    expect(s.nodes['z']).toBeUndefined() // 被去重丟棄
    expect(s.seq).toBe(5)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: FAIL — 找不到 `initialState` / `applyPacket`。

- [ ] **Step 3: 寫最小實作**

`web/src/store.ts`:
```ts
import type { Packet, TreeNode, LogEntry } from './wireTypes'

export interface PendingApproval { toolUseId: string; name: string; input: unknown }

export interface SessionState {
  seq: number
  nodes: Record<string, TreeNode>
  order: string[]
  logs: LogEntry[]
  pending: PendingApproval[]
  sessionEnded: boolean
  errorMessage: string | null
}

export function initialState(): SessionState {
  return { seq: 0, nodes: {}, order: [], logs: [], pending: [], sessionEnded: false, errorMessage: null }
}

export function applyPacket(state: SessionState, packet: Packet): SessionState {
  if (packet.type === 'snapshot') {
    const nodes: Record<string, TreeNode> = {}
    const order: string[] = []
    for (const n of packet.nodes) { nodes[n.id] = n; order.push(n.id) }
    return { seq: packet.seq, nodes, order, logs: [...packet.logs], pending: [], sessionEnded: false, errorMessage: null }
  }
  // event
  if (packet.seq <= state.seq) {
    console.log('[store] drop stale event seq', packet.seq, '<=', state.seq)
    return state
  }
  return { ...state, seq: packet.seq } // 事件套用邏輯在 Task 4/5 補上
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/store.ts web/tests/store.test.ts
git commit -m "feat: frontend store snapshot init and seq dedup"
```

---

### Task 4: store reducer — tree:node / tree:status / log

**Files:**
- Modify: `web/src/store.ts`
- Test: `web/tests/store.test.ts`(新增測試)

**Interfaces:**
- Consumes: 同 Task 3。
- Produces: `applyPacket` 現在處理 `tree:node`(新增/更新節點,維護 `order`)、`tree:status`(更新既有節點 status)、`log`(append,上限 500)。

- [ ] **Step 1: 新增失敗測試**

在 `web/tests/store.test.ts` 加:
```ts
describe('applyPacket: tree/log 事件', () => {
  const withSeq0 = () => initialState()
  it('tree:node 新增節點並記錄順序', () => {
    const s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    expect(s.nodes['a']).toBeDefined()
    expect(s.order).toEqual(['a'])
  })
  it('tree:status 更新既有節點', () => {
    let s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    s = applyPacket(s, { type: 'event', seq: 2, event: { kind: 'tree:status', id: 'a', status: 'done' } })
    expect(s.nodes['a'].status).toBe('done')
  })
  it('log 會 append', () => {
    const s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'log', entry: { ts: 1, nodeId: 'a', text: 'hi', level: 'info' } },
    })
    expect(s.logs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: 3 個新測試 FAIL(事件尚未套用)。

- [ ] **Step 3: 在 applyPacket 補上事件套用**

把 `web/src/store.ts` 內 `// event` 之後的 `return { ...state, seq: packet.seq }` 換成:
```ts
  const next: SessionState = {
    ...state,
    seq: packet.seq,
    nodes: { ...state.nodes },
    order: [...state.order],
    logs: state.logs,
    pending: state.pending,
  }
  const ev = packet.event
  switch (ev.kind) {
    case 'tree:node':
      if (!next.nodes[ev.node.id]) next.order.push(ev.node.id)
      next.nodes[ev.node.id] = ev.node
      break
    case 'tree:status': {
      const n = next.nodes[ev.id]
      if (n) next.nodes[ev.id] = { ...n, status: ev.status }
      break
    }
    case 'log':
      next.logs = [...state.logs, ev.entry].slice(-500)
      break
  }
  return next
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/store.ts web/tests/store.test.ts
git commit -m "feat: frontend store applies tree and log events"
```

---

### Task 5: store reducer — await:tool(pending + awaiting)與 session:error(失效)

**Files:**
- Modify: `web/src/store.ts`
- Test: `web/tests/store.test.ts`(新增測試)

**Interfaces:**
- Consumes: 同上。
- Produces: `applyPacket` 處理 `await:tool`(push 到 `pending`,並把對應 `toolUseId` 的節點 status 設為 `awaiting`)、`session:error`(`sessionEnded=true`、`errorMessage`、清空 `pending`、把 running/awaiting 節點標為 `failed`)。額外匯出 `resolvePending(state, toolUseId): SessionState`(從 pending 移除一筆,供 UI 送出核准後樂觀更新)。

- [ ] **Step 1: 新增失敗測試**

```ts
describe('applyPacket: await:tool 與 session:error', () => {
  it('await:tool 會加入 pending 並把對應節點設 awaiting', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Bash', status: 'running' } },
    })
    s = applyPacket(s, {
      type: 'event', seq: 2,
      event: { kind: 'await:tool', toolUseId: 'toolu_1', name: 'Bash', input: {} },
    })
    expect(s.pending).toHaveLength(1)
    expect(s.nodes['toolu_1'].status).toBe('awaiting')
  })

  it('session:error 會標記 ended、清空 pending、running/awaiting → failed', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    s = applyPacket(s, { type: 'event', seq: 2, event: { kind: 'await:tool', toolUseId: 'a', name: 'x', input: {} } })
    s = applyPacket(s, { type: 'event', seq: 3, event: { kind: 'session:error', message: 'boom' } })
    expect(s.sessionEnded).toBe(true)
    expect(s.errorMessage).toBe('boom')
    expect(s.pending).toHaveLength(0)
    expect(s.nodes['a'].status).toBe('failed')
  })
})

describe('resolvePending', () => {
  it('移除指定 toolUseId 的 pending', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'await:tool', toolUseId: 't1', name: 'x', input: {} },
    })
    s = resolvePending(s, 't1')
    expect(s.pending).toHaveLength(0)
  })
})
```

在該檔 import 行補上 `resolvePending`:
```ts
import { initialState, applyPacket, resolvePending } from '../src/store'
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: 新測試 FAIL。

- [ ] **Step 3: 補上 await:tool / session:error 分支與 resolvePending**

在 `web/src/store.ts` 的 `switch (ev.kind)` 內、`case 'log'` 之後加入:
```ts
    case 'await:tool': {
      next.pending = [...state.pending, { toolUseId: ev.toolUseId, name: ev.name, input: ev.input }]
      const n = next.nodes[ev.toolUseId]
      if (n) next.nodes[ev.toolUseId] = { ...n, status: 'awaiting' }
      break
    }
    case 'session:error': {
      next.sessionEnded = true
      next.errorMessage = ev.message
      next.pending = []
      for (const id of next.order) {
        const n = next.nodes[id]
        if (n && (n.status === 'running' || n.status === 'awaiting')) {
          next.nodes[id] = { ...n, status: 'failed' }
        }
      }
      break
    }
```

在檔案末端加入:
```ts
export function resolvePending(state: SessionState, toolUseId: string): SessionState {
  return { ...state, pending: state.pending.filter((p) => p.toolUseId !== toolUseId) }
}
```

> **已知限制**:snapshot 不含 pending(見計畫頂端),重連時無法還原核准框;此為刻意記錄的 v1 限制,完整修復需後端讓 snapshot 序列化 pending。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/store.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/store.ts web/tests/store.test.ts
git commit -m "feat: frontend store handles await:tool and session:error"
```

---

### Task 6: 樹狀結構建構器(扁平節點 → 巢狀)

**Files:**
- Create: `web/src/buildTree.ts`
- Test: `web/tests/buildTree.test.ts`

**Interfaces:**
- Consumes: `TreeNode`(from `wireTypes.ts`)、`SessionState`。
- Produces: `interface TreeItem { node: TreeNode; children: TreeItem[] }`;`function buildTree(state: { nodes: Record<string,TreeNode>; order: string[] }): TreeItem[]`(依 `parentId` 建巢狀;`parentId===null` 為根;維持 `order` 的插入順序)。

- [ ] **Step 1: 寫失敗測試**

`web/tests/buildTree.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildTree } from '../src/buildTree'
import type { TreeNode } from '../src/wireTypes'

const N = (id: string, parentId: string | null): TreeNode =>
  ({ id, parentId, type: 'tool', label: id, status: 'running' })

describe('buildTree', () => {
  it('把扁平節點依 parentId 建成巢狀,並保留插入順序', () => {
    const nodes = { root: N('root', null), c1: N('c1', 'root'), c2: N('c2', 'root') }
    const order = ['root', 'c1', 'c2']
    const tree = buildTree({ nodes, order })
    expect(tree).toHaveLength(1)
    expect(tree[0].node.id).toBe('root')
    expect(tree[0].children.map((c) => c.node.id)).toEqual(['c1', 'c2'])
  })

  it('parentId 指向不存在的節點時,視為根(不遺失)', () => {
    const nodes = { orphan: N('orphan', 'ghost') }
    const tree = buildTree({ nodes, order: ['orphan'] })
    expect(tree).toHaveLength(1)
    expect(tree[0].node.id).toBe('orphan')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/buildTree.test.ts`
Expected: FAIL — 找不到 `buildTree`。

- [ ] **Step 3: 寫實作**

`web/src/buildTree.ts`:
```ts
import type { TreeNode } from './wireTypes'

export interface TreeItem { node: TreeNode; children: TreeItem[] }

export function buildTree(state: { nodes: Record<string, TreeNode>; order: string[] }): TreeItem[] {
  const items = new Map<string, TreeItem>()
  for (const id of state.order) items.set(id, { node: state.nodes[id], children: [] })

  const roots: TreeItem[] = []
  for (const id of state.order) {
    const item = items.get(id)!
    const parentId = item.node.parentId
    const parent = parentId ? items.get(parentId) : undefined
    if (parent) parent.children.push(item)
    else roots.push(item) // parentId 為 null 或指向不存在節點 → 視為根
  }
  return roots
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/buildTree.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/buildTree.ts web/tests/buildTree.test.ts
git commit -m "feat: buildTree flat-to-nested with order preservation"
```

---

### Task 7: `<Tree>` 元件

**Files:**
- Create: `web/src/components/Tree.tsx`
- Test: `web/tests/Tree.test.tsx`

**Interfaces:**
- Consumes: `TreeItem`(from `buildTree.ts`)。
- Produces: `Tree({ items }: { items: TreeItem[] })` — 遞迴渲染;每個節點顯示 `label`,並以 `data-status` 屬性標示狀態(供樣式與測試)。

- [ ] **Step 1: 寫失敗測試**

`web/tests/Tree.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tree } from '../src/components/Tree'
import type { TreeItem } from '../src/buildTree'

describe('<Tree>', () => {
  it('渲染節點 label 與子節點,並帶 data-status', () => {
    const items: TreeItem[] = [
      {
        node: { id: 'root', parentId: null, type: 'subagent', label: 'subagent: 研究', status: 'running' },
        children: [
          { node: { id: 'c', parentId: 'root', type: 'tool', label: 'Bash: ls', status: 'awaiting' }, children: [] },
        ],
      },
    ]
    render(<Tree items={items} />)
    expect(screen.getByText('subagent: 研究')).toBeInTheDocument()
    const child = screen.getByText('Bash: ls')
    expect(child.closest('[data-status]')?.getAttribute('data-status')).toBe('awaiting')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/Tree.test.tsx`
Expected: FAIL — 找不到 `Tree`。

- [ ] **Step 3: 寫實作**

`web/src/components/Tree.tsx`:
```tsx
import type { TreeItem } from '../buildTree'

const STATUS_ICON: Record<string, string> = {
  running: '⏳', awaiting: '🟡', done: '✅', error: '❌', interrupted: '⚪', failed: '💥',
}

function Node({ item }: { item: TreeItem }) {
  return (
    <li>
      <span data-status={item.node.status} data-type={item.node.type}>
        {STATUS_ICON[item.node.status] ?? '•'} {item.node.label}
      </span>
      {item.children.length > 0 && (
        <ul>{item.children.map((c) => <Node key={c.node.id} item={c} />)}</ul>
      )}
    </li>
  )
}

export function Tree({ items }: { items: TreeItem[] }) {
  return <ul>{items.map((i) => <Node key={i.node.id} item={i} />)}</ul>
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/Tree.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Tree.tsx web/tests/Tree.test.tsx
git commit -m "feat: Tree component recursive render with status"
```

---

### Task 8: `<LogStream>` 元件(含節點過濾)

**Files:**
- Create: `web/src/components/LogStream.tsx`
- Test: `web/tests/LogStream.test.tsx`

**Interfaces:**
- Consumes: `LogEntry`(from `wireTypes.ts`)。
- Produces: `LogStream({ logs, filterNodeId }: { logs: LogEntry[]; filterNodeId?: string | null })` — 依時間順序渲染每條 log;`level==='error'` 帶 `data-level="error"`;若給 `filterNodeId`,只顯示該節點的 log。

- [ ] **Step 1: 寫失敗測試**

`web/tests/LogStream.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogStream } from '../src/components/LogStream'
import type { LogEntry } from '../src/wireTypes'

const logs: LogEntry[] = [
  { ts: 1, nodeId: 'a', text: 'hello', level: 'info' },
  { ts: 2, nodeId: 'b', text: 'boom', level: 'error' },
]

describe('<LogStream>', () => {
  it('渲染所有 log,error 帶 data-level', () => {
    render(<LogStream logs={logs} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('boom').closest('[data-level]')?.getAttribute('data-level')).toBe('error')
  })
  it('filterNodeId 只顯示該節點的 log', () => {
    render(<LogStream logs={logs} filterNodeId="a" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.queryByText('boom')).toBeNull()
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/LogStream.test.tsx`
Expected: FAIL — 找不到 `LogStream`。

- [ ] **Step 3: 寫實作**

`web/src/components/LogStream.tsx`:
```tsx
import type { LogEntry } from '../wireTypes'

export function LogStream({ logs, filterNodeId }: { logs: LogEntry[]; filterNodeId?: string | null }) {
  const shown = filterNodeId ? logs.filter((l) => l.nodeId === filterNodeId) : logs
  return (
    <div>
      {shown.map((l, i) => (
        <div key={i} data-level={l.level}>{l.text}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/LogStream.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/LogStream.tsx web/tests/LogStream.test.tsx
git commit -m "feat: LogStream component with node filter"
```

---

### Task 9: `<ApprovalQueue>` 與 `<ControlBar>` 元件

**Files:**
- Create: `web/src/components/ApprovalQueue.tsx`, `web/src/components/ControlBar.tsx`
- Test: `web/tests/ApprovalQueue.test.tsx`

**Interfaces:**
- Consumes: `PendingApproval`(from `store.ts`)。
- Produces:
  `ApprovalQueue({ pending, onDecide }: { pending: PendingApproval[]; onDecide: (toolUseId: string, allow: boolean) => void })` — 逐筆列出待核准工具,各有「核准 / 拒絕」鈕;
  `ControlBar({ onPause, onFollowup, disabled }: { onPause: () => void; onFollowup: (text: string) => void; disabled: boolean })` — 暫停鈕 + 追加訊息輸入框;`disabled` 為 true(session 結束)時停用。

- [ ] **Step 1: 寫失敗測試**

`web/tests/ApprovalQueue.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalQueue } from '../src/components/ApprovalQueue'

describe('<ApprovalQueue>', () => {
  it('列出每筆 pending,按核准會以 toolUseId + true 回呼', () => {
    const onDecide = vi.fn()
    render(<ApprovalQueue pending={[{ toolUseId: 't1', name: 'Bash', input: { command: 'ls' } }]} onDecide={onDecide} />)
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '核准' }))
    expect(onDecide).toHaveBeenCalledWith('t1', true)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/ApprovalQueue.test.tsx`
Expected: FAIL — 找不到 `ApprovalQueue`。

- [ ] **Step 3: 寫兩個元件**

`web/src/components/ApprovalQueue.tsx`:
```tsx
import type { PendingApproval } from '../store'

export function ApprovalQueue({
  pending, onDecide,
}: { pending: PendingApproval[]; onDecide: (toolUseId: string, allow: boolean) => void }) {
  if (pending.length === 0) return null
  return (
    <div>
      {pending.map((p) => (
        <div key={p.toolUseId} data-tooluseid={p.toolUseId}>
          <span>{p.name}: {JSON.stringify(p.input)}</span>
          <button onClick={() => onDecide(p.toolUseId, true)}>核准</button>
          <button onClick={() => onDecide(p.toolUseId, false)}>拒絕</button>
        </div>
      ))}
    </div>
  )
}
```

`web/src/components/ControlBar.tsx`:
```tsx
import { useState } from 'react'

export function ControlBar({
  onPause, onFollowup, disabled,
}: { onPause: () => void; onFollowup: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('')
  return (
    <div>
      <button onClick={onPause} disabled={disabled}>暫停</button>
      <input
        value={text}
        disabled={disabled}
        placeholder="派新任務…"
        onChange={(e) => setText(e.target.value)}
      />
      <button
        disabled={disabled || text.trim() === ''}
        onClick={() => { onFollowup(text.trim()); setText('') }}
      >送出</button>
    </div>
  )
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/ApprovalQueue.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ApprovalQueue.tsx web/src/components/ControlBar.tsx web/tests/ApprovalQueue.test.tsx
git commit -m "feat: ApprovalQueue and ControlBar components"
```

---

### Task 10: `useSession` hook(WebSocket 連線 + 重連 + 控制 POST)

**Files:**
- Create: `web/src/useSession.ts`
- Test: `web/tests/useSession.test.tsx`

**Interfaces:**
- Consumes: `applyPacket`, `resolvePending`, `initialState`, `SessionState`(from `store.ts`);`ControlCommand`(from `wireTypes.ts`)。
- Produces:
  `function useSession(deps?: { wsUrl?: string; WebSocketImpl?: typeof WebSocket; fetchImpl?: typeof fetch }): { state: SessionState; connected: boolean; pause: () => void; approve: (toolUseId: string, allow: boolean) => void; followup: (text: string) => void; start: (prompt: string) => void }`。
  以依賴注入接收 `WebSocketImpl` 與 `fetchImpl`,測試時注入假物件;預設用瀏覽器全域。控制指令 POST 到 `/control`,`start` POST 到 `/start`;`approve` 送出後樂觀 `resolvePending`。斷線時每 1 秒重連。

- [ ] **Step 1: 寫失敗測試(用假 WebSocket)**

`web/tests/useSession.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSession } from '../src/useSession'

// 極簡假 WebSocket:可手動觸發 onopen / onmessage
class FakeWS {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = 1
  static OPEN = 1
  sent: string[] = []
  constructor(public url: string) { FakeWS.last = this }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  static last: FakeWS | null = null
}

describe('useSession', () => {
  it('收到 snapshot 後更新 state;approve 會 POST /control 並樂觀移除 pending', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as any
    const { result } = renderHook(() =>
      useSession({ WebSocketImpl: FakeWS as any, fetchImpl, wsUrl: 'ws://x' }))

    act(() => { FakeWS.last!.onopen?.() })
    await waitFor(() => expect(result.current.connected).toBe(true))

    // 推一個帶 pending 的事件序列
    act(() => {
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'snapshot', seq: 0, nodes: [], logs: [] }) })
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'event', seq: 1, event: { kind: 'await:tool', toolUseId: 't1', name: 'Bash', input: {} } }) })
    })
    await waitFor(() => expect(result.current.state.pending).toHaveLength(1))

    act(() => { result.current.approve('t1', true) })
    expect(fetchImpl).toHaveBeenCalledWith('/control', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0))
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd web && npx vitest run tests/useSession.test.tsx`
Expected: FAIL — 找不到 `useSession`。

- [ ] **Step 3: 寫實作**

`web/src/useSession.ts`:
```ts
import { useEffect, useRef, useState, useCallback } from 'react'
import { applyPacket, resolvePending, initialState, type SessionState } from './store'
import type { Packet, ControlCommand } from './wireTypes'

interface Deps { wsUrl?: string; WebSocketImpl?: typeof WebSocket; fetchImpl?: typeof fetch }

export function useSession(deps: Deps = {}) {
  const WS = deps.WebSocketImpl ?? WebSocket
  const doFetch = deps.fetchImpl ?? fetch
  const wsUrl = deps.wsUrl ?? `ws://${location.hostname}:3001`

  const [state, setState] = useState<SessionState>(initialState())
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      const ws = new WS(wsUrl)
      wsRef.current = ws
      ws.onopen = () => { console.log('[ws] open'); setConnected(true) }
      ws.onmessage = (e: MessageEvent) => {
        const packet = JSON.parse(e.data) as Packet
        setState((s) => applyPacket(s, packet))
      }
      ws.onclose = () => {
        console.log('[ws] close; reconnecting')
        setConnected(false)
        if (!closedRef.current) timer = setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closedRef.current = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [wsUrl])

  const post = useCallback((path: string, body: unknown) => {
    void doFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [doFetch])

  const control = useCallback((cmd: ControlCommand) => post('/control', cmd), [post])

  const pause = useCallback(() => control({ type: 'pause' }), [control])
  const followup = useCallback((text: string) => control({ type: 'followup', text }), [control])
  const start = useCallback((prompt: string) => post('/start', { prompt }), [post])
  const approve = useCallback((toolUseId: string, allow: boolean) => {
    control({ type: 'approve', toolUseId, allow })
    setState((s) => resolvePending(s, toolUseId)) // 樂觀更新
  }, [control])

  return { state, connected, pause, approve, followup, start }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd web && npx vitest run tests/useSession.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/useSession.ts web/tests/useSession.test.tsx
git commit -m "feat: useSession hook with WS reconnect and control POSTs"
```

---

### Task 11: `<App>` 組裝 + 全套驗證

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useSession`, `buildTree`, `Tree`, `LogStream`, `ApprovalQueue`, `ControlBar`。
- Produces: 完整畫面 — 上方 start 輸入、左樹右日誌、下方核准佇列 + 控制列;`state.sessionEnded` 時顯示錯誤橫幅並停用控制。

- [ ] **Step 1: 寫 App**

`web/src/App.tsx`:
```tsx
import { useState } from 'react'
import { useSession } from './useSession'
import { buildTree } from './buildTree'
import { Tree } from './components/Tree'
import { LogStream } from './components/LogStream'
import { ApprovalQueue } from './components/ApprovalQueue'
import { ControlBar } from './components/ControlBar'

export function App() {
  const { state, connected, pause, approve, followup, start } = useSession()
  const [prompt, setPrompt] = useState('')
  const items = buildTree(state)

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>Superpower Visualizer {connected ? '🟢' : '🔴'}</h1>

      {state.sessionEnded && (
        <div style={{ background: '#fee', padding: 8, marginBottom: 8 }}>
          Session 已結束{state.errorMessage ? `:${state.errorMessage}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ flex: 1 }}
          value={prompt}
          placeholder="輸入初始任務…"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button disabled={prompt.trim() === ''} onClick={() => { start(prompt.trim()); setPrompt('') }}>
          啟動 agent
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}><h3>互動樹</h3><Tree items={items} /></div>
        <div style={{ flex: 1 }}><h3>活動日誌</h3><LogStream logs={state.logs} /></div>
      </div>

      <ApprovalQueue pending={state.pending} onDecide={approve} />
      <ControlBar onPause={pause} onFollowup={followup} disabled={state.sessionEnded} />
    </div>
  )
}
```

- [ ] **Step 2: 型別檢查 + 全套測試**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: `tsc` 無錯誤;所有測試 PASS。

- [ ] **Step 3: 手動端到端(需後端在跑 + Anthropic 憑證)**

啟動兩端:
```bash
# 終端 1(repo 根):後端
npm run dev
# 終端 2:前端
cd web && npm run dev
```
瀏覽器開 `http://localhost:5173`,在輸入框打「用 Grep 找出所有 .ts 檔並用 subagent 總結」→ 按「啟動 agent」。
Expected:樹上長出節點;工具需核准時出現核准框;按核准後繼續;暫停鈕可中止;派新任務可排隊。

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: App wiring tree, log, approval queue, control bar"
```

---

## Self-Review(對照 spec)

- **spec §2③ 前端三塊**:Tree(Task 7)、LogStream(Task 8)、ControlBar/ApprovalQueue(Task 9)✓
- **spec §3 時序**:核准閉環(Task 5 await:tool→awaiting/pending、Task 9 決定鈕、Task 10 approve POST + 樂觀移除)、subagent 掛載(Task 6 buildTree)✓
- **spec §4 併發**:多工具 pending 佇列(Task 5 陣列 + Task 9 逐筆)、核准框於 session 終止失效(Task 5 清空 pending + Task 11 disabled)✓
- **spec §5 韌性**:seq 去重(Task 3)、snapshot 重連(Task 3 + Task 10)、斷線 1 秒重連(Task 10)、session:error 橫幅 + 節點轉 failed(Task 5 + Task 11)✓
- **Placeholder 掃描**:無 TBD/TODO;每個 code step 皆有實際程式碼 ✓
- **型別一致性**:`wireTypes.ts`(Task 2)於全前端一致引用;`SessionState`/`PendingApproval`(Task 3/5)於 Task 9/10/11 一致 ✓
- **已知限制**:snapshot 不含 pending → 重連時 pending 核准無法還原(Task 5 註記,需後端後續)

## 完成後

前端 + 後端皆到位。真正的端到端閉環(Task 11 Step 3、後端 Plan 1 的 spike 與 E2E)需 Anthropic 憑證;備妥後一次跑通,並依 spike 觀察校正 `NOTES.md` 與 SDK 邊界(`agentAdapter.ts` 的 abort/toolUseId)。
