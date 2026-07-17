# Agents 面板改版:清單 + 彈出式視窗 設計

> 狀態:已核准(依互動 mockup + 使用者三項決定)。純前端。
> 日期:2026-07-17

## 目標

把左側「Agents」面板從「行內展開的區塊」改成「**乾淨的 agent 清單**」;點任一列 → 用**置中彈窗**
攤開那個 agent 的完整 ReAct 步驟(想法 → 動作 → 結果)。後端 / 資料流 / 事件完全不動,只改前端呈現層。

## 已核准的決定(來自 mockup 討論)

1. **不保留行內展開**——細節一律進彈窗;左側清單只負責導覽(名字 / 角色 / 狀態 / 步數 / subagent 數)。
2. **subagent 同視窗切換**——彈窗頂部用 chip 列出該 agent 指派的 subagent,點 chip 在**同一個彈窗**切換內容(不另開窗)。
3. **← / → 導覽**(切換上一個 / 下一個 agent),且要有**顯示文字**讓使用者知道目前在哪個 agent / subagent(名稱 + 位置,如 `2 / 5`)。

## 資料模型

沿用 `buildAgentBlocks(state) → { main }`(main 有 `items` 工具、`children` subagent 區塊,可巢狀)。
新增一個純函式把區塊樹**深度優先攤平**成有序清單:

```ts
// buildAgentBlocks.ts
export interface AgentEntry {
  key: string            // 唯一鍵(主 agent='main';subagent=其 node.id)
  title: string          // 主=mainTitle;sub=node.label
  kind: 'main' | 'sub'
  status: NodeStatus
  steps: number          // items.length + 直屬 children.length
  reason?: string         // subagent「被指派的理由」(main 無)
  items: TreeNode[]       // 該 agent 的工作項目(tool / skill),依 order
  subKeys: string[]       // 直屬 subagent 的 key(給彈窗頂部 chip + 切換)
}

export function flattenAgents(main: AgentBlock, mainTitle: string): AgentEntry[]
```

- 順序:`main` 在最前,接著深度優先展開所有 subagent(與現有巢狀順序一致)。
- 每個 entry 的 `subKeys` 指向它直屬 subagent 的 key;彈窗用 key→index 對照做 chip 切換與導覽。
- `chipInfo`:給 chip 顯示用的 `{ key, title, status }` 可由 flat 陣列查 key 得到(不另存)。

## 元件

| 檔案 | 職責 |
|---|---|
| `buildAgentBlocks.ts` | 加 `AgentEntry` 型別與 `flattenAgents()`(純函式)。 |
| `components/AgentList.tsx` | 左側清單:每列一個 AgentEntry(avatar、名字、角色標籤、狀態 chip、步數/subagent 數、右側 ▸)。`onOpen(index)`。 |
| `components/AgentModal.tsx` | 彈窗:scrim + 置中 dialog。頭部=目前 agent 名稱/狀態/步數 + 位置 `i/n` + ← → + 關閉;subagent chip 列;body=ReAct 時間軸(沿用 WorkItem / ReasonLine)。鍵盤:`Esc` 關、`←/→` 切換。點 scrim 關。 |
| `components/AgentBlocks.tsx` | 移除(行內區塊)。`WorkItem` / `ReasonLine` / `firstLine` / `itemKind` 搬到共用處(`AgentModal` 內或小 `workItem.tsx`),供彈窗重用。 |
| `App.tsx` | 狀態 `openIndex: number \| null`;渲染 `AgentList`,`openIndex !== null` 時渲染 `AgentModal`。面板 head 的節點數維持。 |

## 行為細節

- **左側清單**:main 一列(★ avatar、標籤「主 AGENT」),每個 subagent 一列(▸ avatar、標籤「SUBAGENT」)。
  hover highlight、整列可點。空狀態沿用現有「尚無活動…」。
- **彈窗頭部**:`目前 agent 標題` + 狀態 chip + `步數`;右側「`i / n`」位置 + `←` `→` + `✕`。
  ← / → 在 flat 清單循環(到頭尾就停用或環繞——採**停用**,較好懂)。
- **subagent chip**:只列**目前 agent 的直屬** subagent;點 → 切到該 subagent(`onIndex(indexOf(key))`)。
- **時間軸**:沿用現有 💡 想法(reason)/ 🔧 動作(TOOL/SUB/SKILL/MCP tag + 狀態圓點)/ 結果摘要(輸出第一行)/「▸ 展開輸出」。
- **主題**:沿用 tokens.css 變數;彈窗用 `--scrim` / `--shadow-lift` / `--radius`(mockup 已驗證明暗兩色)。
- **版面**:彈窗與時間軸沿用 `min-width:0` / `overflow-wrap:anywhere` 的既有防爆規則(避免當初左欄被撐爆的坑)。

## 測試(TDD)

- `buildAgentBlocks.test.ts` — `flattenAgents`:main 在前、深度優先、`steps` / `subKeys` / `reason` 正確。
- `AgentList.test.tsx` — 依 entries 渲染列;點某列呼叫 `onOpen(index)`;顯示步數 / subagent 數 / 狀態。
- `AgentModal.test.tsx` — 顯示目前 agent 標題 + `i/n`;渲染工作項目 + reason + 結果摘要;點 subagent chip → `onIndex`;← / → → `onIndex`;`Esc` / scrim / ✕ → `onClose`;頭尾停用 ← 或 →。
- `App.test.tsx` — 面板顯示清單;點 agent 列 → 彈窗出現並顯示其工作項目(原本斷言 `Bash: ls` 內嵌 → 改成點列後在彈窗中出現)。

## 明確排除(YAGNI)

- subagent 另開新窗 / 多窗並列。
- 彈窗內搜尋 / 過濾 / 篩選狀態。
- 清單的排序切換(維持事件順序)。
- 後端任何改動。
