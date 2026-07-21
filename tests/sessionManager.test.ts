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

  it('pause 後重建 AbortController:後續 start 拿到未 abort 的 signal(可開新 session)', async () => {
    const signals: AbortSignal[] = []
    const mgr = new SessionManager({
      runQuery: ({ signal }: any) => {
        signals.push(signal)
        return (async function* () { /* 立即結束,不吐訊息 */ })()
      },
    })
    mgr.onMessage(() => {})
    mgr.onAwaitTool(() => {})

    mgr.start('first')
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    mgr.pause()
    expect(signals[0].aborted).toBe(true) // 舊 session 的 signal 被 abort

    mgr.start('second')
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[1].aborted).toBe(false) // 新 session 拿到全新、未 abort 的 signal
  })
})

describe('SessionManager: cwd', () => {
  it('start(prompt, cwd) 會把 cwd 傳給 runQuery', async () => {
    let seen: any
    const mgr = new SessionManager({
      runQuery: (args: any) => { seen = args; return (async function* () {})() },
    })
    mgr.start('做事', 'C:/work')
    await Promise.resolve()
    expect(seen.cwd).toBe('C:/work')
  })
})
