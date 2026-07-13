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
  }
  return next
}

export function resolvePending(state: SessionState, toolUseId: string): SessionState {
  return { ...state, pending: state.pending.filter((p) => p.toolUseId !== toolUseId) }
}
