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
