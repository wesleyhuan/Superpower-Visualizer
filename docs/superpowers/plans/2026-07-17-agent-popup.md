# Agents 面板改版(清單 + 彈窗)Implementation Plan

> REQUIRED SUB-SKILL:superpowers:executing-plans。純前端,全程 TDD、頻繁 commit。

**Goal:** 左側 Agents 從行內展開改成清單 + 置中彈窗(想法→動作→結果;subagent 同窗切換;← → 導覽帶位置文字)。

**Tech Stack:** React + TS、vitest + jsdom + @testing-library/react。設計出處:`docs/superpowers/specs/2026-07-17-agent-popup-design.md`。

## Global Constraints
- 後端 / 資料流不動。沿用 tokens.css 變數與 `min-width:0` / `overflow-wrap:anywhere` 防爆規則。
- commit 訊息結尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## Task 1:flattenAgents(純函式)

**Files:** Modify `web/src/buildAgentBlocks.ts`;Test `web/tests/buildAgentBlocks.test.ts`

**Interfaces (Produces):**
```ts
export interface AgentEntry {
  key: string; title: string; kind: 'main' | 'sub'; status: NodeStatus
  steps: number; reason?: string; items: TreeNode[]; subKeys: string[]
}
export function flattenAgents(main: AgentBlock, mainTitle: string): AgentEntry[]
```

- [ ] **Step 1:** 在 `web/tests/buildAgentBlocks.test.ts` 加失敗測試:
```ts
import { flattenAgents } from '../src/buildAgentBlocks'
// … 用既有 buildAgentBlocks 造 main(含巢狀 subagent)…
it('flattenAgents:main 在前、深度優先、帶 steps/subKeys/reason', () => {
  const state = { nodes: {
    a: { id:'a', parentId:null, type:'tool', label:'Bash', status:'done' },
    s1:{ id:'s1', parentId:null, type:'subagent', label:'sub1', status:'running', reason:'派它' },
    g: { id:'g', parentId:'s1', type:'tool', label:'Grep', status:'done' },
  }, order:['a','s1','g'] }
  const { main } = buildAgentBlocks(state)
  const flat = flattenAgents(main, '主任務')
  expect(flat.map(e => e.key)).toEqual(['main','s1'])
  expect(flat[0]).toMatchObject({ kind:'main', title:'主任務', steps:2, subKeys:['s1'] })
  expect(flat[1]).toMatchObject({ kind:'sub', title:'sub1', reason:'派它', steps:1, subKeys:[] })
})
```
- [ ] **Step 2:** 跑 `cd web && npm test -- buildAgentBlocks`,預期 FAIL。
- [ ] **Step 3:** 實作 `flattenAgents`:
```ts
export interface AgentEntry {
  key: string; title: string; kind: 'main' | 'sub'; status: NodeStatus
  steps: number; reason?: string; items: TreeNode[]; subKeys: string[]
}

export function flattenAgents(main: AgentBlock, mainTitle: string): AgentEntry[] {
  const out: AgentEntry[] = []
  const visit = (block: AgentBlock, title: string, kind: 'main' | 'sub') => {
    out.push({
      key: block.id ?? 'main',
      title,
      kind,
      status: block.status,
      steps: block.items.length + block.children.length,
      reason: block.node?.reason,
      items: block.items,
      subKeys: block.children.map((c) => c.id as string),
    })
    for (const c of block.children) visit(c, c.node?.label ?? '(subagent)', 'sub')
  }
  visit(main, mainTitle, 'main')
  return out
}
```
- [ ] **Step 4:** 跑測試,預期 PASS。
- [ ] **Step 5:** Commit(`feat: flattenAgents 把區塊樹攤平成有序 agent 清單`)。

---

## Task 2:AgentList(左側清單)

**Files:** Create `web/src/components/AgentList.tsx`;Test `web/tests/AgentList.test.tsx`

**Interfaces (Consumes):** `AgentEntry`(Task 1)。**Produces:** `<AgentList entries onOpen />`,`onOpen: (index: number) => void`。

- [ ] **Step 1:** 失敗測試:
```ts
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentList } from '../src/components/AgentList'
const entries = [
  { key:'main', title:'重構登入', kind:'main', status:'running', steps:3, items:[], subKeys:['s1'] },
  { key:'s1', title:'研究結構', kind:'sub', status:'done', steps:2, items:[], subKeys:[] },
]
it('渲染每個 agent 一列,點某列 → onOpen(index)', () => {
  const onOpen = vi.fn()
  render(<AgentList entries={entries as any} onOpen={onOpen} />)
  expect(screen.getByText('重構登入')).toBeInTheDocument()
  expect(screen.getByText('研究結構')).toBeInTheDocument()
  fireEvent.click(screen.getByText('研究結構'))
  expect(onOpen).toHaveBeenCalledWith(1)
})
```
- [ ] **Step 2:** 跑測試 FAIL。
- [ ] **Step 3:** 實作 `AgentList.tsx`:一個 `.agent-list`,每個 entry 一個 `<button class="arow">`(avatar main=★/sub=▸、名字、`ab-kind` 標籤、狀態 chip、meta `${steps} 步 · ${subKeys.length} subagent`、右側 ▸)。`onClick={() => onOpen(i)}`。狀態 chip 用 `st-dot ${status}` + STATUS_LABEL。
- [ ] **Step 4:** 測試 PASS。
- [ ] **Step 5:** Commit(`feat: AgentList 左側 agent 清單(點列開窗)`)。

---

## Task 3:AgentModal(彈窗 + 時間軸 + 導覽)

**Files:** Create `web/src/components/AgentModal.tsx`;Test `web/tests/AgentModal.test.tsx`

**Interfaces (Consumes):** `AgentEntry[]`、`outputByNode`。**Produces:**
`<AgentModal entries index outputByNode onIndex onClose />`,`onIndex:(i:number)=>void`、`onClose:()=>void`。
`WorkItem` / `ReasonLine` / `itemKind` / `firstLine` 從舊 `AgentBlocks.tsx` 搬進本檔(同實作)。

- [ ] **Step 1:** 失敗測試(涵蓋:標題+位置、工作項目、reason、chip 切換、← →、Esc/✕/scrim 關、頭尾停用):
```ts
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentModal } from '../src/components/AgentModal'
const entries = [
  { key:'main', title:'重構登入', kind:'main', status:'running', steps:1,
    items:[{ id:'b', parentId:null, type:'tool', label:'Bash: ls', status:'done', reason:'先看結構' }], subKeys:['s1'] },
  { key:'s1', title:'研究結構', kind:'sub', status:'done', steps:1,
    items:[{ id:'g', parentId:'s1', type:'tool', label:'Grep: auth', status:'done' }], subKeys:[] },
]
const setup = (index=0) => {
  const onIndex = vi.fn(); const onClose = vi.fn()
  render(<AgentModal entries={entries as any} index={index} outputByNode={{ b:'空目錄\n更多' }} onIndex={onIndex} onClose={onClose} />)
  return { onIndex, onClose }
}
it('顯示目前 agent 標題、位置 1/2、工作項目與 reason、結果摘要', () => {
  setup(0)
  expect(screen.getByText('重構登入')).toBeInTheDocument()
  expect(screen.getByText('1 / 2')).toBeInTheDocument()
  expect(screen.getByText('Bash: ls')).toBeInTheDocument()
  expect(screen.getByText('先看結構')).toBeInTheDocument()
  expect(screen.getByText('空目錄')).toBeInTheDocument()
})
it('點 subagent chip → onIndex(1)', () => {
  const { onIndex } = setup(0)
  fireEvent.click(screen.getByText('研究結構')) // chip
  expect(onIndex).toHaveBeenCalledWith(1)
})
it('→ 下一個 → onIndex(1);第 0 個時 ← 停用', () => {
  const { onIndex } = setup(0)
  fireEvent.click(screen.getByLabelText('下一個 agent'))
  expect(onIndex).toHaveBeenCalledWith(1)
  expect(screen.getByLabelText('上一個 agent')).toBeDisabled()
})
it('Esc / ✕ → onClose', () => {
  const { onClose } = setup(0)
  fireEvent.keyDown(document, { key:'Escape' })
  fireEvent.click(screen.getByLabelText('關閉'))
  expect(onClose).toHaveBeenCalledTimes(2)
})
```
- [ ] **Step 2:** 跑測試 FAIL。
- [ ] **Step 3:** 實作 `AgentModal.tsx`:
  - 外層 `.scrim`(點自身 → onClose);內層 `.modal`。
  - `useEffect` 綁 `keydown`:`Escape`→onClose、`ArrowLeft`→前一個(若非頭)、`ArrowRight`→後一個(若非尾)。
  - 頭部:avatar、標題 `cur.title`、`s`(狀態 + `${cur.steps} 步`)、右側 `${index+1} / ${entries.length}`、`←`(`aria-label="上一個 agent"`,index===0 時 `disabled`)、`→`(`aria-label="下一個 agent"`,index===last 時 `disabled`)、`✕`(`aria-label="關閉"`)。
  - subagent chip 列:`cur.subKeys.map(k => 找 entries 中該 key 的 entry)`,每個 `<button class="subchip" onClick={() => onIndex(entries.findIndex(e=>e.key===k))}>`,顯示 `st-dot` + 該 entry.title。
  - body:`工作項目 · 想法 → 動作 → 結果` 標籤 + `cur.items.map` → `.step`(reason 行 + WorkItem)。沿用 `.wreason` / WorkItem 樣式類名。
- [ ] **Step 4:** 測試 PASS。
- [ ] **Step 5:** Commit(`feat: AgentModal 彈窗(時間軸 + subagent chip + ← → 導覽)`)。

---

## Task 4:CSS(清單列 + 彈窗)

**Files:** Modify `web/src/tokens.css`

- [ ] **Step 1:** 移除不再用的 `.agent-block` 行內展開相關樣式(`.agent-block / .ab-* / .subgroup / .subassign / .assign-chip / .work / .wstep` 中僅行內展開專用者;`.witem* / .wreason / .wsum / .dump / .st-dot / .wkind` 保留給彈窗)。
- [ ] **Step 2:** 從 mockup 移植樣式(改用既有 tokens):`.agent-list`、`.arow`(hover、avatar main/sub、name、ab-kind 標籤、chip、meta、go)、`.scrim`(open 動畫)、`.modal`、`.mhead`(avatar/htext/位置/nav 按鈕/close)、`.msub` + `.subchip`、`.mbody` + `.step` + `.rail`。含 `@media(max-width)` 讓 modal 在窄畫面 `width:100%`。
- [ ] **Step 3:** 驗證 `min-width:0` 鏈在 `.mhead / .action .lbl / .wreason / .wsum` 都在(防版面爆)。
- [ ] **Step 4:** Commit(`style: agent 清單列 + 彈窗樣式(沿用 tokens、明暗兩色)`)。

---

## Task 5:接進 App + 移除舊 AgentBlocks

**Files:** Modify `web/src/App.tsx`;Delete `web/src/components/AgentBlocks.tsx`、`web/tests/AgentBlocks.test.tsx`;Modify `web/tests/App.test.tsx`

**Interfaces (Consumes):** `flattenAgents`、`AgentList`、`AgentModal`。

- [ ] **Step 1:** 改 `App.test.tsx` 既有「事件流會渲染對話與 agent 區塊」測試:`Bash: ls` 從內嵌改為「點該 agent 列後在彈窗出現」。跑測試 FAIL。
- [ ] **Step 2:** 改 `App.tsx`:
  - `const entries = useMemo(() => flattenAgents(main, mainTitle), [main, mainTitle])`。
  - `const [openIndex, setOpenIndex] = useState<number | null>(null)`。
  - 面板 body:`entries` 空 → 現有 empty;否則 `<AgentList entries={entries} onOpen={setOpenIndex} />`。
  - `openIndex !== null && <AgentModal entries={entries} index={openIndex} outputByNode={outputs} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />`。
  - 移除 `import { AgentBlocks }`;`subCount` 仍用 `main.children.length`。
- [ ] **Step 3:** 刪 `AgentBlocks.tsx` 與 `AgentBlocks.test.tsx`(內容已搬進 AgentModal;測試由 AgentModal/AgentList 覆蓋)。
- [ ] **Step 4:** 跑 `cd web && npm test` 全綠、`npx tsc --noEmit` 乾淨。
- [ ] **Step 5:** Commit(`feat: App 用 AgentList + AgentModal 取代行內 AgentBlocks`)。

---

## Task 6:瀏覽器驗證 + 文件

- [ ] **Step 1:** 啟動前後端,操控模式跑一個小任務(或觀察一個 Antigravity 對話),確認:清單列出 agent、點列開窗、時間軸/reason 正確、chip 切 subagent、← → 有位置文字、Esc/✕/scrim 關、明暗主題、版面不爆。用 Playwright 截圖。
- [ ] **Step 2:** README(中/英)「讀左側 Agents 面板」一節改寫為清單 + 彈窗;NOTES 補一句改版。
- [ ] **Step 3:** Commit(`docs: Agents 面板改為清單 + 彈窗的說明`)。

## Self-Review
- 型別一致:`AgentEntry`(Task1)→ AgentList/AgentModal props;`onOpen`/`onIndex`/`onClose` 簽章一致。
- 覆蓋:flatten / list / modal(時間軸+chip+nav+close)/ App 接線 / 樣式 / 驗證,對應 Task 1–6。
- 無 placeholder:核心元件與樣式來源(mockup)明確;WorkItem 等沿用既有實作搬移。
