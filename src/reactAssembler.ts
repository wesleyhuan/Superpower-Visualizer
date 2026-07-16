import type { FrontendEvent } from './types'

// ReAct 組裝器:把「敘述(assistant-text)→ 動作(tool_use)」配對起來。
//  - 每個 agent(parentId)各有一個「待定敘述」緩衝。
//  - 收到敘述 → 累積,先不發對話訊息。
//  - 收到工具 → 把緩衝當成該工具的 reason(一句理由對整批:只掛該批第一個工具),清空緩衝。
//  - 收到人類訊息 / session 結束 / flushAll → 把還沒配到工具的敘述 flush 成 assistant 對話訊息
//    (那是給使用者的總結,不是某個工具的理由)。
//
// 有狀態,Route A(逐字稿)與 Route B(SDK 串流)共用;切換來源時 reset()。
export class ReActAssembler {
  private pending = new Map<string, string[]>()

  private key(parentId: string | null): string {
    return parentId ?? '∅' // ∅ = 主 agent
  }

  process(events: FrontendEvent[]): FrontendEvent[] {
    const out: FrontendEvent[] = []
    for (const ev of events) out.push(...this.one(ev))
    return out
  }

  private one(ev: FrontendEvent): FrontendEvent[] {
    switch (ev.kind) {
      case 'assistant-text': {
        const k = this.key(ev.parentId)
        const buf = this.pending.get(k) ?? []
        buf.push(ev.text)
        this.pending.set(k, buf)
        return []
      }
      case 'tree:node': {
        const k = this.key(ev.node.parentId)
        const buf = this.pending.get(k)
        if (buf && buf.length) {
          this.pending.delete(k) // 這批第一個工具吃掉理由;同批後續工具緩衝已空 → 無 reason
          return [{ ...ev, node: { ...ev.node, reason: buf.join('\n') } }]
        }
        return [ev]
      }
      case 'message': // 人類訊息 → 先把待定敘述 flush 掉(那是總結),再放人類訊息
        return [...this.flushAll(), ev]
      case 'session:error':
        return [...this.flushAll(), ev]
      default:
        return [ev]
    }
  }

  // 把所有還沒配到工具的敘述變成 assistant 對話訊息(回合結束 / backfill 收尾時呼叫)。
  flushAll(): FrontendEvent[] {
    const out: FrontendEvent[] = []
    for (const buf of this.pending.values()) {
      if (buf.length) out.push({ kind: 'message', role: 'assistant', text: buf.join('\n') })
    }
    this.pending.clear()
    return out
  }

  reset(): void {
    this.pending.clear()
  }
}
