type Decision =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string }
type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>
type RunQuery = (args: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
}) => AsyncIterable<any>

export class SessionManager {
  private pending = new Map<string, (d: Decision) => void>()
  private msgCbs: ((m: any) => void)[] = []
  private awaitCbs: ((a: { toolUseId: string; name: string; input: unknown }) => void)[] = []
  private controller = new AbortController()
  private inbox: any[] = []
  private inboxResolvers: ((v: IteratorResult<any>) => void)[] = []

  constructor(private deps: { runQuery: RunQuery }) {}

  onMessage(cb: (m: any) => void) { this.msgCbs.push(cb) }
  onAwaitTool(cb: (a: { toolUseId: string; name: string; input: unknown }) => void) { this.awaitCbs.push(cb) }

  private canUseTool: CanUseTool = (toolName, input, ctx) => {
    console.log('[SessionManager] canUseTool gate', toolName, ctx.toolUseId)
    return new Promise<Decision>((resolve) => {
      this.pending.set(ctx.toolUseId, resolve)
      for (const cb of this.awaitCbs) cb({ toolUseId: ctx.toolUseId, name: toolName, input })
    })
  }

  approveTool(toolUseId: string, allow: boolean) {
    const resolve = this.pending.get(toolUseId)
    if (!resolve) { console.log('[SessionManager] approve no-op, unknown', toolUseId); return }
    this.pending.delete(toolUseId)
    resolve(allow ? { behavior: 'allow', updatedInput: undefined } : { behavior: 'deny', message: 'user denied' })
  }

  private pushInput(msg: any) {
    const r = this.inboxResolvers.shift()
    if (r) r({ value: msg, done: false })
    else this.inbox.push(msg)
  }

  private inputQueue(): AsyncIterable<any> {
    const self = this
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<any>> {
            if (self.inbox.length) return Promise.resolve({ value: self.inbox.shift(), done: false })
            return new Promise((resolve) => self.inboxResolvers.push(resolve))
          },
        }
      },
    }
  }

  sendFollowup(text: string) {
    console.log('[SessionManager] followup queued')
    this.pushInput({ type: 'user', message: { role: 'user', content: text } })
  }

  pause() {
    console.log('[SessionManager] pause: denying', this.pending.size, 'pending')
    for (const [, resolve] of this.pending) resolve({ behavior: 'deny', message: 'paused' })
    this.pending.clear()
    this.controller.abort()
    // 重建 controller,否則下一次 start() 會沿用已 abort 的 signal → 立刻 Operation aborted。
    this.controller = new AbortController()
    // 清掉舊 session 遺留的輸入佇列:已死 iterator 的 parked resolver 若留著,
    // 會被下一次 start() 的 pushInput shift 走、把新訊息餵給死掉的 query。
    this.inbox = []
    this.inboxResolvers = []
  }

  start(initialPrompt: string) {
    this.pushInput({ type: 'user', message: { role: 'user', content: initialPrompt } })
    void this.consume()
  }

  private async consume() {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputQueue(),
        canUseTool: this.canUseTool,
        signal: this.controller.signal,
      })
      for await (const msg of stream) {
        for (const cb of this.msgCbs) cb(msg)
      }
    } catch (err) {
      console.error('[SessionManager] consume error:', err)
      for (const cb of this.msgCbs) cb({ type: 'session_error', error: String(err) })
    }
  }
}
