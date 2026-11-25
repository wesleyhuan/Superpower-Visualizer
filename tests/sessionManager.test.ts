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
    // 核准時把原本的工具參數傳回 SDK(而不是 undefined)
    expect(messages[0].decision.updatedInput).toEqual({ command: 'ls' })
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

// 可手動控制的假 agent:每次 runQuery 都記下 args,並回傳一個「等外部 push 才吐訊息」的串流。
// 用來模擬「舊 session 被 pause 後,SDK 還慢半拍吐出訊息」的情況。
function controllableRunQuery() {
  const runs: { args: any; push: (m: any) => void; end: () => void }[] = []
  const runQuery = (args: any) => {
    const queue: any[] = []
    let wake: (() => void) | null = null
    let ended = false
    const run = {
      args,
      push: (m: any) => { queue.push(m); wake?.() },
      end: () => { ended = true; wake?.() },
    }
    runs.push(run)
    return (async function* () {
      while (true) {
        if (queue.length) { yield queue.shift(); continue }
        if (ended) return
        await new Promise<void>((r) => { wake = r })
        wake = null
      }
    })()
  }
  return { runQuery, runs }
}

describe('SessionManager: 不重複開 session(問題 1)', () => {
  it('session 跑著時再 start → 回傳 false,runQuery 只被呼叫一次', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    expect(mgr.start('first')).toBe(true)
    expect(mgr.isRunning()).toBe(true)
    expect(mgr.start('second')).toBe(false)
    await Promise.resolve()
    expect(runs).toHaveLength(1)
  })

  it('第二次 start 的 prompt 不會混進第一個 session 的輸入', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    mgr.start('first')
    mgr.start('second') // 被拒
    const it = runs[0].args.prompt[Symbol.asyncIterator]()
    expect((await it.next()).value.message.content).toBe('first')
    // inbox 裡不該還有 'second'
    const raced = await Promise.race([it.next(), new Promise((r) => setTimeout(() => r('empty'), 20))])
    expect(raced).toBe('empty')
  })

  it('串流結束後(session 跑完)可以再 start', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    mgr.start('first')
    runs[0].end()
    await vi.waitFor(() => expect(mgr.isRunning()).toBe(false))
    expect(mgr.start('again')).toBe(true)
    expect(runs).toHaveLength(2)
  })

  it('沒有 session 時 sendFollowup → false,不會留給下一個 session', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    expect(mgr.sendFollowup('orphan')).toBe(false)
    mgr.start('real')
    const it = runs[0].args.prompt[Symbol.asyncIterator]()
    expect((await it.next()).value.message.content).toBe('real')
  })
})

describe('SessionManager: pause 後舊迴圈不能污染新 session(問題 3)', () => {
  it('pause → start 新 session 後,舊串流晚到的訊息被丟棄,新 session 的照常送出', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    const messages: any[] = []
    mgr.onMessage((m) => messages.push(m))

    mgr.start('first')
    mgr.pause()
    mgr.start('second')
    expect(runs).toHaveLength(2)

    runs[0].push({ type: 'assistant', from: 'old' }) // 舊 SDK 慢半拍吐出來
    runs[1].push({ type: 'assistant', from: 'new' })
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10)) // 給舊迴圈機會(如果它還能寫的話)
    expect(messages.map((m) => m.from)).toEqual(['new'])
  })

  it('舊串流在新 session 開始後才拋錯 → 不會把 session_error 寫進新 session', async () => {
    let failOld: (e: Error) => void = () => {}
    const mgr = new SessionManager({
      runQuery: (() => {
        let n = 0
        return () => {
          n++
          if (n === 1) return (async function* () { await new Promise((_, rej) => { failOld = rej }) })()
          return (async function* () { await new Promise(() => {}) })()
        }
      })() as any,
    })
    const messages: any[] = []
    mgr.onMessage((m) => messages.push(m))
    mgr.start('first')
    mgr.pause()
    mgr.start('second')
    failOld(new Error('Operation aborted'))
    await new Promise((r) => setTimeout(r, 10))
    expect(messages).toEqual([])
  })

  it('pause 後(還沒開新 session)舊 session 的結尾錯誤仍會送達,畫面才知道 session 結束了', async () => {
    let failOld: (e: Error) => void = () => {}
    const mgr = new SessionManager({
      runQuery: () => (async function* () { await new Promise((_, rej) => { failOld = rej }) })() as any,
    })
    const messages: any[] = []
    mgr.onMessage((m) => messages.push(m))
    mgr.start('first')
    mgr.pause()
    failOld(new Error('Operation aborted'))
    await vi.waitFor(() => expect(messages[0]?.type).toBe('session_error'))
  })

  it('新 session 的 approve 不會 resolve 到舊 session 的工具;舊 session 停了之後再問權限直接 deny', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    const awaited: any[] = []
    mgr.onAwaitTool((a) => awaited.push(a))

    mgr.start('first')
    mgr.pause()
    mgr.start('second')

    // 舊 session 的 canUseTool 在 pause 後才被呼叫
    const oldDecision = await runs[0].args.canUseTool('Bash', { command: 'rm -rf /' }, { toolUseId: 'toolu_old' })
    expect(oldDecision.behavior).toBe('deny')
    expect(awaited).toHaveLength(0) // 不會跳出核准框

    // 新 session 的工具照常等核准
    const p = runs[1].args.canUseTool('Read', { file: 'a' }, { toolUseId: 'toolu_new' })
    expect(awaited.map((a) => a.toolUseId)).toEqual(['toolu_new'])
    mgr.approveTool('toolu_old', true) // 舊 id:no-op
    mgr.approveTool('toolu_new', true)
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { file: 'a' } })
  })

  it('pause 會讓停在等輸入的 iterator 收到 done,SDK 端可以自然收尾', async () => {
    const { runQuery, runs } = controllableRunQuery()
    const mgr = new SessionManager({ runQuery })
    mgr.start('first')
    const it = runs[0].args.prompt[Symbol.asyncIterator]()
    await it.next() // 吃掉 'first'
    const waiting = it.next() // 停著等下一則輸入
    mgr.pause()
    expect((await waiting).done).toBe(true)
  })
})
