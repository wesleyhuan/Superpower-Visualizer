type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>
type RunQuery = (args: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
  cwd?: string
}) => AsyncIterable<any>

// 一次 agent session 的全部可變狀態。每次 start() 都建一個新的,彼此不共用:
// 舊 session 的 consume 迴圈即使還沒結束,也只能碰到「自己的」inbox / pending / controller,
// 不會把訊息餵進新 session,也不會讓新 session 的 approve 去 resolve 舊工具。
interface Session {
  controller: AbortController
  inbox: any[]
  inboxResolvers: ((v: IteratorResult<any>) => void)[]
  // 每個等待核准的工具:resolve + 原始 input(核准時要原封不動傳回 SDK)
  pending: Map<string, { resolve: (d: Decision) => void; input: unknown }>
  stopped: boolean // 被 pause() 叫停
  finished: boolean // consume 迴圈已結束(串流跑完或拋錯)
}

export class SessionManager {
  private msgCbs: ((m: any) => void)[] = []
  private awaitCbs: ((a: { toolUseId: string; name: string; input: unknown }) => void)[] = []
  // 最近一次 start() 的 session。pause() 後仍保留(讓它的結尾錯誤能送達畫面),
  // 直到下一次 start() 才被換掉;換掉之後,舊 session 的任何輸出都會被丟棄。
  private current: Session | null = null

  constructor(private deps: { runQuery: RunQuery }) {}

  onMessage(cb: (m: any) => void) { this.msgCbs.push(cb) }
  onAwaitTool(cb: (a: { toolUseId: string; name: string; input: unknown }) => void) { this.awaitCbs.push(cb) }

  // 是否有 session 正在跑(已 start、未被 pause、consume 迴圈也還沒結束)。
  isRunning(): boolean {
    const s = this.current
    return !!s && !s.stopped && !s.finished
  }

  // 每個 session 有自己的 canUseTool(閉包綁住 s),所以 pending 不會跨 session。
  private makeCanUseTool(s: Session): CanUseTool {
    return (toolName, input, ctx) => {
      console.log('[SessionManager] canUseTool gate', toolName, ctx.toolUseId)
      // 已叫停的 session 若還在問權限,直接拒絕,不要冒出新的核准框。
      if (s.stopped || s !== this.current) return Promise.resolve({ behavior: 'deny', message: 'paused' })
      return new Promise<Decision>((resolve) => {
        s.pending.set(ctx.toolUseId, { resolve, input })
        for (const cb of this.awaitCbs) cb({ toolUseId: ctx.toolUseId, name: toolName, input })
      })
    }
  }

  approveTool(toolUseId: string, allow: boolean) {
    const entry = this.current?.pending.get(toolUseId)
    if (!entry) { console.log('[SessionManager] approve no-op, unknown', toolUseId); return }
    this.current!.pending.delete(toolUseId)
    // 核准時把原本的 input 傳回去:SDK 的 updatedInput 是「要拿來執行的參數」,
    // 給 undefined 有些 SDK 版本會驗證失敗或用空參數執行;原封不動 = 照 agent 的原意執行。
    const updatedInput = (entry.input ?? {}) as Record<string, unknown>
    entry.resolve(allow ? { behavior: 'allow', updatedInput } : { behavior: 'deny', message: 'user denied' })
  }

  private pushInput(s: Session, msg: any) {
    const r = s.inboxResolvers.shift()
    if (r) r({ value: msg, done: false })
    else s.inbox.push(msg)
  }

  private inputQueue(s: Session): AsyncIterable<any> {
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<any>> {
            if (s.stopped) return Promise.resolve({ value: undefined, done: true })
            if (s.inbox.length) return Promise.resolve({ value: s.inbox.shift(), done: false })
            return new Promise((resolve) => s.inboxResolvers.push(resolve))
          },
        }
      },
    }
  }

  // 回傳是否送達。沒有正在跑的 session 就不收(以前會留在佇列,被下一個 session 誤吃)。
  sendFollowup(text: string): boolean {
    if (!this.isRunning()) { console.log('[SessionManager] followup ignored: no running session'); return false }
    console.log('[SessionManager] followup queued')
    this.pushInput(this.current!, { type: 'user', message: { role: 'user', content: text } })
    return true
  }

  pause() {
    const s = this.current
    if (!s || s.stopped) return
    console.log('[SessionManager] pause: denying', s.pending.size, 'pending')
    s.stopped = true
    for (const [, { resolve }] of s.pending) resolve({ behavior: 'deny', message: 'paused' })
    s.pending.clear()
    // 已停在 next() 等輸入的 iterator:告訴它「沒有了」,讓 SDK 那端自然收尾。
    for (const r of s.inboxResolvers) r({ value: undefined, done: true })
    s.inboxResolvers = []
    s.inbox = []
    s.controller.abort()
  }

  // 回傳是否真的開了新 session。已有 session 在跑時拒絕(避免兩個 consume 迴圈並存)。
  start(initialPrompt: string, cwd?: string): boolean {
    if (this.isRunning()) {
      console.log('[SessionManager] start rejected: session already running')
      return false
    }
    const s: Session = {
      controller: new AbortController(),
      inbox: [],
      inboxResolvers: [],
      pending: new Map(),
      stopped: false,
      finished: false,
    }
    this.current = s
    this.pushInput(s, { type: 'user', message: { role: 'user', content: initialPrompt } })
    void this.consume(s, cwd)
    return true
  }

  // 只有「目前」的 session 才能把訊息送上畫面;被新 session 取代的舊迴圈輸出一律丟棄。
  private emit(s: Session, msg: any) {
    if (s !== this.current) { console.log('[SessionManager] drop message from stale session'); return }
    for (const cb of this.msgCbs) cb(msg)
  }

  private async consume(s: Session, cwd?: string) {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputQueue(s),
        canUseTool: this.makeCanUseTool(s),
        signal: s.controller.signal,
        cwd,
      })
      for await (const msg of stream) this.emit(s, msg)
    } catch (err) {
      console.error('[SessionManager] consume error:', err)
      this.emit(s, { type: 'session_error', error: String(err) })
    } finally {
      s.finished = true
      s.pending.clear()
    }
  }
}
