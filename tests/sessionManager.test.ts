import { describe, it, expect, vi } from 'vitest'
import { SessionManager } from '../src/sessionManager'

// 一個會呼叫 canUseTool 並在核准後吐出 assistant 訊息的假 runQuery
function fakeRunQuery(): any {
  return ({ canUseTool }: any) => {
    return (async function* () {
      const decision = await canUseTool('Bash', { command: 'ls' }, { toolUseId: 'toolu_x' })
      yield { type: 'result', decision }
    })()
  }
}

describe('SessionManager: canUseTool 閘門', () => {
  it('canUseTool 觸發時發出 await:tool,並在 approve 後 resolve 為 allow', async () => {
    const mgr = new SessionManager({ runQuery: fakeRunQuery() })
    const awaited: any[] = []
    const messages: any[] = []
    mgr.onAwaitTool((a) => awaited.push(a))
    mgr.onMessage((m) => messages.push(m))

    mgr.start('do something')
    await vi.waitFor(() => expect(awaited).toHaveLength(1))
    expect(awaited[0].toolUseId).toBe('toolu_x')

    mgr.approveTool('toolu_x', true)
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0].decision.behavior).toBe('allow')
  })
})

describe('SessionManager: pause', () => {
  it('pause 會把所有 pending 以 deny resolve 並清空', async () => {
    const mgr = new SessionManager({
      runQuery: ({ canUseTool }: any) => (async function* () {
        const d = await canUseTool('Bash', {}, { toolUseId: 'toolu_p' })
        yield { type: 'result', decision: d }
      })(),
    })
    const messages: any[] = []
    mgr.onMessage((m) => messages.push(m))
    mgr.onAwaitTool(() => {})
    mgr.start('go')
    // 等 pending 建立後 pause
    await new Promise((r) => setTimeout(r, 10))
    mgr.pause()
    await vi.waitFor(() => expect(messages.some((m) => m.decision?.behavior === 'deny')).toBe(true))
  })
})
