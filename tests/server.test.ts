import { describe, it, expect } from 'vitest'
import { wireEvents } from '../src/server'
import { SnapshotStore } from '../src/snapshot'
import { ReActAssembler } from '../src/reactAssembler'

describe('wireEvents: SessionManager 訊息 → 翻譯 → 快照 → 廣播', () => {
  it('assistant tool_use 訊息會經 translate 進 store 並廣播帶 seq', () => {
    const store = new SnapshotStore()
    const broadcasted: any[] = []
    // 假 mgr:只暴露 onMessage / onAwaitTool
    const handlers: any = {}
    const fakeMgr: any = {
      onMessage: (cb: any) => (handlers.msg = cb),
      onAwaitTool: (cb: any) => (handlers.await = cb),
    }
    wireEvents(fakeMgr, store, (packet) => broadcasted.push(packet), new ReActAssembler())

    handlers.msg({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] },
    })

    expect(broadcasted.some((p) => p.seq === 1 && p.event.kind === 'tree:node')).toBe(true)
    expect(store.snapshot().nodes).toHaveLength(1)
  })

  it('敘述後接工具:tool_use 帶上前一句 assistant text 當 reason', () => {
    const store = new SnapshotStore()
    const broadcasted: any[] = []
    const handlers: any = {}
    const fakeMgr: any = {
      onMessage: (cb: any) => (handlers.msg = cb),
      onAwaitTool: (cb: any) => (handlers.await = cb),
    }
    wireEvents(fakeMgr, store, (packet) => broadcasted.push(packet), new ReActAssembler())

    handlers.msg({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '先看結構' }] } })
    handlers.msg({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } })

    expect(store.snapshot().nodes[0].reason).toBe('先看結構')
    // 敘述被配成 reason,不會另外變成對話訊息
    expect(store.snapshot().messages).toHaveLength(0)
  })
})
