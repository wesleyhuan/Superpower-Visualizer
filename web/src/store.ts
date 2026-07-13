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
