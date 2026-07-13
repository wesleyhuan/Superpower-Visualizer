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
