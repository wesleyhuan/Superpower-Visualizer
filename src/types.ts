export type NodeType = 'agent' | 'subagent' | 'skill' | 'tool'
export type NodeStatus =
  | 'running' | 'awaiting' | 'done' | 'error' | 'interrupted' | 'failed'

export interface TreeNode {
  id: string
  parentId: string | null
  type: NodeType
  label: string
  status: NodeStatus
  reason?: string // ReAct:動手前那句敘述(掛在該批工具的第一個上,前端顯示一次)
}

export interface LogEntry {
  ts: number
  nodeId: string | null
  text: string
  level: 'info' | 'error'
}

export interface ConversationEntry {
  role: 'user' | 'assistant'
  text: string
}

export type FrontendEvent =
  | { kind: 'tree:node'; node: TreeNode }
  | { kind: 'tree:status'; id: string; status: NodeStatus }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'await:tool'; toolUseId: string; name: string; input: unknown }
  | { kind: 'session:error'; message: string }
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
  // 中介事件:assistant 的敘述文字(帶 parentId)。由 ReActAssembler 消化成
  // 工具的 reason,或(沒接工具時)flush 成 assistant 對話訊息;不會進 SnapshotStore。
  | { kind: 'assistant-text'; parentId: string | null; text: string }

export type ControlCommand =
  | { type: 'pause' }
  | { type: 'approve'; toolUseId: string; allow: boolean }
  | { type: 'followup'; text: string }

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
