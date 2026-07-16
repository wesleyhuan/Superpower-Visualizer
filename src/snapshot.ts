import type { FrontendEvent, TreeNode, LogEntry, ConversationEntry } from './types'

export class SnapshotStore {
  private seq = 0
  private nodes = new Map<string, TreeNode>()
  private logs: LogEntry[] = []
  private messages: ConversationEntry[] = []
  readonly logBufferMax = 500
  readonly messageBufferMax = 500

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
      case 'message':
        this.messages.push({ role: event.role, text: event.text })
        if (this.messages.length > this.messageBufferMax) this.messages.shift()
        break
    }
    return { seq: this.seq, event }
  }

  // 切換 session / 模式時整個歸零,讓下一份 snapshot 從乾淨狀態開始。
  reset(): void {
    this.seq = 0
    this.nodes.clear()
    this.logs = []
    this.messages = []
  }

  snapshot(): { seq: number; nodes: TreeNode[]; logs: LogEntry[]; messages: ConversationEntry[] } {
    return { seq: this.seq, nodes: [...this.nodes.values()], logs: [...this.logs], messages: [...this.messages] }
  }
}
