export type NodeType = 'agent' | 'subagent' | 'skill' | 'tool'
export type NodeStatus =
  | 'running' | 'awaiting' | 'done' | 'error' | 'interrupted' | 'failed'

export interface TreeNode {
  id: string
  parentId: string | null
  type: NodeType
  label: string
  status: NodeStatus
  reason?: string // ReAct:動手前那句敘述,顯示在該批工具上方一次
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

export type ControlCommand =
  | { type: 'pause' }
  | { type: 'approve'; toolUseId: string; allow: boolean }
  | { type: 'followup'; text: string }

export type Mode = 'control' | 'observe'

// 可觀察的外部 Claude Code session(GET /sessions)
export interface SessionInfo {
  file: string
  project: string
  cwd: string
  mtime: number
  subagents: number
}

export type SnapshotPacket = { type: 'snapshot'; seq: number; nodes: TreeNode[]; logs: LogEntry[]; workspace: string; messages: ConversationEntry[]; mode?: Mode }
export type EventPacket = { type: 'event'; seq: number; event: FrontendEvent }
export type Packet = SnapshotPacket | EventPacket
