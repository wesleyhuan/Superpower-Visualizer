import type { TreeNode, NodeStatus } from './wireTypes'
import type { AnalysisTrace, AnalysisStep } from './wireTypes'

// 一個 agent 區塊:主 agent(node=null)或某個 subagent 節點。
export interface AgentBlock {
  id: string | null          // null = 主 agent
  node: TreeNode | null      // subagent 節點(主 agent 為 null)
  status: NodeStatus         // 主 agent 由所有節點推導;subagent 用其節點狀態
  items: TreeNode[]          // 非 subagent 的工作項目(tool / skill),依 order
  children: AgentBlock[]     // 它指派出的 subagent 區塊
}

interface State { nodes: Record<string, TreeNode>; order: string[] }

// 主 agent 狀態:任一節點 awaiting → awaiting;否則有 running → running;
// 否則有 error/failed → error;有節點且全 done → done;空 → running。
function deriveStatus(all: TreeNode[]): NodeStatus {
  if (all.some((n) => n.status === 'awaiting')) return 'awaiting'
  if (all.some((n) => n.status === 'running')) return 'running'
  if (all.some((n) => n.status === 'error' || n.status === 'failed')) return 'error'
  if (all.length > 0 && all.every((n) => n.status === 'done')) return 'done'
  return 'running'
}

export function buildAgentBlocks(state: State): { main: AgentBlock } {
  const known = (pid: string | null): boolean => pid !== null && pid in state.nodes
  // parentId 為 null 或指向不存在節點 → 視為 root(掛在主 agent 底下)。
  const childrenOf = (parentId: string | null): TreeNode[] =>
    state.order
      .map((id) => state.nodes[id])
      .filter((n) => (parentId === null ? !known(n.parentId) : n.parentId === parentId))

  const makeBlock = (node: TreeNode): AgentBlock => {
    const kids = childrenOf(node.id)
    return {
      id: node.id,
      node,
      status: node.status,
      items: kids.filter((k) => k.type !== 'subagent'),
      children: kids.filter((k) => k.type === 'subagent').map(makeBlock),
    }
  }

  const roots = childrenOf(null)
  const allNodes = state.order.map((id) => state.nodes[id])
  const main: AgentBlock = {
    id: null,
    node: null,
    status: deriveStatus(allNodes),
    items: roots.filter((n) => n.type !== 'subagent'),
    children: roots.filter((n) => n.type === 'subagent').map(makeBlock),
  }
  return { main }
}

// 攤平成有序的 agent 清單(main 在前、深度優先展開 subagent),供左側清單 + 彈窗導覽。
export interface AgentEntry {
  key: string            // 唯一鍵:主 agent='main',subagent=其 node.id
  title: string          // 主=mainTitle,sub=node.label
  kind: 'main' | 'sub'
  status: NodeStatus
  steps: number          // items + 直屬 children 數
  reason?: string        // subagent「被指派的理由」(main 無)
  items: TreeNode[]      // 該 agent 的工作項目
  subKeys: string[]      // 直屬 subagent 的 key(彈窗頂部 chip + 切換)
}

export function flattenAgents(main: AgentBlock, mainTitle: string): AgentEntry[] {
  const out: AgentEntry[] = []
  const visit = (block: AgentBlock, title: string, kind: 'main' | 'sub'): void => {
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

// 工作項目分類:cls 給樣式、text 給標籤。AgentModal 顯示與 buildAnalysisTrace 共用同一套判斷。
export function classifyKind(node: TreeNode): { cls: string; text: string } {
  if (node.type === 'skill') return { cls: 'skill', text: 'SKILL' }
  if (node.type === 'subagent') return { cls: 'subagent', text: 'SUB' }
  if (/^mcp__/.test(node.label) || /^mcp__/.test(node.id)) return { cls: 'mcp', text: 'MCP' }
  return { cls: '', text: 'TOOL' }
}

const OUTPUT_MAX = 500

// 把一個 agent 的工作項目攤成可讀、已編號的 ReAct 軌跡,供 POST /analyze。
export function buildAnalysisTrace(entry: AgentEntry, outputByNode: Record<string, string>): AnalysisTrace {
  const steps: AnalysisStep[] = entry.items.map((n, i) => {
    const out = outputByNode[n.id]
    return {
      index: i + 1,
      label: n.label,
      kind: classifyKind(n).text,
      status: n.status,
      ...(n.reason ? { reason: n.reason } : {}),
      ...(out ? { output: out.slice(0, OUTPUT_MAX) } : {}),
    }
  })
  return { title: entry.title, kind: entry.kind, steps }
}
